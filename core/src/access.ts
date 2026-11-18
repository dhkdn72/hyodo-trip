// F3 무장애·편의시설 — 무장애 여행 정보 API(KorWithService2 detailWithTour2) 응답을 배지로 바꿉니다.
// 응답 필드는 대부분 자유 텍스트라("장애인 주차장 있음(4대)", "출입구까지 완만한 경사로…")
// 텍스트가 있으면 '있음', 부정 표현이 있으면 '없음', 비어 있으면 '정보 없음'으로 봅니다.

import type { AccessInfo, AccessItem, AccessKey, AccessStatus, ConditionInput, Place } from './types.ts';

export const ACCESS_LABEL: Record<AccessKey, string> = {
  parking: '주차',
  ramp: '경사로',
  elevator: '엘리베이터',
  wheelchair: '휠체어 대여',
  restroom: '장애인 화장실',
};

const NEGATIVE = /(없음|없습니다|없다|불가|미설치|미비|어려움|어렵|이용\s*불|계단만|계단으로만)/;
const RAMP_POSITIVE = /(경사로|슬로프|턱\s*(이\s*)?없|단차\s*(가\s*)?없|평탄|휠체어.{0,10}(가능|출입|접근))/;
const RAMP_NEGATIVE = /(경사로\s*(가\s*)?없|계단만|계단으로만|턱\s*(이\s*)?있|단차\s*(가\s*)?있)/;

function clean(v: unknown): string {
  return typeof v === 'string' ? v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

const POSITIVE = /(있음|있습니다|있다|가능|설치|구비|운영|대여|마련)/;

function simple(text: string): AccessItem {
  if (!text) return { status: 'unknown' };
  // "장애인 주차장 있음, 요금 없음"처럼 긍정·부정이 섞이면 긍정으로 봄
  if (NEGATIVE.test(text) && !POSITIVE.test(text)) return { status: 'no', text };
  return { status: 'yes', text };
}

/**
 * detailWithTour2 item → AccessInfo
 * 사용하는 필드: parking(주차), route(접근로), exit(출입구), elevator(엘리베이터),
 * wheelchair(휠체어 대여), restroom(화장실)
 */
export function accessFromKorWith(item: Record<string, unknown> | null | undefined): AccessInfo {
  if (!item) return { known: false, items: {}, source: 'korwith' };
  const parking = clean(item.parking);
  const route = clean(item.route);
  const exit = clean(item.exit);
  const elevator = clean(item.elevator);
  const wheelchair = clean(item.wheelchair);
  const restroom = clean(item.restroom);

  const rampText = [route, exit].filter(Boolean).join(' / ');
  let ramp: AccessItem = { status: 'unknown' };
  if (rampText) {
    if (RAMP_NEGATIVE.test(rampText) && !RAMP_POSITIVE.test(rampText)) ramp = { status: 'no', text: rampText };
    else if (RAMP_POSITIVE.test(rampText)) ramp = { status: 'yes', text: rampText };
    else ramp = { status: 'unknown', text: rampText };
  }

  return {
    known: true,
    source: 'korwith',
    items: {
      parking: simple(parking),
      ramp,
      elevator: simple(elevator),
      wheelchair: simple(wheelchair),
      restroom: simple(restroom),
    },
  };
}

export function accessStatus(p: Place, key: AccessKey): AccessStatus {
  return p.access?.items[key]?.status ?? 'unknown';
}

/** 엘리베이터·경사로 조건: 둘 중 하나라도 있으면 yes, 경사로가 없다고 명시되면 no */
export function stepFreeStatus(p: Place): AccessStatus {
  const ramp = accessStatus(p, 'ramp');
  const elev = accessStatus(p, 'elevator');
  if (ramp === 'yes' || elev === 'yes') return 'yes';
  if (ramp === 'no') return 'no';
  return 'unknown';
}

export interface AccessCheck {
  /** 조건에 명시적으로 안 맞아 후보에서 뺌 */
  excluded: boolean;
  /** 점수 가감 */
  bonus: number;
  reason?: string;
}

/** 체크한 편의시설은 장소 후보를 거르는 조건이 됩니다 (기획안 화면 ②) */
export function checkNeeds(p: Place, cond: ConditionInput): AccessCheck {
  let bonus = p.access?.known ? 0.15 : 0;
  if (cond.needs.stepFree) {
    const s = stepFreeStatus(p);
    if (s === 'no') return { excluded: true, bonus: 0, reason: '경사로 없음' };
    bonus += s === 'yes' ? 0.5 : -0.2;
  }
  if (cond.needs.parking) {
    const s = accessStatus(p, 'parking');
    if (s === 'no') return { excluded: true, bonus: 0, reason: '주차 불가' };
    bonus += s === 'yes' ? 0.3 : -0.1;
  }
  return { excluded: false, bonus };
}

/** 화면에 붙일 배지 목록. 데이터가 없으면 ['정보 없음'] */
export function accessBadges(p: Place): { label: string; status: AccessStatus }[] {
  if (!p.access || !p.access.known) return [{ label: '정보 없음', status: 'unknown' }];
  const out: { label: string; status: AccessStatus }[] = [];
  (['parking', 'ramp', 'elevator', 'wheelchair', 'restroom'] as AccessKey[]).forEach((k) => {
    const s = accessStatus(p, k);
    if (s === 'yes') out.push({ label: ACCESS_LABEL[k], status: 'yes' });
  });
  if (!out.length) return [{ label: '정보 없음', status: 'unknown' }];
  return out;
}
