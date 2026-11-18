import type { LatLng } from './types.ts';

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** 두 좌표 사이 직선거리(m) */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function centroid(points: LatLng[]): LatLng {
  if (!points.length) return { lat: 0, lng: 0 };
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
}

/** 'HH:MM' → 자정 기준 분 */
export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** 자정 기준 분 → 'HH:MM' */
export function fmtMin(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** '2026-12-12' → { month: 12, day: 12, weekday: '토' } (현지 날짜 기준, 시간대 영향 없음) */
export function parseDate(ymd: string) {
  const [y, mo, d] = ymd.split('-').map(Number);
  // UTC 로 계산해 브라우저·서버 시간대와 무관하게 요일을 구함
  const w = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return { year: y, month: mo, day: d, weekday: WEEK[w] };
}

export function formatKoreanDate(ymd: string, long = false): string {
  const { month, day, weekday } = parseDate(ymd);
  return long ? `${month}월 ${day}일 ${weekday}요일` : `${month}월 ${day}일 (${weekday})`;
}
