// 여러 날 일정 (1박 2일 · 2박 3일) — 숙소를 정하고 날마다 planTrip 을 돌립니다.
//  1일차: 출발 장소 → … → 숙소
//  가운데 날: 숙소 → … → 숙소
//  마지막 날: 숙소 → … → 출발 장소 (돌아오기를 골랐을 때)
// 앞선 날에 간 관광지·식당·휴식 카페는 다음 날 후보에서 뺍니다.

import { accessStatus, checkNeeds, stepFreeStatus } from './access.ts';
import { PLAN_DEFAULTS, type PlanDefaults } from './config.ts';
import { haversine } from './geo.ts';
import { planTrip, PlanError, sameSpot, type PlanOptions } from './planner.ts';
import type { Place, PlanRequest, PlanResult, Providers, TripPlan } from './types.ts';

/**
 * 숙소 분류 (TourAPI 신분류 AC, lclsSystmCode2 로 확인)
 *  AC010100 호텔 · AC020100 콘도 · AC020200 레지던스 · AC030100 펜션 · AC030200 한옥스테이
 *  AC030300 농어촌민박 · AC030400 홈스테이 · AC040100 모텔 · AC05 캠핑류 · AC060100 유스호스텔 · AC060200 게스트하우스
 * 부모님과 묵기 어려운 캠핑·유스호스텔·게스트하우스(공용 시설)는 뺍니다.
 */
const LODGING_EXCLUDE = ['AC05', 'AC06'];
const LODGING_BONUS: [string, number][] = [
  ['AC0101', 0.3],
  ['AC0201', 0.3],
  ['AC0202', 0.25],
  ['AC0302', 0.25],
  ['AC0301', 0.1],
  ['AC0303', 0.05],
  ['AC0401', -0.2],
];
const LODGING_EXCLUDE_NAME = /(게스트\s*하우스|게하|호스텔|캠핑|글램핑|카라반|야영)/i;

export function lodgingCheck(p: Place): { excluded: boolean; bonus: number } {
  if (p.lcls?.some((c) => LODGING_EXCLUDE.some((x) => c.startsWith(x))) || LODGING_EXCLUDE_NAME.test(p.name)) {
    return { excluded: true, bonus: 0 };
  }
  const code = p.lcls?.[2] ?? p.lcls?.[1] ?? '';
  const hit = LODGING_BONUS.find(([pre]) => code.startsWith(pre));
  return { excluded: false, bonus: hit ? hit[1] : 0 };
}

/** 'YYYY-MM-DD' + n일 */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

interface LodgingPick {
  lodging: Place | null;
  source: TripPlan['lodgingSource'];
  alternatives: Place[];
  note?: string;
}

/** 숙소 정하기: 사용자가 정했으면 그대로, 아니면 지역 중심 가까이·조건에 맞는 숙소를 추천 */
export async function pickLodging(req: PlanRequest, providers: Providers, d: PlanDefaults): Promise<LodgingPick> {
  const { trip, condition: cond } = req;
  const given = req.lodging ?? null;
  if (given && !given.recommended) {
    return {
      lodging: { id: given.id ?? 'user:lodging', source: 'user', kind: 'lodging', name: given.name, pos: given.pos },
      source: 'user',
      alternatives: [],
    };
  }

  let r = Math.min(d.maxRadiusM, Math.max(300, trip.radiusM ?? d.radiusM));
  let scored: { p: Place; v: number }[] = [];
  for (let step = 0; step <= d.radiusExpandSteps; step++) {
    const raw = await providers.searchPlaces(trip.center, r, 'lodging').catch(() => [] as Place[]);
    const pool = raw
      .map((p) => ({ ...p, kind: 'lodging' as const }))
      .filter((p) => !lodgingCheck(p).excluded)
      .sort((a, b) => haversine(trip.center, a.pos) - haversine(trip.center, b.pos))
      .slice(0, 25);
    await providers.attachAccessibility(pool).catch(() => undefined);
    scored = [];
    for (const p of pool) {
      const acc = checkNeeds(p, cond);
      if (acc.excluded && p.id !== given?.id) continue;
      const dist = haversine(trip.center, p.pos);
      p.distFromCenter = Math.round(dist);
      const v = 1 - 0.4 * Math.min(1, dist / r) + lodgingCheck(p).bonus + (p.image ? 0.1 : 0) + acc.bonus;
      scored.push({ p, v });
    }
    if (scored.length >= 3 || r >= d.maxRadiusM) break;
    r = Math.min(d.maxRadiusM, r * 2);
  }
  scored.sort((a, b) => b.v - a.v);

  // 추천받은 숙소를 유지하는 경우 (화면 ④에서 고칠 때)
  if (given?.recommended) {
    const keep = scored.find((x) => x.p.id === given.id)?.p ?? {
      id: given.id ?? 'user:lodging',
      source: 'user' as const,
      kind: 'lodging' as const,
      name: given.name,
      pos: given.pos,
    };
    return {
      lodging: keep,
      source: 'recommended',
      alternatives: scored.filter((x) => x.p.id !== keep.id).slice(0, 5).map((x) => x.p),
    };
  }
  if (!scored.length) {
    return {
      lodging: null,
      source: 'none',
      alternatives: [],
      note: '조건에 맞는 숙소를 찾지 못해 날마다 출발 장소에서 시작하고 끝나게 짰어요. 숙소를 직접 정하면 그 숙소 기준으로 다시 짜요.',
    };
  }
  return { lodging: scored[0].p, source: 'recommended', alternatives: scored.slice(1, 6).map((x) => x.p) };
}

