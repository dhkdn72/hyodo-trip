// 취향 추천 평가 — 같은 질의·같은 후보로 네 가지 방식을 비교합니다.
//
//  데이터: eval/data/<지역>.json  (TourAPI 실제 후보: 이름·신분류 이름·소개글, /api/dev/eval-dump 로 만듦)
//  정답:   eval/queries.json      (질의마다 맞는 장소 id 목록 — 라벨 기준은 eval/README.md)
//  방식:
//   name      지금 앱의 '기타' 방식에 가까운 기준 — 질의 낱말이 장소 이름에 있는지
//   bm25      소개글까지 보는 키워드 검색 (글자 2개씩 끊은 BM25)
//   embedding 문장 임베딩 모델 (앱과 같은 모델·같은 장소 문장)
//   hybrid    bm25 와 embedding 을 표준화해 평균
//  지표: P@5, R@10, nDCG@10, MRR (core/src/evalRank.ts)

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bm25Scorer,
  cosine,
  meanMetrics,
  nameKeywordScore,
  placeText,
  rankBy,
  rankMetrics,
  zscores,
  type RankMetrics,
} from '@hyodo/core';
import { env } from './env.ts';
import { embedTexts } from './providers/semantic.ts';

export const EVAL_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../eval');

export interface EvalPlace {
  id: string;
  name: string;
  addr?: string;
  lcls?: string[];
  catPath?: string;
  overview?: string;
  dist?: number;
}

export interface EvalQuery {
  id: string;
  region: string;
  query: string;
  relevant: string[];
}

export const METHODS = ['name', 'bm25', 'embedding', 'hybrid'] as const;
export type Method = (typeof METHODS)[number];

export interface EvalReport {
  model: string;
  regions: { name: string; places: number }[];
  queries: number;
  mean: Record<Method, RankMetrics>;
  perQuery: {
    id: string;
    query: string;
    relevant: number;
    p5: Record<Method, number>;
    ndcg10: Record<Method, number>;
    top5: Record<Method, string[]>;
  }[];
  /** 질의별 nDCG@10 으로 본 승·무·패 (a 가 b 보다) */
  paired: { a: Method; b: Method; win: number; tie: number; loss: number }[];
}

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export async function runEval(dir = EVAL_DIR): Promise<EvalReport> {
  const dataDir = join(dir, 'data');
  const regions = new Map<string, EvalPlace[]>();
  for (const f of existsSync(dataDir) ? readdirSync(dataDir) : []) {
    if (f.endsWith('.json')) regions.set(f.replace(/\.json$/, ''), loadJson<EvalPlace[]>(join(dataDir, f)));
  }
  const queries = loadJson<EvalQuery[]>(join(dir, 'queries.json')).filter((q) => regions.has(q.region) && q.relevant.length);
  if (!queries.length) throw new Error('평가할 질의가 없어요. eval/data 와 eval/queries.json 을 확인해 주세요.');

  const perQuery: EvalReport['perQuery'] = [];
  const byMethod: Record<Method, RankMetrics[]> = { name: [], bm25: [], embedding: [], hybrid: [] };

  for (const [region, places] of regions) {
    const qs = queries.filter((q) => q.region === region);
    if (!qs.length) continue;
    const ids = places.map((p) => p.id);
    const nameOf = new Map(places.map((p) => [p.id, p.name]));
    const texts = places.map((p) => placeText(p, p.catPath, p.overview));
    const bm = bm25Scorer(new Map(places.map((p, i) => [p.id, texts[i]])));
    const docVecs = await embedTexts(texts, 'passage');
    const qVecs = await embedTexts(
      qs.map((q) => q.query),
      'query',
    );
    if (!docVecs || !qVecs) throw new Error('임베딩 모델을 불러오지 못했어요. npm install 과 인터넷 연결(첫 실행 때 모델 내려받기)을 확인해 주세요.');

    qs.forEach((q, qi) => {
      const rel = new Set(q.relevant);
      const emb = new Map(places.map((p, i) => [p.id, cosine(qVecs[qi], docVecs[i])]));
      const bmS = new Map(ids.map((id) => [id, bm(q.query, id)]));
      const zb = zscores(bmS);
      const ze = zscores(emb);
      const rankings: Record<Method, string[]> = {
        name: rankBy(ids, (id) => nameKeywordScore(q.query, nameOf.get(id)!)),
        bm25: rankBy(ids, (id) => bmS.get(id)!),
        embedding: rankBy(ids, (id) => emb.get(id)!),
        hybrid: rankBy(ids, (id) => (zb.get(id)! + ze.get(id)!) / 2),
      };
      const p5 = {} as Record<Method, number>;
      const ndcg10 = {} as Record<Method, number>;
      const top5 = {} as Record<Method, string[]>;
      for (const m of METHODS) {
        const r = rankMetrics(rankings[m], rel);
        byMethod[m].push(r);
        p5[m] = r.p5;
        ndcg10[m] = r.ndcg10;
        top5[m] = rankings[m].slice(0, 5).map((id) => `${nameOf.get(id)}${rel.has(id) ? ' ✓' : ''}`);
      }
      perQuery.push({ id: q.id, query: q.query, relevant: rel.size, p5, ndcg10, top5 });
    });
  }

  const pairs: [Method, Method][] = [
    ['embedding', 'name'],
    ['embedding', 'bm25'],
    ['hybrid', 'bm25'],
    ['hybrid', 'embedding'],
  ];
  const paired = pairs.map(([a, b]) => {
    let win = 0,
      tie = 0,
      loss = 0;
    for (const q of perQuery) {
      const d = q.ndcg10[a] - q.ndcg10[b];
      if (Math.abs(d) < 1e-9) tie++;
      else if (d > 0) win++;
      else loss++;
    }
    return { a, b, win, tie, loss };
  });

  return {
    model: env.embeddingModel,
    paired,
    regions: [...regions].map(([name, p]) => ({ name, places: p.length })),
    queries: perQuery.length,
    mean: Object.fromEntries(METHODS.map((m) => [m, meanMetrics(byMethod[m])])) as Record<Method, RankMetrics>,
    perQuery,
  };
}

