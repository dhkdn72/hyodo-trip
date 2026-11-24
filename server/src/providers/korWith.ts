// 한국관광공사 무장애 여행 정보 서비스 (KorWithService2)
//  - areaBasedList2     : 시군구 법정동 코드별로 무장애 정보가 등록된 장소의 contentid 목록
//  - locationBasedList2 : 좌표 반경 목록 (보조 — 국문 관광정보와 같이 옛 지역코드 장소만 나옴)
//  - detailWithTour2    : 장소별 주차·접근로·출입구·엘리베이터·휠체어·화장실 등 (등록된 곳만 호출)
// contentid 는 국문 관광정보(KorService2)와 같은 체계라 이름 매칭 없이 붙입니다.

import { accessFromKorWith, haversine, type LatLng, type Place } from '@hyodo/core';
import { env } from '../env.ts';
import { log, mapLimit } from '../http.ts';
import { dataGoKr } from './tourApi.ts';

const H24 = 24 * 3600_000;
/** detailWithTour2 를 부를 최대 장소 수 (호출량 제한) */
const MAX_DETAIL = 30;

export async function attachKorWith(places: Place[]) {
  const key = env.korWithApiKey!;
  const tourPlaces = places.filter((p) => p.source === 'tourapi');
  if (!tourPlaces.length) return;

  const regions = [...new Set(tourPlaces.filter((p) => p.lDong).map((p) => `${p.lDong!.regn}|${p.lDong!.signgu}`))];
  const c: LatLng = {
    lat: tourPlaces.reduce((s, p) => s + p.pos.lat, 0) / tourPlaces.length,
    lng: tourPlaces.reduce((s, p) => s + p.pos.lng, 0) / tourPlaces.length,
  };
  const radius = Math.min(20000, Math.ceil(Math.max(...tourPlaces.map((p) => haversine(c, p.pos)))) + 200);

  const registered = new Set<string>();
  let listOk = false;
  const lists = await Promise.all([
    ...regions.map((r) => {
      const [regn, signgu] = r.split('|');
      return dataGoKr('KorWithService2', 'areaBasedList2', { numOfRows: 1000, pageNo: 1, lDongRegnCd: regn, lDongSignguCd: signgu }, key, H24)
        .then((l) => ((listOk = true), l))
        .catch((e) => (log('KorWithService2 areaBasedList2 실패', r, (e as Error).message), [] as any[]));
    }),
    dataGoKr('KorWithService2', 'locationBasedList2', { numOfRows: 200, pageNo: 1, mapX: c.lng, mapY: c.lat, radius }, key, H24)
      .then((l) => ((listOk = true), l))
      .catch(() => [] as any[]),
  ]);
  lists.flat().forEach((it) => registered.add(String(it.contentid)));

  // 목록 조회가 모두 실패하면 상위 후보에 대해 상세를 직접 시도
  const targets = (listOk ? tourPlaces.filter((p) => registered.has(p.id.replace('tour:', ''))) : tourPlaces).slice(0, MAX_DETAIL);
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
