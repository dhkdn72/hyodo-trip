// 일정 결과가 나오기까지 서버가 하는 6단계 (기획안 8쪽)
// 1 후보 수집 → 2 접근성 필터 → 3 이동 시간 계산 → 4 순서 최적화 → 5 쉬는 곳 채우기 → 6 설명 붙이기

import { checkNeeds, stepFreeStatus, accessStatus } from './access.ts';
import { PLAN_DEFAULTS, type PlanDefaults } from './config.ts';
import { buildExplainContext, explanationIsGrounded } from './explain.ts';
import { centroid, haversine, parseDate, toMin } from './geo.ts';
import { optimizeOrder, type OptimizeResult } from './optimize.ts';
import { categoryCheck, prefScore, ruleFreeText, wantsRelaxed } from './prefs.ts';
import { runTimeline, type SeqNode, type TimelineCtx } from './schedule.ts';
import { TravelMatrix } from './travel.ts';
import type {
  DataSources,
  FreeTextRule,
  PipelineStep,
  Place,
  PlanRequest,
  PlanResult,
  Providers,
} from './types.ts';

export class PlanError extends Error {
  constructor(
    message: string,
    public code: 'NO_ATTRACTIONS' | 'BAD_TIME' | 'BAD_INPUT',
  ) {
    super(message);
  }
}

export interface PlanOptions {
  defaults?: Partial<PlanDefaults>;
}

const CAFE_NAME = /(카페|커피|cafe|coffee|베이커리|디저트|찻집|티하우스|빙수)/i;

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
const timer = () => {
  const t0 = now();
  return () => Math.round(now() - t0);
};

interface Scored {
  place: Place;
  score: number;
  matched: string[];
}

/** restDate 원문이 '매주 ○요일' 휴무를 말하는지 */
export function closedOn(restDate: string | undefined, weekday: string): boolean {
  if (!restDate) return false;
  const t = restDate.replace(/<[^>]+>/g, ' ');
  if (/(연중\s*무휴|휴무\s*없음|무휴)/.test(t)) return false;
  const segs = t.match(/매주\s*[월화수목금토일](요일)?(\s*[,·/및]\s*[월화수목금토일](요일)?)*/g);
  if (!segs) return false;
  return segs.some((s) => s.replace(/매주|요일/g, '').includes(weekday));
}

function dedupe(list: Place[]): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const p of list) {
    const k = p.id;
    const k2 = `${p.name}|${p.pos.lat.toFixed(4)}|${p.pos.lng.toFixed(4)}`;
    if (seen.has(k) || seen.has(k2)) continue;
    seen.add(k);
    seen.add(k2);
    out.push(p);
  }
  return out;
}

const normName = (s: string) => s.replace(/\[[^\]]*\]|\([^)]*\)|\s|·/g, '');

/**
 * 같은 곳으로 봐야 하는 장소 (덕수궁 ↔ 덕수궁 대한문, 같은 좌표에 등록된 하위 시설 등)
 *  - 60m 안이면 같은 곳
 *  - 600m 안이고 한쪽 이름이 다른 쪽 이름을 포함하면 같은 곳
 */
export function sameSpot(a: Place, b: Place): boolean {
  const d = haversine(a.pos, b.pos);
  if (d < 60) return true;
  if (d > 600) return false;
  const x = normName(a.name);
  const y = normName(b.name);
  return x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x));
}

function regionShort(name: string) {
  const first = name.split(/[\s·,]+/).filter(Boolean)[0];
  return first || name;
}

