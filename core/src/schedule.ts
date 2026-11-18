// F1 컨디션 반영 일정 — 정해진 방문 순서를 시간표로 펼치면서
// 보행 한도·휴식 간격·식사 시각을 지키는지 계산하고, 순서 최적화에 쓸 비용을 냅니다.

import type { PlanDefaults } from './config.ts';
import { fmtMin, toMin } from './geo.ts';
import type { ConditionInput, Leg, Place, Stop } from './types.ts';

export interface SeqNode {
  type: 'visit' | 'meal' | 'rest';
  place: Place;
  mealLabel?: 'lunch' | 'dinner';
  /** 식사 목표 시각(분) */
  mealTime?: number;
  /** 아직 카페를 정하지 않은 휴식 자리 (최적화 단계) */
  virtual?: boolean;
  restInPlace?: boolean;
}

export interface TimelineCtx {
  origin: Place;
  start: number;
  end: number;
  returnToOrigin: boolean;
  cond: ConditionInput;
  restMin: number;
  legOf: (a: Place, b: Place) => Leg;
  d: PlanDefaults;
}

export interface Timeline {
  stops: Stop[];
  /** 휴식이 끼어든 최종 순서 */
  seq: SeqNode[];
  cost: number;
  travelMin: number;
  walkMin: number;
  taxiMin: number;
  idleMin: number;
  lateMin: number;
  overflowMin: number;
  restCount: number;
  endAt: number;
}

/** 카페까지 걸어가는 시간 가정(분) — 최적화 단계에서만 사용, 최종 일정은 실제 카페로 다시 계산 */
const VIRTUAL_REST_WALK = 3;

function virtualRestLeg(): Leg {
  return {
    mode: 'walk',
    minutes: VIRTUAL_REST_WALK,
    meters: 200,
    walkMinutes: VIRTUAL_REST_WALK,
    overLimit: false,
    walkSource: 'estimate',
  };
}

/**
 * 순서를 시간표로 펼칩니다.
 * autoRest=true 이면 '쉬는 간격'을 넘기 전에 휴식을 끼워 넣습니다(방문 직전에 판단).
 * 식사는 휴식으로 칩니다(활동 시간 초기화).
 */
export function runTimeline(nodes: SeqNode[], ctx: TimelineCtx, autoRest: boolean): Timeline {
  const { cond, d } = ctx;
  let t = ctx.start;
  let active = 0;
  let cur = ctx.origin;
  let travel = 0,
    walk = 0,
    taxi = 0,
    idle = 0,
    late = 0,
    rests = 0;
  const seq: SeqNode[] = [];
  const stops: Stop[] = [
    { type: 'start', place: ctx.origin, arrive: fmtMin(t), depart: fmtMin(t), stayMin: 0 },
  ];

  const addLeg = (leg: Leg) => {
    t += leg.minutes;
    travel += leg.minutes;
    if (leg.mode === 'walk') {
      walk += leg.minutes;
      active += leg.minutes;
    } else taxi += leg.minutes;
  };

  for (const node of nodes) {
    if (node.type === 'rest') {
      const leg = node.restInPlace ? null : ctx.legOf(cur, node.place);
      if (leg) addLeg(leg);
      const arrive = t;
      t += ctx.restMin;
      active = 0;
      rests++;
      stops.push({
        type: 'rest',
        place: node.place,
        arrive: fmtMin(arrive),
        depart: fmtMin(t),
        stayMin: ctx.restMin,
        legFromPrev: leg ?? undefined,
        restInPlace: node.restInPlace,
      });
      seq.push(node);
      cur = node.restInPlace ? cur : node.place;
      continue;
    }

    const isMeal = node.type === 'meal';
    const stay = isMeal ? d.mealMin : d.visitMin;
    let leg = ctx.legOf(cur, node.place);
    const walkPart = leg.mode === 'walk' ? leg.minutes : 0;

    if (autoRest && !isMeal && active > 0 && active + walkPart + stay > cond.restEveryMin) {
      const restNode: SeqNode = { type: 'rest', place: cur, virtual: true };
      const rLeg = virtualRestLeg();
      addLeg(rLeg);
      const arrive = t;
      t += ctx.restMin;
      active = 0;
      rests++;
      stops.push({
        type: 'rest',
        place: cur,
        arrive: fmtMin(arrive),
        depart: fmtMin(t),
        stayMin: ctx.restMin,
        legFromPrev: rLeg,
      });
      seq.push(restNode);
      leg = ctx.legOf(cur, node.place);
    }

    addLeg(leg);
    if (isMeal && node.mealTime != null) {
      const earliest = node.mealTime - d.mealEarlyTolerance;
      if (t < earliest) {
        // 식당에 너무 일찍 도착하게 되면, 앞 장소(또는 숙소)에서 그만큼 더 머물다 출발
        const wait = earliest - t;
        const prev = stops[stops.length - 1];
        prev.depart = fmtMin(toMin(prev.depart) + wait);
        if (prev.type !== 'start') prev.stayMin += wait;
        idle += wait;
        t = earliest;
      }
      late += Math.max(0, t - (node.mealTime + d.mealLateTolerance));
    }
    const begin = t;
    t += stay;
    active = isMeal ? 0 : active + stay;
    stops.push({
      type: isMeal ? 'meal' : 'visit',
      place: node.place,
      arrive: fmtMin(begin),
      depart: fmtMin(t),
      stayMin: stay,
      legFromPrev: leg,
      mealLabel: node.mealLabel,
    });
    seq.push(node);
    cur = node.place;
  }

  if (ctx.returnToOrigin) {
    const leg = ctx.legOf(cur, ctx.origin);
    addLeg(leg);
    stops.push({ type: 'end', place: ctx.origin, arrive: fmtMin(t), depart: fmtMin(t), stayMin: 0, legFromPrev: leg });
  }

  const overflow = Math.max(0, t - ctx.end);
  // 비용: 이동 시간이 주된 기준. 걷는 시간은 부모님께 더 부담이라 약간 더 무겁게,
  // 식사 전 대기(앞 장소에서 더 머묾)는 가볍게, 늦은 식사·종료 시각 초과에는 큰 벌점
  const cost = travel + walk * 0.2 + idle * 0.3 + late * 2 + overflow * 10;

  return {
    stops,
    seq,
    cost,
    travelMin: travel,
    walkMin: walk,
    taxiMin: taxi,
    idleMin: idle,
    lateMin: late,
    overflowMin: overflow,
    restCount: rests,
    endAt: t,
  };
}