/** 당일치기 또는 여러 날 일정. /api/plan 은 항상 이 결과(TripPlan)를 돌려줍니다 */
export async function planJourney(req: PlanRequest, providers: Providers, opts: PlanOptions = {}): Promise<TripPlan> {
  const d: PlanDefaults = { ...PLAN_DEFAULTS, ...opts.defaults };
  const nights = Math.max(0, Math.min(2, Math.round(req.nights ?? 0)));
  const region = req.trip.regionName.split(/[\s·,]+/).filter(Boolean)[0] || req.trip.regionName;

  if (nights === 0) {
    const day = await planTrip(req, providers, opts);
    return { title: day.title, nights: 0, days: [day], lodging: null, lodgingSource: 'none', lodgingAlternatives: [], radiusM: day.radiusM, warnings: [] };
  }

  const warnings: string[] = [];
  const pick = await pickLodging(req, providers, d);
  if (pick.note) warnings.push(pick.note);
  const lodging = pick.lodging;
  if (lodging && lodging.source !== 'user') {
    const cond = req.condition;
    if (cond.needs.stepFree && stepFreeStatus(lodging) === 'unknown')
      warnings.push(`숙소 ${lodging.name}은(는) 엘리베이터·경사로 정보가 없어요. 예약 전에 확인해 주세요.`);
    if (cond.needs.parking && accessStatus(lodging, 'parking') === 'unknown')
      warnings.push(`숙소 ${lodging.name}은(는) 주차 정보가 없어요. 예약 전에 확인해 주세요.`);
  }
  const base = lodging ? { name: lodging.name, pos: lodging.pos, isLodging: true } : null;

  const days: PlanResult[] = [];
  const used: Place[] = [];
  const usedCafeIds = new Set<string>();
  let radius = req.trip.radiusM ?? d.radiusM;

  for (let i = 0; i <= nights; i++) {
    const last = i === nights;
    const adj = req.days?.[i] ?? {};
    const dayReq: PlanRequest = {
      ...req,
      trip: {
        ...req.trip,
        date: addDays(req.trip.date, i),
        origin: i === 0 || !base ? req.trip.origin : base,
        endPlace: !last && base ? base : req.trip.origin,
        returnToOrigin: !last ? true : req.trip.returnToOrigin,
        radiusM: radius,
      },
      includeIds: adj.includeIds ?? (i === 0 ? req.includeIds : []),
      pinnedMeals: adj.pinnedMeals ?? (i === 0 ? req.pinnedMeals : {}),
      lockAttractions: adj.lockAttractions ?? (i === 0 ? req.lockAttractions : false),
      nights: 0,
      days: undefined,
    };
    let day: PlanResult;
    try {
      day = await planTrip(dayReq, providers, { ...opts, avoidPlaces: used, usedCafeIds });
    } catch (e) {
      if (!(e instanceof PlanError) || e.code !== 'NO_ATTRACTIONS' || i === 0) throw e;
      // 새로 갈 곳이 모자라면 다른 날 간 곳도 다시 후보로
      day = await planTrip(dayReq, providers, { ...opts, usedCafeIds });
      day.warnings.unshift('새로 갈 만한 곳이 모자라 다른 날 간 곳이 다시 들어갔을 수 있어요.');
    }
    day.title = `${i + 1}일차`;
    days.push(day);
    radius = Math.max(radius, day.radiusM);
    for (const s of day.stops) if (s.type === 'visit' || s.type === 'meal') used.push(s.place);
  }

  // 바꾸기 후보에서 다른 날에 들어간 곳은 뺌
  for (const day of days) {
    day.alternatives.attractions = day.alternatives.attractions.filter((p) => !used.some((u) => u.id === p.id || sameSpot(u, p)));
    day.alternatives.restaurants = day.alternatives.restaurants.filter((p) => !used.some((u) => u.id === p.id));
  }

  return {
    title: `부모님 ${region} ${nights}박 ${nights + 1}일`,
    nights,
    days,
    lodging,
    lodgingSource: pick.source,
    lodgingAlternatives: pick.alternatives,
    radiusM: radius,
    warnings,
  };
}
