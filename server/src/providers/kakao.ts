// 카카오 API (헤더: Authorization: KakaoAK {REST_API_KEY})
//  - 로컬: 주소 검색 /v2/local/search/address.json, 키워드 검색 /v2/local/search/keyword.json,
//          카테고리 검색 /v2/local/search/category.json (CE7 = 카페),
//          좌표→행정구역 /v2/local/geo/coord2regioncode.json (region_type 'B' = 법정동, code 10자리)
//  - 카카오맵 도보 경로: GET https://dapi.kakao.com/v2/routing/walk  (route_mode=ACCESSIBLE = 편안한 길)
//      응답 route.properties.totalDistance(m)·totalTime(초), route.legs[].steps[].path.points [[x,y]…]
//  - 카카오모빌리티 자동차 길찾기: GET https://apis-navi.kakaomobility.com/v1/directions
//      응답 routes[0].summary.distance(m)·duration(초)·fare.taxi(원), sections[].roads[].vertexes [x1,y1,x2,y2…]
// 좌표는 x=경도(lng), y=위도(lat)

import type { GeoResult, LatLng, Place, RawRoute } from '@hyodo/core';
import { env } from '../env.ts';
import { ApiError, fetchJson, log, TtlCache } from '../http.ts';

const auth = () => ({ Authorization: `KakaoAK ${env.kakaoRestKey}` });
const routeCache = new TtlCache<RawRoute>(5000);
const placeCache = new TtlCache<any>();
const H1 = 3600_000;
const H6 = 6 * H1;

const rk = (a: LatLng, b: LatLng) => `${a.lng.toFixed(5)},${a.lat.toFixed(5)}>${b.lng.toFixed(5)},${b.lat.toFixed(5)}`;

/** 지도에 그릴 좌표열을 최대 n개로 줄임 */
function thin(points: [number, number][], n = 200): [number, number][] {
  if (points.length <= n) return points;
  const step = (points.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => points[Math.round(i * step)]);
}

async function local(path: string, params: Record<string, string | number>) {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const url = `https://dapi.kakao.com${path}?${qs}`;
  const hit = placeCache.get(url);
  if (hit) return hit;
  const j = await fetchJson(url, { api: `kakao${path}`, headers: auth() });
  placeCache.set(url, j, H6);
  return j;
}

export async function kakaoGeoSearch(q: string, kind: 'region' | 'origin'): Promise<GeoResult[]> {
  const out: GeoResult[] = [];
  {
    // 지역은 '서울 중구 명동2가' 같은 동 단위, 출발지는 도로명 주소가 먼저 나오게
    const a = await local('/v2/local/search/address.json', { query: q, size: kind === 'region' ? 3 : 5 }).catch(() => null);
    for (const d of a?.documents ?? []) {
      out.push({
        name: kind === 'region' ? d.address_name : d.road_address?.address_name || d.address_name,
        addr: d.address_name,
        pos: { lat: Number(d.y), lng: Number(d.x) },
        source: 'kakao',
      });
    }
  }
  const k = await local('/v2/local/search/keyword.json', { query: q, size: 8 });
  for (const d of k?.documents ?? []) {
    out.push({
      name: d.place_name,
      addr: d.road_address_name || d.address_name,
      pos: { lat: Number(d.y), lng: Number(d.x) },
      source: 'kakao',
    });
  }
  return out.slice(0, 10);
}

/** 좌표의 법정동 코드 → TourAPI lDongRegnCd(앞 2자리)·lDongSignguCd(다음 3자리) */
export async function kakaoRegionCode(p: LatLng): Promise<{ regn: string; signgu: string } | null> {
  const j = await local('/v2/local/geo/coord2regioncode.json', { x: p.lng.toFixed(6), y: p.lat.toFixed(6) });
  const b = (j?.documents ?? []).find((d: any) => d.region_type === 'B');
  const code = String(b?.code ?? '');
  if (!/^\d{10}$/.test(code)) return null;
  return { regn: code.slice(0, 2), signgu: code.slice(2, 5) };
}

export async function kakaoCafes(p: LatLng, radiusM: number): Promise<Place[]> {
  const j = await local('/v2/local/search/category.json', {
    category_group_code: 'CE7',
    x: p.lng,
    y: p.lat,
    radius: Math.min(20000, Math.round(radiusM)),
    sort: 'distance',
    size: 8,
  });
  return (j?.documents ?? []).map(
    (d: any): Place => ({
      id: `kakao:${d.id}`,
      source: 'kakao',
      kind: 'cafe',
      name: d.place_name,
      addr: d.road_address_name || d.address_name,
      pos: { lat: Number(d.y), lng: Number(d.x) },
    }),
  );
}