const LABEL: Record<Method, string> = {
  name: '이름 키워드 (지금 방식)',
  bm25: 'BM25 (소개글 포함 키워드)',
  embedding: '문장 임베딩',
  hybrid: 'BM25 + 임베딩',
};

const f2 = (x: number) => x.toFixed(3);

export function reportMarkdown(r: EvalReport, date = new Date().toISOString().slice(0, 10)): string {
  const lines: string[] = [];
  lines.push('# 취향 추천 평가 결과', '');
  lines.push(`- 실행일: ${date}`);
  lines.push(`- 임베딩 모델: \`${r.model}\``);
  lines.push(`- 후보: ${r.regions.map((g) => `${g.name} ${g.places}곳`).join(', ')} (TourAPI 실제 데이터)`);
  lines.push(`- 질의: ${r.queries}개 — 정답 기준은 [README](README.md)`, '');
  lines.push('| 방식 | P@5 | R@10 | nDCG@10 | MRR |', '| --- | --- | --- | --- | --- |');
  for (const m of METHODS) {
    const x = r.mean[m];
    lines.push(`| ${LABEL[m]} | ${f2(x.p5)} | ${f2(x.r10)} | ${f2(x.ndcg10)} | ${f2(x.rr)} |`);
  }
  lines.push('', '질의별 nDCG@10 승·무·패 (왼쪽 방식 기준)', '', '| 비교 | 승 | 무 | 패 |', '| --- | --- | --- | --- |');
  for (const x of r.paired) lines.push(`| ${LABEL[x.a]} vs ${LABEL[x.b]} | ${x.win} | ${x.tie} | ${x.loss} |`);
  lines.push('', '## 질의별 nDCG@10', '', '| 질의 | 정답 수 | 이름 | BM25 | 임베딩 | BM25+임베딩 |', '| --- | --- | --- | --- | --- | --- |');
  for (const q of r.perQuery) {
    const n = q.ndcg10;
    lines.push(`| ${q.query} | ${q.relevant} | ${f2(n.name)} | ${f2(n.bm25)} | ${f2(n.embedding)} | ${f2(n.hybrid)} |`);
  }
  lines.push('', '## 질의별 상위 5곳 (✓ = 정답)', '');
  for (const q of r.perQuery) {
    lines.push(`### ${q.query}`, '');
    for (const m of METHODS) lines.push(`- ${LABEL[m]}: ${q.top5[m].join(' · ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function writeReport(r: EvalReport, dir = EVAL_DIR) {
  const file = join(dir, 'results.md');
  writeFileSync(file, reportMarkdown(r));
  return file;
}
