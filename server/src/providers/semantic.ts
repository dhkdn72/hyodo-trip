// 의미 기반 추천 — 문장 임베딩 모델 (transformers.js, ONNX, 서버 CPU에서 실행)
//
//  모델: Xenova/multilingual-e5-small (intfloat/multilingual-e5-small 을 ONNX 로 바꾼 것, 한국어 포함 다국어)
//   - 처음 쓸 때 Hugging Face 에서 한 번 내려받아 server/.cache/models 에 저장
//   - e5 계열은 질의 앞에 'query: ', 문서 앞에 'passage: ' 를 붙여야 함
//  장소 문장: 이름 + TourAPI 신분류 이름(lclsSystmCode2) + 소개글(detailCommon2 overview 앞 300자)
//  소개글·벡터는 server/.cache 에 저장해 같은 장소는 다시 받거나 계산하지 않음
//  점수 = 질의별로 [임베딩 코사인 유사도]와 [BM25(소개글 키워드)]를 후보 안에서 표준화해 평균 → 질의들 중 최댓값
//   (eval/results.md: 임베딩 단독·BM25 단독보다 둘을 합친 쪽이 nDCG@10·P@5 가 높았음)
//  모델이 아직 준비 중이면(첫 실행 때 내려받는 중) 그 요청은 BM25 만 쓰고, 모델을 못 쓰는 환경이면 계속 BM25 만 씀

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { bm25Scorer, cosine, placeText, zscores, type Place } from '@hyodo/core';
import { CACHE_DIR, DiskCache } from '../diskCache.ts';
import { env } from '../env.ts';
import { log, mapLimit } from '../http.ts';
import { plain } from './placeDetail.ts';
import { dataGoKr } from './tourApi.ts';

const MODEL = env.embeddingModel;
export const semanticEnabled = MODEL.toLowerCase() !== 'off';
const isE5 = /e5/i.test(MODEL);

// ───────── 모델 ─────────

type Extractor = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
let extractorP: Promise<Extractor | null> | null = null;
let loadError: string | null = null;
const modelShort = MODEL.split('/').pop()!;

async function getExtractor(): Promise<Extractor | null> {
  if (!semanticEnabled || loadError) return null;
  if (!extractorP) {
    extractorP = (async () => {
      const t0 = Date.now();
      const tf = await import('@huggingface/transformers');
      tf.env.cacheDir = join(CACHE_DIR, 'models');
      let ex: unknown;
      try {
        ex = await tf.pipeline('feature-extraction', MODEL, { dtype: 'q8' });
      } catch (e) {
        log('임베딩 모델 q8 불러오기 실패 → fp32 로 다시', (e as Error).message);
        ex = await tf.pipeline('feature-extraction', MODEL, { dtype: 'fp32' });
      }
      log(`임베딩 모델 준비 ${MODEL} (${Date.now() - t0}ms)`);
      return ex as Extractor;
    })().catch((e) => {
      loadError = (e as Error).message;
      log('임베딩 모델을 쓸 수 없어 규칙 추천만 씀:', loadError);
      return null;
    });
  }
  return extractorP;
}

export function semanticStatus() {
  return { model: semanticEnabled ? MODEL : null, error: loadError };
}

/** 서버가 켜질 때 모델을 미리 불러 둠 (첫 실행이면 내려받기 시작) */
export function warmUpSemantic() {
  if (semanticEnabled) void getExtractor();
}

