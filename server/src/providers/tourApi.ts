// 한국관광공사 국문 관광정보 서비스 (KorService2)
//  - areaBasedList2     : 법정동 코드(lDongRegnCd·lDongSignguCd)로 관광지(12)·문화시설(14)·음식점(39) 후보
//  - locationBasedList2 : 좌표 반경 후보 (보조)
//  - detailIntro2       : 휴무일(restdate…), 음식점 대표·취급 메뉴(firstmenu, treatmenu)
//
// ⚠️ 2026-11 실제 응답 확인 결과: locationBasedList2 와 areaBasedList2(areaCode) 는 옛 지역코드(areacode)가
//    남아 있는 일부 장소만 돌려줌 (명동 반경 3km 관광지 3곳, 덕수궁·명동성당 누락).
//    새 법정동 코드로 옮겨진 장소는 areaBasedList2 에 lDongRegnCd·lDongSignguCd 를 줘야 나옴 (서울 중구 관광지 70곳).
//    그래서 반경을 덮는 시군구의 법정동 코드를 구해 areaBasedList2 로 받고, 좌표로 반경 안만 남깁니다.
// 문서: https://www.data.go.kr/data/15101578/openapi.do

import { haversine, type LatLng, type Place } from '@hyodo/core';
import { env } from '../env.ts';
import { ApiError, fetchText, log, mapLimit, TtlCache } from '../http.ts';
import { kakaoRegionCode } from './kakao.ts';

const BASE = 'https://apis.data.go.kr/B551011';
const cache = new TtlCache<any>();
const H6 = 6 * 3600_000;
const H24 = 24 * 3600_000;

function keyParam(key: string) {
  // Encoding 키(이미 %인코딩됨)를 넣어도, Decoding 키를 넣어도 동작하도록
  return key.includes('%') ? key : encodeURIComponent(key);
}

/** 공공데이터포털 공통 호출: items.item 을 항상 배열로 돌려줌 */
export async function dataGoKr(service: string, op: string, params: Record<string, string | number>, key: string, ttl = H6) {
  const qs = Object.entries({ MobileOS: 'ETC', MobileApp: env.appName, _type: 'json', ...params })
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = `${BASE}/${service}/${op}?serviceKey=${keyParam(key)}&${qs}`;
  const hit = cache.get(url);
  if (hit) return hit as any[];

  const { status, text } = await fetchText(url, { api: `${service}/${op}`, timeoutMs: 10000 });
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    // 인증 오류 등은 XML 로 옴 (예: SERVICE_KEY_IS_NOT_REGISTERED_ERROR)
    const msg = text.match(/<returnAuthMsg>([^<]+)/)?.[1] ?? text.match(/<resultMsg>([^<]+)/)?.[1] ?? text.slice(0, 120);
    throw new ApiError(`${service}/${op} 오류: ${msg}`, service, status);
  }
  const header = j?.response?.header;
  if (header && header.resultCode !== '0000') {
    throw new ApiError(`${service}/${op} 오류 ${header.resultCode}: ${header.resultMsg}`, service, status);
  }
  const items = j?.response?.body?.items;
  const arr: any[] = !items || items === '' ? [] : Array.isArray(items.item) ? items.item : items.item ? [items.item] : [];
  log(`${service}/${op}`, `${arr.length}건`);
  cache.set(url, arr, ttl);
  return arr;
}

function toPlace(it: any, kind: Place['kind']): Place | null {
  const lat = Number(it.mapy);
  const lng = Number(it.mapx);
  if (!lat || !lng) return null;
  return {
    id: `tour:${it.contentid}`,
    source: 'tourapi',
    kind,
    name: String(it.title ?? '').trim(),
    addr: it.addr1 || undefined,
    pos: { lat, lng },
    contentTypeId: String(it.contenttypeid ?? ''),
    image: it.firstimage || undefined,
    lcls: [it.lclsSystm1, it.lclsSystm2, it.lclsSystm3].filter(Boolean),
    lDong: toLDong(it),
  };
}

function toLDong(it: any): Place['lDong'] {
  const regn = String(it.lDongRegnCd ?? '').trim();
  const signgu = String(it.lDongSignguCd ?? '').trim();
  return regn && signgu ? { regn, signgu } : undefined;
}

const regionCache = new TtlCache<string[]>();

/**
 * 반경을 덮는 시군구 법정동 코드 목록 ('11|140' 형식).
 *  1) 카카오 좌표→행정구역(coord2regioncode)으로 중심과 반경 둘레 8곳의 법정동 코드
 *  2) locationBasedList2 로 받은 장소들의 lDong 코드 (카카오 키가 없거나 실패할 때 보완)
 */
