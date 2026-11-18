// /api/plan 입력 검사 (의존성 없이 최소한으로)

const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const isLatLng = (p: any) => p && isNum(p.lat) && isNum(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
const isHHMM = (s: unknown) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isIdList = (x: unknown) => x === undefined || (Array.isArray(x) && x.length <= 50 && x.every((s) => typeof s === 'string'));

export function validatePlanRequest(b: any): string | null {
  if (!b || typeof b !== 'object') return '요청 형식이 잘못됐어요.';
  const t = b.trip;
  if (!t) return 'trip 이 없어요.';
  if (typeof t.regionName !== 'string' || !isLatLng(t.center)) return '지역을 선택해 주세요.';
  if (typeof t.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return '날짜를 선택해 주세요.';
  if (!isHHMM(t.startTime) || !isHHMM(t.endTime)) return '일정 시간을 선택해 주세요.';
  if (!t.origin || typeof t.origin.name !== 'string' || !isLatLng(t.origin.pos)) return '출발 장소를 선택해 주세요.';
  if (t.radiusM !== undefined && !(isNum(t.radiusM) && t.radiusM >= 300 && t.radiusM <= 20000)) return '검색 반경이 잘못됐어요.';
  const c = b.condition;
  if (!c) return 'condition 이 없어요.';
  if (!isNum(c.walkLimitMin) || c.walkLimitMin < 5 || c.walkLimitMin > 120) return '한 번에 걷기 시간이 잘못됐어요.';
  if (!isNum(c.restEveryMin) || c.restEveryMin < 30 || c.restEveryMin > 240) return '쉬는 간격이 잘못됐어요.';
  if (c.pace !== 'slow' && c.pace !== 'normal') return '걷는 속도가 잘못됐어요.';
  if (!c.needs || typeof c.needs.stepFree !== 'boolean' || typeof c.needs.parking !== 'boolean') return '필요한 시설 값이 잘못됐어요.';
  if (!(c.lunchTime === null || isHHMM(c.lunchTime))) return '점심 시간이 잘못됐어요.';
  if (!(c.dinnerTime === null || c.dinnerTime === undefined || isHHMM(c.dinnerTime))) return '저녁 시간이 잘못됐어요.';
  if (c.dinnerTime === undefined) c.dinnerTime = null;
  const p = b.prefs;
  if (p) {
    for (const k of ['foods', 'interests', 'activities']) {
      if (!Array.isArray(p[k]) || p[k].some((s: unknown) => typeof s !== 'string')) return '취향 값이 잘못됐어요.';
    }
    if (p.freeText !== undefined && (typeof p.freeText !== 'string' || p.freeText.length > 300)) return '자유 입력은 300자까지예요.';
  }
  if (!isIdList(b.excludeIds) || !isIdList(b.includeIds)) return '장소 목록이 잘못됐어요.';
  if (b.lockAttractions !== undefined && typeof b.lockAttractions !== 'boolean') return 'lockAttractions 값이 잘못됐어요.';
  if (b.pinnedMeals !== undefined) {
    const m = b.pinnedMeals;
    if (!m || typeof m !== 'object' || Object.entries(m).some(([k, v]) => !['lunch', 'dinner'].includes(k) || typeof v !== 'string'))
      return '고정한 식당 값이 잘못됐어요.';
  }
  return null;
}