/** 모델이 ms 안에 준비되면 그 모델, 아니면 null (요청을 오래 붙잡지 않음) */
async function extractorWithin(ms: number): Promise<Extractor | null> {
  if (!semanticEnabled || loadError) return null;
  return Promise.race([getExtractor(), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

const vectors = new DiskCache<number[]>(`vectors-${MODEL.replace(/[^\w.-]+/g, '_')}`);
const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 20);

/** 문장들 → 정규화된 벡터 (캐시에 있으면 계산하지 않음). 모델을 못 쓰면 null */
export async function embedTexts(texts: string[], kind: 'query' | 'passage'): Promise<number[][] | null> {
  const inputs = texts.map((t) => (isE5 ? `${kind}: ${t}` : t));
  const keys = inputs.map(hash);
  const todo = [...new Set(keys.map((k, i) => (vectors.has(k) ? -1 : i)).filter((i) => i >= 0))];
  if (todo.length) {
    const ex = await getExtractor();
    if (!ex) return null;
    for (let i = 0; i < todo.length; i += 16) {
      const batch = todo.slice(i, i + 16);
      const out = (await ex(batch.map((j) => inputs[j]), { pooling: 'mean', normalize: true })).tolist();
      batch.forEach((j, n) => vectors.set(keys[j], out[n].map((x) => Math.round(x * 1e5) / 1e5)));
    }
  }
  return keys.map((k) => vectors.get(k)!);
}

// ───────── 장소 문장 ─────────

let lclsP: Promise<Map<string, string>> | null = null;

/** 신분류 코드 → '역사관광 > 종교성지 > 불교' 같은 이름 (lclsSystmCode2, lclsSystmListYn=Y) */
export function lclsNames(): Promise<Map<string, string>> {
  if (!env.tourApiKey) return Promise.resolve(new Map());
  if (!lclsP) {
    lclsP = dataGoKr('KorService2', 'lclsSystmCode2', { lclsSystmListYn: 'Y', numOfRows: 2000, pageNo: 1 }, env.tourApiKey, 7 * 24 * 3600_000)
      .then((items) => {
        const m = new Map<string, string>();
        for (const it of items) {
          const names = [it.lclsSystm1Nm, it.lclsSystm2Nm, it.lclsSystm3Nm].filter(Boolean).map(String);
          if (it.lclsSystm3Cd) m.set(String(it.lclsSystm3Cd), names.join(' > '));
        }
        return m;
      })
      .catch((e) => {
        log('신분류 이름 조회 실패', (e as Error).message);
        lclsP = null;
        return new Map();
      });
  }
  return lclsP;
}

const overviews = new DiskCache<string>('overviews');

/** TourAPI 소개글 (앞 400자). 한 번 받은 장소는 파일 캐시에서 */
export async function overviewOf(p: Place): Promise<string> {
  if (p.source !== 'tourapi' || !env.tourApiKey) return '';
  const id = p.id.replace('tour:', '');
  const hit = overviews.get(id);
  if (hit !== undefined) return hit;
  try {
    const [c] = await dataGoKr('KorService2', 'detailCommon2', { contentId: id }, env.tourApiKey, 24 * 3600_000);
    const ov = plain(c?.overview).replace(/\s+/g, ' ').slice(0, 400);
    overviews.set(id, ov);
    return ov;
  } catch (e) {
    log('소개글 조회 실패', p.name, (e as Error).message);
    return '';
  }
}

export async function placeTextFor(p: Place): Promise<string> {
  const names = await lclsNames();
  const cat = p.lcls?.[2] ? names.get(p.lcls[2]) : undefined;
  return placeText(p, cat, await overviewOf(p));
}

// ───────── 추천 점수 ─────────

/**
 * 장소마다 질의들 중 가장 잘 맞는 정도.
 * 질의마다 점수 크기가 달라(어떤 질의는 모든 장소와 0.85, 어떤 질의는 0.78 근처) 그대로 최댓값을 쓰면
 * 한 질의가 독차지하므로, 질의별로 후보 안에서 표준화(z)한 뒤 최댓값을 씀
 */
export async function semanticScore(queries: string[], places: Place[]): Promise<{ scores: Map<string, number>; method: string } | null> {
  if (!queries.length || !places.length) return null;
  const texts = await mapLimit(places, 4, placeTextFor);
  const bm = bm25Scorer(new Map(places.map((p, i) => [p.id, texts[i]])));
  const ex = await extractorWithin(3000);
  const [q, d] = ex ? await Promise.all([embedTexts(queries, 'query'), embedTexts(texts, 'passage')]) : [null, null];
  const useEmb = !!(q && d);
  const perQuery = queries.map((qs, qi) => {
    const zb = zscores(new Map(places.map((p) => [p.id, bm(qs, p.id)])));
    if (!useEmb) return zb;
    const ze = zscores(new Map(places.map((p, i) => [p.id, cosine(q![qi], d![i])])));
    return new Map(places.map((p) => [p.id, (zb.get(p.id)! + ze.get(p.id)!) / 2]));
  });
  return {
    scores: new Map(places.map((p) => [p.id, Math.max(...perQuery.map((z) => z.get(p.id) ?? 0))])),
    method: useEmb ? `${modelShort} + BM25` : 'BM25',
  };
}
