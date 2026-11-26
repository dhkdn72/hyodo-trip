// F4 의미 기반 추천 — 문장 임베딩 모델로 '취향 문장'과 '장소 소개글'이 얼마나 비슷한지 점수를 냅니다.
//
//  키워드 규칙은 이름·메뉴에 그 단어가 있어야만 찾습니다 ('성당'을 적으면 이름에 '성당'이 든 곳만).
//  임베딩은 문장을 벡터로 바꿔 뜻이 가까운지 봅니다 — "조용히 걷기 좋은 곳" ↔ "숲길과 연못이 있는 정원".
//
//  모델 실행(서버)은 Providers.semantic 이 맡고, 여기서는 모델에 넣을 문장과 점수 반영 규칙만 정합니다.
//   - 질의: 고른 취향마다 한 문장 (+ 기타 입력, 자유 입력의 '좋아하는' 부분). 장소 점수는 질의들 중 가장 비슷한 값
//   - 부정문('시끄러운 곳은 싫어')은 임베딩이 오히려 시끄러운 곳을 가깝게 볼 수 있어 질의에 넣지 않고 규칙(피하기)으로만 씀
//   - 후보 안에서 유사도를 표준화(z)해 가산점으로 더함 → 규칙 점수와 함께 쓰는 하이브리드

import type { FreeTextRule, Place, PrefInput } from './types.ts';

/** 취향 항목 → 모델에 넣을 설명 문장 */
export const QUERY_HINTS: Record<string, string> = {
  궁궐: '조선 왕실의 궁궐과 고궁',
  미술관: '미술관과 박물관 전시 관람',
  한옥: '전통 한옥과 옛 마을',
  공원: '공원과 정원, 나무와 꽃이 있는 자연',
  시장: '전통시장 구경과 먹거리',
  바다: '바다와 해변 풍경',
  사찰: '절과 사찰, 불교 문화',
  전통체험: '전통문화와 공예 체험',
  온천: '온천과 스파에서 휴식',
  '구경하며 쉬기': '천천히 구경하며 쉴 수 있는 곳',
  사진: '사진 찍기 좋은 풍경과 경치',
  산책: '걷기 좋은 산책로와 길',
  쇼핑: '쇼핑과 기념품 구경',
  '공연 관람': '공연장에서 공연 관람',
};

/** 부정 표현이 있으면 자유 입력 원문을 질의로 쓰지 않음 */
const NEGATION = /(싫|않|안\s|못|말고|빼|피해|피하|별로|힘들|어려|불편)/;

/** 관광지 추천에 쓸 질의 문장들 (없으면 빈 배열 → 임베딩 단계 생략) */
export function semanticQueries(prefs: PrefInput | null | undefined, rule: FreeTextRule | null | undefined): string[] {
  if (!prefs) return [];
  const out: string[] = [];
  for (const k of [...prefs.interests, ...prefs.activities]) {
    if (k === '맛집 탐방') continue; // 식당 쪽 취향
    out.push(QUERY_HINTS[k] ?? k); // 목록에 없는 말(기타 입력)은 그대로
  }
  const free = prefs.freeText?.trim();
  if (free) {
    if (!NEGATION.test(free)) out.push(free);
    else if (rule?.prefer.length) out.push(rule.prefer.join(', '));
  }
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))].slice(0, 8);
}

/** 모델이 읽는 장소 문장: 이름 + 분류 + 소개글 앞부분 */
export function placeText(p: Pick<Place, 'name'>, catPath?: string, overview?: string): string {
  const ov = (overview ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return [p.name, catPath, ov].filter(Boolean).join('. ');
}

/** 값들을 표준화(평균 0, 표준편차 1). 값이 모두 같으면 0 */
export function zscores(values: Map<string, number>): Map<string, number> {
  const v = [...values.values()];
  if (!v.length) return new Map();
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return new Map([...values].map(([k, x]) => [k, sd > 1e-9 ? (x - mean) / sd : 0]));
}

/** 의미 유사도 가산점: 후보 평균보다 1σ 높으면 +0.4 (규칙 매칭 한 개 ≈ +0.6~1.0 과 비슷한 크기) */
export const SEMANTIC_WEIGHT = 0.4;
export function semanticBonus(z: number): number {
  return SEMANTIC_WEIGHT * Math.max(-1.5, Math.min(2, z));
}

/** 이 정도 이상이면 화면에 '소개글이 취향과 비슷' 이유로 보여 줌 */
export const SEMANTIC_REASON_Z = 1;

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