export async function kakaoWalk(a: LatLng, b: LatLng): Promise<RawRoute> {
  const key = `w:${env.kakaoWalkMode}:${rk(a, b)}`;
  const hit = routeCache.get(key);
  if (hit) return hit;
  const qs = new URLSearchParams({
    start_x: String(a.lng),
    start_y: String(a.lat),
    end_x: String(b.lng),
    end_y: String(b.lat),
    route_mode: env.kakaoWalkMode,
  });
  const j = await fetchJson(`https://dapi.kakao.com/v2/routing/walk?${qs}`, { api: 'kakao/walk', headers: auth() });
  if (j?.status !== 'OK' || !j.route) {
    // SAME_POINT, TOO_FAR_AWAY 등 → 호출한 쪽에서 추정치로 대체
    throw new ApiError(`도보 경로 없음: ${j?.status}`, 'kakao/walk');
  }
  const props = j.route.properties ?? {};
  const points: [number, number][] = [];
  for (const leg of j.route.legs ?? []) for (const st of leg.steps ?? []) for (const pt of st.path?.points ?? []) points.push([pt[0], pt[1]]);
  const r: RawRoute = {
    meters: Number(props.totalDistance) || 0,
    seconds: Number(props.totalTime) || 0,
    path: points.length ? thin(points) : undefined,
    source: 'kakao',
  };
  routeCache.set(key, r, H1);
  return r;
}

export async function kakaoDrive(a: LatLng, b: LatLng): Promise<RawRoute> {
  const key = `d:${rk(a, b)}`;
  const hit = routeCache.get(key);
  if (hit) return hit;
  const qs = new URLSearchParams({ origin: `${a.lng},${a.lat}`, destination: `${b.lng},${b.lat}`, priority: 'RECOMMEND' });
  const j = await fetchJson(`https://apis-navi.kakaomobility.com/v1/directions?${qs}`, { api: 'kakaomobility/directions', headers: auth() });
  const route = j?.routes?.[0];
  if (!route || route.result_code !== 0) throw new ApiError(`자동차 경로 없음: ${route?.result_msg ?? '?'}`, 'kakaomobility');
  const points: [number, number][] = [];
  for (const s of route.sections ?? [])
    for (const road of s.roads ?? []) {
      const v: number[] = road.vertexes ?? [];
      for (let i = 0; i + 1 < v.length; i += 2) points.push([v[i], v[i + 1]]);
    }
  const r: RawRoute = {
    meters: Number(route.summary?.distance) || 0,
    seconds: Number(route.summary?.duration) || 0,
    taxiFare: route.summary?.fare?.taxi ? Number(route.summary.fare.taxi) : undefined,
    path: points.length ? thin(points) : undefined,
    source: 'kakao',
  };
  routeCache.set(key, r, H1);
  return r;
}

export function logKakaoError(where: string, e: unknown) {
  log(`카카오 ${where} 실패 → 추정치 사용:`, (e as Error).message);
}

const norm = (s: string) => s.replace(/\[[^\]]*\]|\([^)]*\)|\s|·/g, '').toLowerCase();
const https = (u: string) => u.replace(/^http:\/\//, 'https://');

/** 이름·좌표로 카카오맵 장소 페이지 찾기 (메뉴·가격·사진·리뷰는 카카오맵에서) */
export async function kakaoFindPlace(name: string, p: LatLng): Promise<{ url: string; phone?: string; category?: string } | null> {
  const j = await local('/v2/local/search/keyword.json', {
    query: name.replace(/\([^)]*\)/g, ' ').trim().slice(0, 40),
    x: p.lng.toFixed(6),
    y: p.lat.toFixed(6),
    radius: 600,
    sort: 'distance',
    size: 5,
  });
  const n = norm(name);
  const doc = (j?.documents ?? []).find((d: any) => {
    const m = norm(d.place_name);
    return m.length >= 2 && (m.includes(n) || n.includes(m));
  });
  if (!doc) return null;
  return { url: https(doc.place_url), phone: doc.phone || undefined, category: doc.category_name || undefined };
}

/** 근처 관광명소 (카테고리 AT4) — 자기 자신·하위 시설·도보 코스는 뺌 */
export async function kakaoNearbySpots(name: string, p: LatLng, radiusM = 700) {
  const j = await local('/v2/local/search/category.json', {
    category_group_code: 'AT4',
    x: p.lng.toFixed(6),
    y: p.lat.toFixed(6),
    radius: radiusM,
    sort: 'distance',
    size: 15,
  });
  const n = norm(name);
  const out: { name: string; distance: number; category?: string; url?: string }[] = [];
  for (const d of j?.documents ?? []) {
    const m = norm(d.place_name);
    const dist = Number(d.distance) || 0;
    if (dist < 60 || m.includes(n) || n.includes(m)) continue;
    if (/(코스|투어)$/.test(d.place_name)) continue;
    out.push({
      name: d.place_name,
      distance: dist,
      category: String(d.category_name ?? '').split('>').pop()?.trim() || undefined,
      url: d.place_url ? https(d.place_url) : undefined,
    });
    if (out.length >= 5) break;
  }
  return out;
}
