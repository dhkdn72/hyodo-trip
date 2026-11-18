// 4 순서 최적화 (F2) — 보행 한도를 지키며 이동이 가장 적은 순서를 찾습니다.
// 하루 방문지는 많아야 7곳(관광지 5 + 식사 2)이라 모든 순서를 다 따져 봐도(7! = 5,040) 금방 끝납니다.
// 그보다 많으면 가까운 곳부터 잇고 2-opt 로 다듬습니다.

import { runTimeline, type SeqNode, type Timeline, type TimelineCtx } from './schedule.ts';

const EXHAUSTIVE_LIMIT = 8;

function* permutations<T>(arr: T[]): Generator<T[]> {
  // Heap's algorithm (반복형)
  const a = arr.slice();
  const n = a.length;
  const c = new Array(n).fill(0);
  yield a.slice();
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const j = i % 2 === 0 ? 0 : c[i];
      [a[j], a[i]] = [a[i], a[j]];
      yield a.slice();
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

function heuristicOrder(nodes: SeqNode[], ctx: TimelineCtx): SeqNode[] {
  // 가까운 곳부터 (식사는 목표 시각 근처에 오도록 비용 함수가 조정)
  const rest = nodes.slice();
  const out: SeqNode[] = [];
  let cur = ctx.origin;
  while (rest.length) {
    let bi = 0;
    let bv = Infinity;
    rest.forEach((n, i) => {
      const v = ctx.legOf(cur, n.place).minutes;
      if (v < bv) {
        bv = v;
        bi = i;
      }
    });
    const [n] = rest.splice(bi, 1);
    out.push(n);
    cur = n.place;
  }
  // 2-opt
  let best = runTimeline(out, ctx, true);
  let improved = true;
  let order = out;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const cand = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        const tl = runTimeline(cand, ctx, true);
        if (tl.cost + 1e-9 < best.cost) {
          best = tl;
          order = cand;
          improved = true;
        }
      }
    }
  }
  return order;
}

export interface OptimizeResult {
  order: SeqNode[];
  timeline: Timeline;
  evaluated: number;
}

export function optimizeOrder(nodes: SeqNode[], ctx: TimelineCtx): OptimizeResult {
  if (nodes.length === 0) {
    return { order: [], timeline: runTimeline([], ctx, true), evaluated: 1 };
  }
  if (nodes.length > EXHAUSTIVE_LIMIT) {
    const order = heuristicOrder(nodes, ctx);
    return { order, timeline: runTimeline(order, ctx, true), evaluated: -1 };
  }
  let best: Timeline | null = null;
  let bestOrder: SeqNode[] = nodes;
  let count = 0;
  for (const perm of permutations(nodes)) {
    count++;
    const tl = runTimeline(perm, ctx, true);
    if (!best || tl.cost < best.cost - 1e-9) {
      best = tl;
      bestOrder = perm;
    }
  }
  return { order: bestOrder, timeline: best!, evaluated: count };
}