export async function planTrip(req: PlanRequest, providers: Providers, opts: PlanOptions = {}): Promise<PlanResult> {
  const d: PlanDefaults = { ...PLAN_DEFAULTS, ...opts.defaults };
  const { trip, condition: cond } = req;
  const prefs = req.prefs ?? null;
  const exclude = new Set(req.excludeIds ?? []);
  const include = new Set(req.includeIds ?? []);
  const pinned = req.pinnedMeals ?? {};
  const pipeline: PipelineStep[] = [];
  const warnings: string[] = [];
  const requestedRadius = Math.min(d.maxRadiusM, Math.max(300, Math.round(trip.radiusM ?? d.radiusM)));
  let radius = requestedRadius;
  const start = toMin(trip.startTime);
  const end = toMin(trip.endTime);
  if (!(end > start + 60)) throw new PlanError('일정 종료 시각은 시작보다 1시간 이상 뒤여야 해요.', 'BAD_TIME');
  const { weekday } = parseDate(trip.date);

  // 자유 입력 → 조건 (LLM, 실패하면 규칙)
  let rule: FreeTextRule | null = null;
  const freeText = prefs?.freeText?.trim();
  if (freeText) {
    rule = (await providers.parseFreeText?.(freeText).catch(() => null)) ?? ruleFreeText(freeText);
  }

  const pinnedIds = Object.values(pinned);
  const isForced = (p: Place) => include.has(p.id) || pinnedIds.includes(p.id);
  const baseScore = (p: Place, r: number) => {
    const dist = haversine(trip.center, p.pos);
    p.distFromCenter = Math.round(dist);
    return 1 - 0.3 * Math.min(1, dist / r) + (p.image ? 0.1 : 0) + categoryCheck(p).bonus;
  };

  /** 1 후보 수집 + 2 접근성 필터를 반경 r 로 한 번 수행 */
  const collect = async (r: number) => {
    const t1 = timer();
    const [attrRaw, restRaw] = await Promise.all([
      providers.searchPlaces(trip.center, r, 'attraction'),
      providers.searchPlaces(trip.center, r, 'restaurant'),
    ]);
    // 교통시설·주점·카페처럼 맞지 않는 분류는 처음부터 뺌 (사용자가 직접 넣은 곳은 유지)
    const allAttr = dedupe(attrRaw).filter((p) => include.has(p.id) || (!exclude.has(p.id) && !categoryCheck(p).excluded));
    const allRest = dedupe(restRaw).filter(
      (p) => pinnedIds.includes(p.id) || (!exclude.has(p.id) && !CAFE_NAME.test(p.name) && !categoryCheck(p).excluded),
    );
    const searchMs = t1();

    const t2 = timer();
    const prelim = (list: Place[]) =>
      list
        .map((p) => ({ place: p, score: baseScore(p, r) + prefScore(p, prefs, rule).bonus }))
        .sort((a, b) => b.score - a.score);
    const attrPool = prelim(allAttr)
      .filter((x, i) => i < 25 || isForced(x.place))
      .map((x) => x.place);
    const restPool = prelim(allRest)
      .filter((x, i) => i < 15 || isForced(x.place))
      .map((x) => x.place);
    await providers.attachAccessibility([...attrPool, ...restPool]).catch(() => undefined);
    if (providers.enrichDetails) {
      await providers.enrichDetails([...attrPool.slice(0, 12), ...restPool.slice(0, 10)]).catch(() => undefined);
    }

    let accessExcluded = 0;
    let prefExcluded = 0;
    const closedNames: string[] = [];
    const notes: string[] = [];
    const finalScore = (list: Place[]): Scored[] => {
      const out: Scored[] = [];
      for (const p of list) {
        const forced = isForced(p);
        const acc = checkNeeds(p, cond);
        if (acc.excluded && !forced) {
          accessExcluded++;
          continue;
        }
        const ps = prefScore(p, prefs, rule);
        if (ps.excluded && !forced) {
          prefExcluded++;
          continue;
        }
        if (closedOn(p.restDate, weekday)) {
          if (!forced) {
            closedNames.push(p.name);
            continue;
          }
          notes.push(`${p.name}은(는) ${weekday}요일 휴무로 안내돼 있어요. 방문 전에 꼭 확인해 주세요.`);
        }
        out.push({ place: p, score: baseScore(p, r) + ps.bonus + acc.bonus, matched: ps.matched });
      }
      return out.sort((a, b) => b.score - a.score);
    };
    const attrCands = finalScore(attrPool);
    const restCands = finalScore(restPool);
    return {
      attrRawN: attrRaw.length,
      restRawN: restRaw.length,
      attrCands,
      restCands,
      knownCount: [...attrPool, ...restPool].filter((p) => p.access?.known).length,
      accessExcluded,
      prefExcluded,
      closedNames,
      notes,
      searchMs,
      accessMs: t2(),
    };
  };

  let col = await collect(radius);
  let searchMs = col.searchMs;
  let accessMs = col.accessMs;
  // 후보가 모자라면 반경을 2배씩 넓혀 다시 찾음 (손으로 고친 일정은 넓히지 않음)
  const wantsMeal = !!(cond.lunchTime || cond.dinnerTime);
  const tooFew = (c: typeof col) =>
    c.attrCands.length < d.minAttractionCandidates || (wantsMeal && c.restCands.length < d.minRestaurantCandidates);
  for (let i = 0; i < d.radiusExpandSteps && !req.lockAttractions && radius < d.maxRadiusM && tooFew(col); i++) {
    radius = Math.min(d.maxRadiusM, radius * 2);
    col = await collect(radius);
    searchMs += col.searchMs;
    accessMs += col.accessMs;
  }
  const { attrCands, restCands, closedNames } = col;
  warnings.push(...col.notes);
  const km = (m: number) => `${Math.round(m / 100) / 10}km`;
  if (radius > requestedRadius) {
    warnings.push(`반경 ${km(requestedRadius)} 안에는 조건에 맞는 곳이 적어 ${km(radius)}까지 넓혀 찾았어요.`);
  }

  pipeline.push({
    key: 'collect',
    label: '후보 수집',
    ms: searchMs,
    detail: `반경 ${km(radius)}${radius > requestedRadius ? ` (${km(requestedRadius)}에서 넓힘)` : ''} · 관광지 ${col.attrRawN}곳 · 음식점 ${col.restRawN}곳`,
  });
  if (closedNames.length) {
    warnings.push(`${closedNames.slice(0, 3).join(', ')}${closedNames.length > 3 ? ' 등' : ''}은(는) ${weekday}요일 휴무라 뺐어요.`);
  }
  pipeline.push({
    key: 'access',
    label: '접근성 필터',
    ms: accessMs,
    detail: `무장애 정보 ${col.knownCount}곳 확인 · 조건에 안 맞는 ${col.accessExcluded}곳 제외${col.prefExcluded ? ` · 취향으로 ${col.prefExcluded}곳 제외` : ''}`,
  });

  if (!attrCands.length && !(req.lockAttractions && (req.includeIds?.length ?? 0) === 0)) {
    throw new PlanError(
      `반경 ${km(radius)} 안에서 조건에 맞는 관광지를 찾지 못했어요. 지역을 바꾸거나 필요한 시설 조건을 줄여 보세요.`,
      'NO_ATTRACTIONS',
    );
  }

  // ───── 3·4 이동 시간 계산 + 순서 최적화 ─────
  const origin: Place = { id: 'origin', source: 'user', kind: 'origin', name: trip.origin.name, pos: trip.origin.pos };
  const matrix = new TravelMatrix(providers, cond, d);
  const relaxed = wantsRelaxed(prefs);
  const restMin = relaxed ? d.restMinRelaxed : d.restMin;
  const ctx: TimelineCtx = {
    origin,
    start,
    end,
    returnToOrigin: trip.returnToOrigin,
    cond,
    restMin,
    legOf: (a, b) => matrix.legSync(a, b),
    d,
  };

  const meals: { label: 'lunch' | 'dinner'; time: number }[] = [];
  if (cond.lunchTime) {
    const t = toMin(cond.lunchTime);
    if (t >= start + 30 && t <= end - 60) meals.push({ label: 'lunch', time: t });
  }
  if (cond.dinnerTime) {
    const t = toMin(cond.dinnerTime);
    if (t >= start + 30 && t <= end - 60) meals.push({ label: 'dinner', time: t });
    else warnings.push('저녁 시간이 일정 안에 들어가지 않아 저녁은 넣지 않았어요.');
  }

  const forcedAttr = attrCands.filter((s) => include.has(s.place.id)).map((s) => s.place);
  const window = end - start;
  const perAttraction = d.visitMin + 15 + (restMin * (d.visitMin + 15)) / cond.restEveryMin;
  let K = Math.floor((window - meals.length * d.mealMin - 30) / perAttraction);
  if (relaxed) K -= 1;
  K = Math.max(d.minAttractions, Math.min(d.maxAttractions, K));
  K = Math.min(Math.max(K, forcedAttr.length), attrCands.length);

  // 가까운 곳끼리 묶되(1km 멀어질 때마다 -0.35), 고른 관심사 중 아직 안 들어간 것을 채우는 곳에 +0.5
  const matchedOf = new Map(attrCands.map((s) => [s.place.id, s.matched]));
  const clusterValue = (s: Scored, around: Place[]) => {
    const c = around.length ? centroid(around.map((p) => p.pos)) : trip.center;
    const covered = new Set(around.flatMap((p) => matchedOf.get(p.id) ?? []));
    const fresh = s.matched.some((m) => prefs?.interests.includes(m) && !covered.has(m)) ? 0.5 : 0;
    // 이미 채운 관심사를 또 채우는 곳은 가산점을 대부분 덜어 냄 (궁궐 두 곳보다 가까운 다른 곳)
    const repeat = s.matched.filter((m) => prefs?.interests.includes(m) && covered.has(m)).length * 0.6;
    return s.score + fresh - repeat - (0.35 * haversine(c, s.place.pos)) / 1000 - (0.1 * haversine(origin.pos, s.place.pos)) / 1000;
  };
  const nextNear = (selection: Place[]): Scored | null => {
    const pool = attrCands.filter((s) => !selection.some((p) => p.id === s.place.id || sameSpot(p, s.place)));
    if (!pool.length) return null;
    if (!selection.length) return pool[0];
    return pool.reduce((best, s) => (clusterValue(s, selection) > clusterValue(best, selection) ? s : best));
  };

  const locked = !!req.lockAttractions;
  let selection: Place[] = [...forcedAttr];
  while (!locked && selection.length < K) {
    const n = nextNear(selection);
    if (!n) break;
    selection.push(n.place);
  }

  let travelMs = 0;
  let optimizeMs = 0;
  let evaluated = 0;
  const restScore = new Map(restCands.map((s) => [s.place.id, s]));

  const solve = async (sel: Place[]) => {
    const c = sel.length ? centroid(sel.map((p) => p.pos)) : trip.center;
    const used = new Set<string>();
    const mealOptions = meals.map((m) => {
      const pinId = pinned[m.label];
      const pin = pinId ? restScore.get(pinId) : undefined;
      if (pin) {
        used.add(pin.place.id);
        return [pin.place];
      }
      const ranked = restCands
        .filter((s) => !used.has(s.place.id) && !Object.values(pinned).includes(s.place.id))
        .map((s) => ({ s, v: s.score - (0.6 * haversine(c, s.place.pos)) / 1000, d: haversine(c, s.place.pos) }))
        .sort((a, b) => b.v - a.v);
      // 고른 음식에 맞는 식당이 1.5km 안에 있으면 그 중에서만 고름
      const liked = prefs?.foods.length ? ranked.filter((x) => x.s.matched.some((m) => prefs.foods.includes(m)) && x.d <= 1500) : [];
      const opts = (liked.length ? liked : ranked).slice(0, d.restaurantOptions).map((x) => x.s.place);
      opts.forEach((p) => used.add(p.id));
      return opts;
    });

    const tTravel = timer();
    await matrix.prefetch([origin, ...sel, ...mealOptions.flat()]);
    travelMs += tTravel();

    const tOpt = timer();
    // 끼니별 식당 후보의 모든 조합 × 모든 순서
    let combos: Place[][] = [[]];
    mealOptions.forEach((opts) => {
      if (!opts.length) return;
      combos = combos.flatMap((cmb) => opts.map((o) => [...cmb, o]));
    });
    let best: (OptimizeResult & { restaurants: Place[] }) | null = null;
    for (const cmb of combos) {
      const nodes: SeqNode[] = [
        ...sel.map((p) => ({ type: 'visit' as const, place: p })),
        ...cmb.map((p, i) => {
          const meal = meals.filter((_, mi) => mealOptions[mi].length)[i];
          return { type: 'meal' as const, place: p, mealLabel: meal.label, mealTime: meal.time };
        }),
      ];
      const r = optimizeOrder(nodes, ctx);
      evaluated += r.evaluated;
      if (!best || r.timeline.cost < best.timeline.cost) best = { ...r, restaurants: cmb };
    }
    optimizeMs += tOpt();
    return best!;
  };

  let best = await solve(selection);
  const removable = () => selection.filter((p) => !include.has(p.id));
  for (let iter = 0; iter < 6 && !locked; iter++) {
    if (best.timeline.overflowMin > 0 && removable().length && selection.length > d.minAttractions) {
      // 종료 시각을 넘기면 점수가 가장 낮은 곳부터 뺌
      const scoreOf = (p: Place) => attrCands.find((s) => s.place.id === p.id)?.score ?? 0;
      const drop = removable().reduce((a, b) => (scoreOf(a) <= scoreOf(b) ? a : b));
      selection = selection.filter((p) => p.id !== drop.id);
      best = await solve(selection);
      continue;
    }
    const slack = end - best.timeline.endAt;
    if (best.timeline.overflowMin === 0 && slack >= d.visitMin + 25 && selection.length < d.maxAttractions) {
      // 시간이 남으면 근처 한 곳을 더 넣어 봄 (넘치면 되돌림)
      const n = nextNear(selection);
      if (n) {
        const trySel = [...selection, n.place];
        const tryBest = await solve(trySel);
        if (tryBest.timeline.overflowMin === 0) {
          selection = trySel;
          best = tryBest;
          continue;
        }
      }
    }
    break;
  }

  const nodeCount = selection.length + 1 + best.restaurants.length;
  pipeline.push({
    key: 'travel',
    label: '이동 시간 계산',
    ms: travelMs,
    detail: `${(nodeCount * (nodeCount - 1)) / 2}개 구간 · 도보 경로 ${matrix.apiCalls.walk}회 · 자동차 경로 ${matrix.apiCalls.drive}회 조회`,
  });
  pipeline.push({
    key: 'optimize',
    label: '순서 최적화',
    ms: optimizeMs,
    detail: `${evaluated.toLocaleString('ko-KR')}가지 순서 비교`,
  });

  // ───── 5 쉬는 곳 채우기 ─────
  let stopT = timer();
  const usedCafes = new Set<string>();
  let cafesFound = 0;
  const finalSeq: SeqNode[] = [];
  for (const node of best.timeline.seq) {
    if (node.type === 'rest' && node.virtual) {
      const anchor = node.place;
      const cafes = await providers.nearbyCafes(anchor.pos, d.cafeRadiusM).catch(() => [] as Place[]);
      const cafe = cafes.find((c) => !usedCafes.has(c.id));
      if (cafe) {
        usedCafes.add(cafe.id);
        cafesFound++;
        finalSeq.push({ type: 'rest', place: cafe });
      } else {
        finalSeq.push({ type: 'rest', place: anchor, restInPlace: true });
      }
    } else finalSeq.push(node);
  }
  // 새로 생긴 구간(장소↔카페)만 추가로 계산
  {
    let prev: Place = origin;
    for (const n of finalSeq) {
      if (!(n.type === 'rest' && n.restInPlace)) {
        await matrix.leg(prev, n.place);
        prev = n.place;
      }
    }
    if (trip.returnToOrigin) await matrix.leg(prev, origin);
  }
  const finalTl = runTimeline(finalSeq, ctx, false);
  const restCount = finalTl.restCount;
  pipeline.push({
    key: 'rest',
    label: '쉬는 곳 채우기',
    ms: stopT(),
    detail: restCount ? `휴식 ${restCount}번 · 근처 카페 ${cafesFound}곳` : '휴식 없이 식사로 충분해요',
  });

  // ───── 경고 ─────
  const stops = finalTl.stops;
  stops.forEach((s, i) => {
    const leg = s.legFromPrev;
    if (leg?.overLimit && leg.mode === 'taxi') {
      const from = stops[i - 1]?.place.name ?? '';
      warnings.push(`${from} → ${s.place.name}: 걸으면 ${leg.walkMinutes}분이라 택시(약 ${leg.driveMinutes ?? leg.minutes}분)로 바꿨어요.`);
    }
  });
  if (finalTl.overflowMin > 0) {
    warnings.push(`종료 시각보다 ${finalTl.overflowMin}분 늦게 끝나요. 장소를 하나 빼면 여유가 생겨요.`);
  }
  {
    const placesInPlan = stops.filter((s) => s.type === 'visit' || s.type === 'meal').map((s) => s.place);
    const say = (label: string, names: string[]) =>
      names.length && warnings.push(`${names.join(', ')}은(는) ${label} 정보가 없어요. 방문 전에 전화로 확인해 주세요.`);
    if (cond.needs.stepFree) say('엘리베이터·경사로', placesInPlan.filter((p) => stepFreeStatus(p) === 'unknown').map((p) => p.name));
    if (cond.needs.parking) say('주차', placesInPlan.filter((p) => accessStatus(p, 'parking') === 'unknown').map((p) => p.name));
  }
  if (meals.length && !best.restaurants.length) warnings.push('근처에서 조건에 맞는 식당을 찾지 못해 식사를 넣지 못했어요.');

  // ───── 6 설명 붙이기 ─────
  stopT = timer();
  const ex = buildExplainContext(stops, cond, origin.name);
  let explanation = ex.template;
  let explainSrc: DataSources['explain'] = 'template';
  if (providers.explain) {
    const text = await providers.explain(ex).catch(() => null);
    if (text && explanationIsGrounded(text, ex.allowedNumbers)) {
      explanation = text.trim();
      explainSrc = 'llm';
    }
  }
  pipeline.push({
    key: 'explain',
    label: '설명 붙이기',
    ms: stopT(),
    detail: explainSrc === 'llm' ? 'LLM이 계산 결과를 문장으로 정리' : '템플릿 문장 (LLM 키 없음 또는 검증 실패)',
  });

  // ───── 바꾸기 후보 ─────
  const chosenIds = new Set(stops.map((s) => s.place.id));
  const alternatives = {
    attractions: attrCands
      .filter((s) => !chosenIds.has(s.place.id) && !selection.some((p) => sameSpot(p, s.place)))
      .sort((a, b) => clusterValue(b, selection) - clusterValue(a, selection))
      .slice(0, 8)
      .map((s) => s.place),
    restaurants: restCands
      .filter((s) => !chosenIds.has(s.place.id))
      .slice(0, 6)
      .map((s) => s.place),
  };

  const walkSources = matrix.sourcesUsed.walk;
  const driveSources = matrix.sourcesUsed.drive;
  const mix = (s: Set<string>) => (s.size === 0 ? 'none' : s.size > 1 ? 'mixed' : ([...s][0] as 'kakao' | 'estimate'));
  const taxiLegs = stops.filter((s) => s.legFromPrev?.mode === 'taxi').length;
  const walkLegs = stops.filter((s) => s.legFromPrev?.mode === 'walk');

  return {
    title: `부모님 ${regionShort(trip.regionName)} 나들이`,
    date: trip.date,
    trip,
    radiusM: radius,
    requestedRadiusM: requestedRadius,
    condition: cond,
    stops,
    summary: {
      totalTravelMin: finalTl.travelMin,
      totalWalkMin: finalTl.walkMin,
      totalTaxiMin: finalTl.taxiMin,
      longestWalkMin: walkLegs.reduce((m, s) => Math.max(m, s.legFromPrev!.minutes), 0),
      taxiLegs,
      restCount,
      visitCount: stops.filter((s) => s.type === 'visit').length,
      endsAt: stops[stops.length - 1].depart,
      overflowMin: finalTl.overflowMin,
    },
    explanation,
    warnings,
    alternatives,
    dataSources: {
      places: providers.sources.places,
      access: providers.sources.access,
      walk: mix(walkSources) === 'none' ? providers.sources.walk : (mix(walkSources) as DataSources['walk']),
      taxi: taxiLegs ? (mix(driveSources) as DataSources['taxi']) : 'none',
      cafes: cafesFound ? providers.sources.cafes : 'none',
      explain: explainSrc,
      freeText: rule?.source,
    },
    pipeline,
    freeTextRule: rule,
  };
}
