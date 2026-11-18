// API 키가 없을 때 쓰는 예시 어댑터. 이동 시간은 직선거리 기반 추정입니다.

import { haversine } from '../geo.ts';
import { estimateDrive, estimateWalk } from '../travel.ts';
import type { GeoResult, LatLng, Place, Providers } from '../types.ts';
import { SAMPLE_ATTRACTIONS, SAMPLE_CAFES, SAMPLE_GAZETTEER, SAMPLE_RESTAURANTS } from './data.ts';

const clone = (p: Place): Place => JSON.parse(JSON.stringify(p));

export function createSampleProviders(opts: { latencyMs?: number } = {}): Providers {
  const wait = () => (opts.latencyMs ? new Promise((r) => setTimeout(r, opts.latencyMs)) : Promise.resolve());
  return {
    sources: { places: 'sample', access: 'sample', walk: 'estimate', taxi: 'estimate', cafes: 'sample' },
    async searchPlaces(center: LatLng, radiusM: number, kind) {
      await wait();
      const list = kind === 'attraction' ? SAMPLE_ATTRACTIONS : SAMPLE_RESTAURANTS;
      return list
        .filter((p) => haversine(center, p.pos) <= radiusM)
        .map(clone)
        .sort((a, b) => haversine(center, a.pos) - haversine(center, b.pos));
    },
    async attachAccessibility() {
      // 예시 데이터에는 이미 access 가 들어 있음
    },
    async walk(a, b) {
      return estimateWalk(a, b);
    },
    async drive(a, b) {
      return estimateDrive(a, b);
    },
    async nearbyCafes(p, radiusM) {
      await wait();
      return SAMPLE_CAFES.filter((c) => haversine(p, c.pos) <= radiusM)
        .sort((x, y) => haversine(p, x.pos) - haversine(p, y.pos))
        .map(clone);
    },
  };
}

export function sampleGeoSearch(q: string): GeoResult[] {
  const t = q.replace(/\s+/g, '');
  if (!t) return SAMPLE_GAZETTEER.slice(0, 6);
  return SAMPLE_GAZETTEER.filter((g) => `${g.name}${g.addr ?? ''}`.replace(/\s+/g, '').includes(t));
}
