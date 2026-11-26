// 추천 평가용 도구 — 순위 지표와 비교 기준(키워드·BM25)
//  · P@k  : 위에서 k개 중 정답 비율
//  · R@k  : 정답 중 위 k개 안에 들어온 비율
//  · nDCG@k : 정답이 위에 있을수록 높은 점수 (1이 최고)
//  · MRR  : 첫 정답 순위의 역수 평균

export interface RankMetrics {
  p5: number;
  r10: number;
  ndcg10: number;
  rr: number;
}

export function rankMetrics(ranking: string[], relevant: Set<string>): RankMetrics {
  const hit = (i: number) => (relevant.has(ranking[i]) ? 1 : 0);
  let h5 = 0;
  for (let i = 0; i < Math.min(5, ranking.length); i++) h5 += hit(i);
  let h10 = 0;
  let dcg = 0;
  for (let i = 0; i < Math.min(10, ranking.length); i++) {
    h10 += hit(i);
    dcg += hit(i) / Math.log2(i + 2);
  }
  let idcg = 0;
  for (let i = 0; i < Math.min(10, relevant.size); i++) idcg += 1 / Math.log2(i + 2);
  const first = ranking.findIndex((id) => relevant.has(id));
  return {
    p5: h5 / 5,
    r10: relevant.size ? h10 / relevant.size : 0,
    ndcg10: idcg ? dcg / idcg : 0,
    rr: first >= 0 ? 1 / (first + 1) : 0,
  };
}

export function meanMetrics(list: RankMetrics[]): RankMetrics {
  const n = list.length || 1;
  const sum = (k: keyof RankMetrics) => list.reduce((s, m) => s + m[k], 0) / n;
  return { p5: sum('p5'), r10: sum('r10'), ndcg10: sum('ndcg10'), rr: sum('rr') };
}

/** 점수 → 순위 (점수가 같으면 원래 순서 = 지역 중심에서 가까운 순) */
export function rankBy(ids: string[], score: (id: string) => number): string[] {
  return ids
    .map((id, i) => ({ id, i, s: score(id) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.id);
}

/** 지금 앱의 '기타' 방식에 가까운 기준: 입력을 낱말(두 글자 이상)로 나눠 장소 이름에 들어 있는 낱말 수 */
export function nameKeywordScore(query: string, name: string): number {
  const words = [...new Set(query.split(/[\s,，、/·]+/).filter((w) => w.length >= 2))];
  return words.filter((w) => name.includes(w)).length;
}

/** 한글은 띄어쓰기·조사 때문에 낱말이 잘 안 맞아 글자 2개씩(bigram) 끊어 BM25 */
export function bigrams(s: string): string[] {
  const t = s.replace(/[^가-힣A-Za-z0-9]+/g, ' ').trim();
  const out: string[] = [];
  for (const w of t.split(/\s+/)) {
    if (w.length === 1) out.push(w);
    for (let i = 0; i + 2 <= w.length; i++) out.push(w.slice(i, i + 2));
  }
  return out;
}

/** BM25 (k1=1.2, b=0.75) — 소개글까지 보는 강한 키워드 기준선 */
export function bm25Scorer(docs: Map<string, string>) {
  const k1 = 1.2;
  const b = 0.75;
  const tf = new Map<string, Map<string, number>>();
  const df = new Map<string, number>();
  let total = 0;
  for (const [id, text] of docs) {
    const counts = new Map<string, number>();
    const toks = bigrams(text);
    total += toks.length;
    for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);
    tf.set(id, counts);
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = docs.size || 1;
  const avgdl = total / N || 1;
  const len = new Map([...tf].map(([id, c]) => [id, [...c.values()].reduce((a, x) => a + x, 0)]));
  return (query: string, id: string): number => {
    const c = tf.get(id);
    if (!c) return 0;
    const dl = len.get(id) ?? 0;
    let s = 0;
    for (const q of new Set(bigrams(query))) {
      const f = c.get(q) ?? 0;
      if (!f) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * dl) / avgdl));
    }
    return s;
  };
}
