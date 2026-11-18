// 한국관광공사 국문 관광정보 서비스 (KorService2)
//  - locationBasedList2 : 좌표 반경 안 관광지(12)·문화시설(14)·음식점(39) 후보
//  - detailIntro2       : 휴무일(restdate…), 음식점 대표·취급 메뉴(firstmenu, treatmenu)
// 문서: https://www.data.go.kr/data/15101578/openapi.do

import type { LatLng, Place } from '@hyodo/core';
import { env } from '../env.ts';
import { ApiError, fetchText, log, mapLimit, TtlCache } from '../http.ts';

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
  };
}

export async function tourSearch(center: LatLng, radiusM: number, kind: 'attraction' | 'restaurant'): Promise<Place[]> {
  const key = env.tourApiKey!;
  const types = kind === 'attraction' ? ['12', '14'] : ['39'];
  const lists = await Promise.all(
    types.map((t) =>
      dataGoKr(
        'KorService2',
        'locationBasedList2',
        {
          numOfRows: 60,
          pageNo: 1,
          arrange: 'E', // 거리순
          mapX: center.lng,
          mapY: center.lat,
          radius: Math.min(20000, Math.round(radiusM)),
          contentTypeId: t,
        },
        key,
      ),
    ),
  );
  return lists
    .flat()
    .map((it) => toPlace(it, kind))
    .filter((p): p is Place => !!p);
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
