import type { ConditionInput, LatLng, PlanRequest, PrefInput } from '@hyodo/core';

export interface TripForm {
  region: { name: string; pos: LatLng } | null;
  date: string;
  startTime: string;
  endTime: string;
  origin: { name: string; pos: LatLng } | null;
  returnToOrigin: boolean;
  /** 후보를 찾을 반경(m): 2000 동네 위주 · 3000 보통 · 5000 넓게 */
  radiusM: number;
}

export interface Adjustments {
  excludeIds: string[];
  includeIds: string[];
  pinnedMeals: { lunch?: string; dinner?: string };
  /** 화면 ④에서 손으로 고친 뒤에는 나머지 장소를 그대로 둠 */
  lock: boolean;
}

export interface FormState {
  trip: TripForm;
  condition: ConditionInput;
  prefs: PrefInput;
  prefsSkipped: boolean;
}

/** 다가오는 토요일 (YYYY-MM-DD, 현지 시간) */
function nextSaturday(): string {
  const d = new Date();
  const add = ((6 - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + add);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const DEFAULT_FORM: FormState = {
  trip: {
    region: null,
    date: nextSaturday(),
    startTime: '10:00',
    endTime: '17:00',
    origin: null,
    returnToOrigin: true,
    radiusM: 3000,
  },
  condition: {
    walkLimitMin: 30,
    restEveryMin: 90,
    pace: 'slow',
    needs: { stepFree: true, parking: false },
    lunchTime: '12:00',
    dinnerTime: null,
  },
  prefs: { foods: [], interests: [], activities: [], freeText: '' },
  prefsSkipped: false,
};

export const EMPTY_ADJ: Adjustments = { excludeIds: [], includeIds: [], pinnedMeals: {}, lock: false };

const KEY = 'hyodo-trip:form:v1';

export function loadForm(): FormState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_FORM;
    const f = JSON.parse(raw) as FormState;
    // 지난 날짜는 다음 토요일로
    const today = new Date().toISOString().slice(0, 10);
    if (!f.trip?.date || f.trip.date < today) f.trip = { ...f.trip, date: DEFAULT_FORM.trip.date };
    return { ...DEFAULT_FORM, ...f, trip: { ...DEFAULT_FORM.trip, ...f.trip }, condition: { ...DEFAULT_FORM.condition, ...f.condition } };
  } catch {
    return DEFAULT_FORM;
  }
}

export function saveForm(f: FormState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* 저장소를 못 쓰는 환경이면 무시 */
  }
}

/** radiusOverride: 화면 ④에서 고칠 때는 처음 결과가 실제로 쓴 반경(자동으로 넓혔을 수 있음)을 그대로 씀 */
export function toRequest(f: FormState, adj: Adjustments, includePrefs: boolean, radiusOverride?: number): PlanRequest {
  const t = f.trip;
  return {
    trip: {
      regionName: t.region!.name,
      center: t.region!.pos,
      date: t.date,
      startTime: t.startTime,
      endTime: t.endTime,
      origin: t.origin!,
      returnToOrigin: t.returnToOrigin,
      radiusM: radiusOverride ?? t.radiusM,
    },
    condition: f.condition,
    prefs: includePrefs && !f.prefsSkipped ? f.prefs : null,
    excludeIds: adj.excludeIds,
    includeIds: adj.includeIds,
    pinnedMeals: adj.pinnedMeals,
    lockAttractions: adj.lock,
  };
}

/** ?flow=mvp → 해커톤 MVP 흐름 (① → ② → ④) */
export const FLOW: 'full' | 'mvp' =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('flow') === 'mvp' ? 'mvp' : 'full';