export async function regionCodesAround(center: LatLng, radiusM: number): Promise<string[]> {
  const ck = `${center.lat.toFixed(4)},${center.lng.toFixed(4)},${Math.round(radiusM)}`;
  const hit = regionCache.get(ck);
  if (hit) return hit;
  const set = new Set<string>();

  if (env.kakaoRestKey) {
    const r = Math.min(radiusM, 20000) * 0.9;
    const dLat = r / 111320;
    const dLng = r / (111320 * Math.cos((center.lat * Math.PI) / 180));
    const points: LatLng[] = [center];
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      points.push({ lat: center.lat + dLat * Math.sin(a), lng: center.lng + dLng * Math.cos(a) });
    }
    const codes = await mapLimit(points, 4, (p) => kakaoRegionCode(p).catch(() => null));
    codes.forEach((c) => c && set.add(`${c.regn}|${c.signgu}`));
  }

  if (!set.size) {
    const legacy = await dataGoKr(
      'KorService2',
      'locationBasedList2',
      { numOfRows: 200, pageNo: 1, mapX: center.lng, mapY: center.lat, radius: Math.min(20000, Math.round(radiusM)) },
      env.tourApiKey!,
    ).catch(() => [] as any[]);
    legacy.forEach((it) => {
      const l = toLDong(it);
      if (l) set.add(`${l.regn}|${l.signgu}`);
    });
  }

  const list = [...set].slice(0, 8);
  regionCache.set(ck, list, 24 * 3600_000);
  log('후보 지역(법정동)', list.join(', ') || '없음');
  return list;
}

export async function tourSearch(center: LatLng, radiusM: number, kind: 'attraction' | 'restaurant'): Promise<Place[]> {
  const key = env.tourApiKey!;
  const types = kind === 'attraction' ? ['12', '14'] : ['39'];
  const radius = Math.min(20000, Math.round(radiusM));
  const regions = await regionCodesAround(center, radius);

  const calls: Promise<any[]>[] = [];
  for (const t of types) {
    // 보조: 좌표 반경 (옛 지역코드가 남은 장소)
    calls.push(
      dataGoKr(
        'KorService2',
        'locationBasedList2',
        { numOfRows: 100, pageNo: 1, arrange: 'E', mapX: center.lng, mapY: center.lat, radius, contentTypeId: t },
        key,
      ).catch(() => []),
    );
    // 주: 시군구 법정동 코드별 목록
    for (const r of regions) {
      const [regn, signgu] = r.split('|');
      calls.push(
        dataGoKr(
          'KorService2',
          'areaBasedList2',
          { numOfRows: 1000, pageNo: 1, lDongRegnCd: regn, lDongSignguCd: signgu, contentTypeId: t },
          key,
        ).catch((e) => {
          log('areaBasedList2 실패', r, t, (e as Error).message);
          return [];
        }),
      );
    }
  }
  const lists = await Promise.all(calls);
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const it of lists.flat()) {
    const p = toPlace(it, kind);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    const d = haversine(center, p.pos);
    if (d > radius) continue;
    p.distFromCenter = Math.round(d);
    out.push(p);
  }
  out.sort((a, b) => (a.distFromCenter ?? 0) - (b.distFromCenter ?? 0));
  return out.slice(0, kind === 'attraction' ? 150 : 200);
}

/** 휴무일·메뉴. 실패해도 일정 계산은 계속되도록 개별 오류는 무시 */
export async function tourEnrich(places: Place[]) {
  const key = env.tourApiKey!;
  const targets = places.filter((p) => p.source === 'tourapi' && p.contentTypeId);
  await mapLimit(targets, 4, async (p) => {
    try {
      const [it] = await dataGoKr(
        'KorService2',
        'detailIntro2',
        { contentId: p.id.replace('tour:', ''), contentTypeId: p.contentTypeId! },
        key,
        H24,
      );
      if (!it) return;
      const strip = (s: unknown) => (typeof s === 'string' ? s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');
      if (p.contentTypeId === '39') {
        p.menu = [strip(it.firstmenu), strip(it.treatmenu)].filter(Boolean).join(', ') || undefined;
        p.restDate = strip(it.restdatefood) || undefined;
      } else if (p.contentTypeId === '14') {
        p.restDate = strip(it.restdateculture) || undefined;
      } else {
        p.restDate = strip(it.restdate) || undefined;
      }
    } catch (e) {
      log('detailIntro2 실패', p.name, (e as Error).message);
    }
  });
}
