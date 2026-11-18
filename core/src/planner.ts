// 일정 결과가 나오기까지 서버가 하는 6단계 (기획안 8쪽)
// 1 후보 수집 → 2 접근성 필터 → 3 이동 시간 계산 → 4 순서 최적화 → 5 쉬는 곳 채우기 → 6 설명 붙이기

import { checkNeeds, stepFreeStatus, accessStatus } from './access.ts';
import { PLAN_DEFAULTS, type PlanDefaults } from './config.ts';
import { buildExplainContext, explanationIsGrounded } from './explain.ts';
import { centroid, haversine, parseDate, toMin } from './geo.ts';
import { optimizeOrder, type OptimizeResult } from './optimize.ts';
import { prefScore, ruleFreeText, wantsRelaxed } from './prefs.ts';
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
  const radius = trip.radiusM ?? d.radiusM;
  const start = toMin(trip.startTime);
  const end = toMin(trip.endTime);
  if (!(end > start + 60)) throw new PlanError('일정 종료 시각은 시작보다 1시간 이상 뒤여야 해요.', 'BAD_TIME');
  const { weekday } = parseDate(trip.date);

  // ───── 1 후보 수집 ─────
  let stopT = timer();
  const [attrRaw, restRaw] = await Promise.all([
    providers.searchPlaces(trip.center, radius, 'attraction'),
    providers.searchPlaces(trip.center, radius, 'restaurant'),
  ]);
  const allAttr = dedupe(attrRaw).filter((p) => !exclude.has(p.id) || include.has(p.id));
  const allRest = dedupe(restRaw).filter(
    (p) => (!exclude.has(p.id) || Object.values(pinned).includes(p.id)) && !CAFE_NAME.test(p.name),
  );
  pipeline.push({
    key: 'collect',
    label: '후보 수집',
    ms: stopT(),
    detail: `관광지 ${attrRaw.length}곳 · 음식점 ${restRaw.length}곳`,
  });

  // 자유 입력 → 조건 (LLM, 실패하면 규칙)
  let rule: FreeTextRule | null = null;
  const freeText = prefs?.freeText?.trim();
  if (freeText) {
    rule = (await providers.parseFreeText?.(freeText).catch(() => null)) ?? ruleFreeText(freeText);
  }

  const baseScore = (p: Place) => {
    const dist = haversine(trip.center, p.pos);
    p.distFromCenter = Math.round(dist);
    return 1 - 0.3 * Math.min(1, dist / radius) + (p.image ? 0.1 : 0);
  };
  const prelim = (list: Place[]) =>
    list
      .map((p) => ({ place: p, score: baseScore(p) + prefScore(p, prefs, rule).bonus }))
      .sort((a, b) => b.score - a.score);

  // ───── 2 접근성 필터 ─────
  stopT = timer();
  const isForced = (p: Place) => include.has(p.id) || Object.values(pinned).includes(p.id);
  const attrPool = prelim(allAttr)
    .filter((s, i) => i < 25 || isForced(s.place))
    .map((s) => s.place);
  const restPool = prelim(allRest)
    .filter((s, i) => i < 15 || isForced(s.place))
    .map((s) => s.place);
  await providers.attachAccessibility([...attrPool, ...restPool]).catch(() => undefined);
  if (providers.enrichDetails) {
    await providers.enrichDetails([...attrPool.slice(0, 12), ...restPool.slice(0, 10)]).catch(() => undefined);
  }

  let accessExcluded = 0;
  let prefExcluded = 0;
  const closedNames: string[] = [];
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
        warnings.push(`${p.name}은(는) ${weekday}요일 휴무로 안내돼 있어요. 방문 전에 꼭 확인해 주세요.`);
      }
      out.push({ place: p, score: baseScore(p) + ps.bonus + acc.bonus, matched: ps.matched });
    }
    return out.sort((a, b) => b.score - a.score);
  };
  const attrCands = finalScore(attrPool);
  const restCands = finalScore(restPool);
  const knownCount = [...attrPool, ...restPool].filter((p) => p.access?.known).length;
  if (closedNames.length) {
    warnings.push(`${closedNames.slice(0, 3).join(', ')}${closedNames.length > 3 ? ' 등' : ''}은(는) ${weekday}요일 휴무라 뺐어요.`);
  }
  pipeline.push({
    key: 'access',
    label: '접근성 필터',
    ms: stopT(),
    detail: `무장애 정보 ${knownCount}곳 확인 · 조건에 안 맞는 ${accessExcluded}곳 제외${prefExcluded ? ` · 취향으로 ${prefExcluded}곳 제외` : ''}`,
  });

  if (!attrCands.length && !(req.lockAttractions && (req.includeIds?.length ?? 0) === 0)) {
    throw new PlanError('조건에 맞는 관광지를 찾지 못했어요. 지역을 넓히거나 필요한 시설 조건을 줄여 보세요.', 'NO_ATTRACTIONS');
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
    return s.score + fresh - (0.35 * haversine(c, s.place.pos)) / 1000 - (0.1 * haversine(origin.pos, s.place.pos)) / 1000;
  };
  const nextNear = (selection: Place[]): Scored | null => {
    const pool = attrCands.filter((s) => !selection.some((p) => p.id === s.place.id));
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
  stopT = timer();
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
      warnings.push(`${from} → ${s.place.name}: 걸으면 ${leg.walkMinutes}분이라 택시(${leg.minutes}분)로 바꿨어요.`);
    }
  });
  if (finalTl.overflowMin > 0) {
    warnings.push(`종료 시각보다 ${finalTl.overflowMin}분 늦게 끝나요. 장소를 하나 빼면 여유가 생겨요.`);
  }
  if (cond.needs.stepFree || cond.needs.parking) {
    const unknown = stops
      .filter((s) => s.type === 'visit' || s.type === 'meal')
      .filter((s) => (cond.needs.stepFree && stepFreeStatus(s.place) === 'unknown') || (cond.needs.parking && accessStatus(s.place, 'parking') === 'unknown'))
      .map((s) => s.place.name);
    if (unknown.length) warnings.push(`${unknown.join(', ')}은(는) 무장애 정보가 없어요. 방문 전에 전화로 확인해 주세요.`);
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
      .filter((s) => !chosenIds.has(s.place.id))
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
