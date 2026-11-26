// API 키가 없을 때 쓰는 예시 어댑터. 이동 시간은 직선거리 기반 추정입니다.

import { haversine } from '../geo.ts';
import { estimateDrive, estimateWalk } from '../travel.ts';
import type { GeoResult, LatLng, Place, PlaceDetail, PlaceRef, Providers } from '../types.ts';
import { SAMPLE_ATTRACTIONS, SAMPLE_CAFES, SAMPLE_GAZETTEER, SAMPLE_LODGINGS, SAMPLE_RESTAURANTS, SAMPLE_SHOPPING } from './data.ts';

const ALL = () => [...SAMPLE_ATTRACTIONS, ...SAMPLE_SHOPPING, ...SAMPLE_RESTAURANTS, ...SAMPLE_LODGINGS, ...SAMPLE_CAFES];

/** 예시 데이터의 장소 상세: 이름·좌표로 만든 카카오맵 링크와 근처 예시 장소만 */
export function sampleDetail(ref: PlaceRef): PlaceDetail {
  const p = ALL().find((x) => x.id === ref.id);
  const info: PlaceDetail['info'] = [];
  if (p?.menu) info.push({ label: '메뉴 (예시)', value: p.menu });
  if (p?.restDate) info.push({ label: '쉬는 날', value: p.restDate });
  const nearby = [...SAMPLE_ATTRACTIONS, ...SAMPLE_SHOPPING]
    .filter((x) => x.id !== ref.id)
    .map((x) => ({ name: x.name, distance: Math.round(haversine(ref.pos, x.pos)) }))
    .filter((x) => x.distance <= 700)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
  return {
    id: ref.id,
    images: p?.image ? [p.image] : [],
    info,
    kakaoUrl: kakaoMapLink(ref.name, ref.pos),
    kakaoUrlKind: 'map',
    nearby,
    source: 'sample',
  };
}

/** 카카오맵 지도 링크 (장소 페이지를 못 찾았을 때) */
export function kakaoMapLink(name: string, pos: LatLng) {
  return `https://map.kakao.com/link/map/${encodeURIComponent(name.replace(/,/g, ' '))},${pos.lat},${pos.lng}`;
}

const clone = (p: Place): Place => JSON.parse(JSON.stringify(p));

export function createSampleProviders(opts: { latencyMs?: number } = {}): Providers {
  const wait = () => (opts.latencyMs ? new Promise((r) => setTimeout(r, opts.latencyMs)) : Promise.resolve());
  return {
    sources: { places: 'sample', access: 'sample', walk: 'estimate', taxi: 'estimate', cafes: 'sample' },
    async searchPlaces(center: LatLng, radiusM: number, kind) {
      await wait();
      const list =
        kind === 'attraction'
          ? SAMPLE_ATTRACTIONS
          : kind === 'shopping'
            ? SAMPLE_SHOPPING
            : kind === 'lodging'
              ? SAMPLE_LODGINGS
              : SAMPLE_RESTAURANTS;
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
    async placeDetail(ref) {
      await wait();
      return sampleDetail(ref);
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
