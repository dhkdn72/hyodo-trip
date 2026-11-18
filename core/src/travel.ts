// 3 이동 시간 계산 — 도보는 '편안한 길' 기준, 보행 한도를 넘으면 택시로 바꿔 제안 (F1·F2)

import { PLAN_DEFAULTS } from './config.ts';
import { haversine } from './geo.ts';
import type { ConditionInput, LatLng, Leg, Place, Providers, RawRoute } from './types.ts';

/** API 없이 직선거리로 추정한 도보 경로 */
export function estimateWalk(a: LatLng, b: LatLng, d = PLAN_DEFAULTS): RawRoute {
  const meters = haversine(a, b) * d.walkDetour;
  return { meters, seconds: (meters / d.walkMetersPerMin) * 60, source: 'estimate' };
}

/** API 없이 직선거리로 추정한 자동차 경로 (요금은 추정하지 않음) */
export function estimateDrive(a: LatLng, b: LatLng, d = PLAN_DEFAULTS): RawRoute {
  const meters = haversine(a, b) * d.roadDetour;
  return { meters, seconds: (meters / d.taxiMetersPerMin) * 60, source: 'estimate' };
}

export function paceFactor(cond: ConditionInput, d = PLAN_DEFAULTS) {
  return cond.pace === 'slow' ? d.slowPaceFactor : 1;
}

/** 원본 경로 → 일정에 쓰는 이동 구간 */
export function buildLeg(walk: RawRoute, drive: RawRoute | null, cond: ConditionInput, d = PLAN_DEFAULTS): Leg {
  const walkMinutes = Math.max(1, Math.round((walk.seconds / 60) * paceFactor(cond, d)));
  const overLimit = walkMinutes > cond.walkLimitMin;
  if (!overLimit || !drive) {
    return {
      mode: 'walk',
      minutes: walkMinutes,
      meters: Math.round(walk.meters),
      walkMinutes,
      overLimit,
      walkSource: walk.source,
      path: walk.path,
    };
  }
  const driveMinutes = Math.max(1, Math.round(drive.seconds / 60));
  return {
    mode: 'taxi',
    minutes: driveMinutes + d.taxiPickupMin,
    meters: Math.round(drive.meters),
    walkMinutes,
    driveMinutes,
    taxiFare: drive.taxiFare,
    overLimit: true,
    walkSource: walk.source,
    driveSource: drive.source,
    path: drive.path,
  };
}

/** 동시 호출 수 제한 */
async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

/**
 * 장소 쌍별 이동 구간 캐시.
 * 도보는 A→B, B→A 를 같다고 보고 한 번만 호출합니다. 택시는 도보가 한도를 넘는 쌍에만 호출합니다.
 */
export class TravelMatrix {
  private walkCache = new Map<string, RawRoute>();
  private driveCache = new Map<string, RawRoute>();
  apiCalls = { walk: 0, drive: 0 };
  sourcesUsed = { walk: new Set<string>(), drive: new Set<string>() };

  constructor(
    private providers: Providers,
    private cond: ConditionInput,
    private d = PLAN_DEFAULTS,
  ) {}

  private key(a: Place, b: Place) {
    return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
  }

  /**
   * 캐시에는 id 가 작은 쪽 → 큰 쪽 방향 좌표열로 저장하고, 꺼낼 때 요청 방향에 맞춰 뒤집습니다.
   */
  private async cached(
    cache: Map<string, RawRoute>,
    a: Place,
    b: Place,
    fetch: () => Promise<RawRoute>,
    fallback: () => RawRoute,
    kind: 'walk' | 'drive',
  ): Promise<RawRoute> {
    const k = this.key(a, b);
    const forward = a.id < b.id;
    let stored = cache.get(k);
    if (!stored) {
      let r: RawRoute;
      try {
        this.apiCalls[kind]++;
        r = await fetch(); // a → b 방향
      } catch {
        r = fallback();
      }
      stored = { ...r, path: forward ? r.path : r.path?.slice().reverse() };
      cache.set(k, stored);
    }
    this.sourcesUsed[kind].add(stored.source);
    return forward ? stored : { ...stored, path: stored.path?.slice().reverse() };
  }

  private rawWalk(a: Place, b: Place) {
    return this.cached(
      this.walkCache,
      a,
      b,
      () => this.providers.walk(a.pos, b.pos),
      () => estimateWalk(a.pos, b.pos, this.d),
      'walk',
    );
  }

  private rawDrive(a: Place, b: Place) {
    return this.cached(
      this.driveCache,
      a,
      b,
      () => this.providers.drive(a.pos, b.pos),
      () => estimateDrive(a.pos, b.pos, this.d),
      'drive',
    );
  }

  async leg(a: Place, b: Place): Promise<Leg> {
    if (a.id === b.id) {
      return { mode: 'walk', minutes: 0, meters: 0, walkMinutes: 0, overLimit: false, walkSource: 'estimate' };
    }
    const w = await this.rawWalk(a, b);
    const walkMin = (w.seconds / 60) * paceFactor(this.cond, this.d);
    const needDrive = Math.round(walkMin) > this.cond.walkLimitMin;
    const dr = needDrive ? await this.rawDrive(a, b) : null;
    return buildLeg(w, dr, this.cond, this.d);
  }

  /** 여러 장소 사이 모든 쌍을 미리 계산 (동시 6개) */
  async prefetch(places: Place[]) {
    const pairs: [Place, Place][] = [];
    for (let i = 0; i < places.length; i++)
      for (let j = i + 1; j < places.length; j++) pairs.push([places[i], places[j]]);
    await pool(pairs, 6, async ([a, b]) => {
      await this.leg(a, b);
    });
  }

  /** 미리 계산된 값으로 동기 조회 (prefetch 이후에만) */
  legSync(a: Place, b: Place): Leg {
    if (a.id === b.id) {
      return { mode: 'walk', minutes: 0, meters: 0, walkMinutes: 0, overLimit: false, walkSource: 'estimate' };
    }
    const k = this.key(a, b);
    const w0 = this.walkCache.get(k) ?? estimateWalk(a.pos, b.pos, this.d);
    const w = a.id < b.id ? w0 : { ...w0, path: w0.path?.slice().reverse() };
    const dr0 = this.driveCache.get(k);
    const walkMin = (w.seconds / 60) * paceFactor(this.cond, this.d);
    const needDrive = Math.round(walkMin) > this.cond.walkLimitMin;
    const dr = needDrive ? (dr0 ? (a.id < b.id ? dr0 : { ...dr0, path: dr0.path?.slice().reverse() }) : estimateDrive(a.pos, b.pos, this.d)) : null;
    return buildLeg(w, dr, this.cond, this.d);
  }
}
