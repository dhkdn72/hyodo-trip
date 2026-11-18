// 한국관광공사 무장애 여행 정보 서비스 (KorWithService2)
//  - locationBasedList2 : 반경 안에서 무장애 정보가 등록된 장소의 contentid 목록 (1회 호출)
//  - detailWithTour2    : 장소별 주차·접근로·출입구·엘리베이터·휠체어·화장실 등 (등록된 곳만 호출)
// contentid 는 국문 관광정보(KorService2)와 같은 체계라 이름 매칭 없이 붙입니다.

import { accessFromKorWith, haversine, type LatLng, type Place } from '@hyodo/core';
import { env } from '../env.ts';
import { log, mapLimit } from '../http.ts';
import { dataGoKr } from './tourApi.ts';

const H24 = 24 * 3600_000;
/** detailWithTour2 를 부를 최대 장소 수 (호출량 제한) */
const MAX_DETAIL = 24;

export async function attachKorWith(places: Place[]) {
  const key = env.korWithApiKey!;
  const tourPlaces = places.filter((p) => p.source === 'tourapi');
  if (!tourPlaces.length) return;

  // 후보들을 덮는 원 하나로 등록 목록을 한 번에 받음
  const c: LatLng = {
    lat: tourPlaces.reduce((s, p) => s + p.pos.lat, 0) / tourPlaces.length,
    lng: tourPlaces.reduce((s, p) => s + p.pos.lng, 0) / tourPlaces.length,
  };
  const radius = Math.min(20000, Math.ceil(Math.max(...tourPlaces.map((p) => haversine(c, p.pos)))) + 200);

  let registered = new Set<string>();
  try {
    const list = await dataGoKr(
      'KorWithService2',
      'locationBasedList2',
      { numOfRows: 200, pageNo: 1, mapX: c.lng, mapY: c.lat, radius },
      key,
      H24,
    );
    registered = new Set(list.map((it) => String(it.contentid)));
  } catch (e) {
    // 목록 조회가 안 되면 상위 후보에 대해 상세를 직접 시도
    log('KorWithService2 목록 실패 → 상세 직접 조회', (e as Error).message);
    registered = new Set(tourPlaces.slice(0, MAX_DETAIL).map((p) => p.id.replace('tour:', '')));
  }

  const targets = tourPlaces.filter((p) => registered.has(p.id.replace('tour:', ''))).slice(0, MAX_DETAIL);
  // 등록 안 된 곳은 '정보 없음'
  tourPlaces.forEach((p) => {
    p.access = { known: false, items: {}, source: 'korwith' };
  });
  await mapLimit(targets, 4, async (p) => {
    try {
      const [it] = await dataGoKr('KorWithService2', 'detailWithTour2', { contentId: p.id.replace('tour:', '') }, key, H24);
      p.access = accessFromKorWith(it ?? null);
      if (!it) p.access.known = false;
    } catch (e) {
      log('detailWithTour2 실패', p.name, (e as Error).message);
    }
  });
}
