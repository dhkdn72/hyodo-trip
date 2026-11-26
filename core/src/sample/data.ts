// ⚠️ 예시(샘플) 데이터 — API 키가 없을 때 화면을 시연하기 위한 데이터입니다.
// - 관광지 이름과 좌표는 서울 중구 일대 실제 명소의 대략적인 위치입니다.
// - 음식점·카페·숙소는 실제 상호가 아닌 가상의 이름이며 이름 끝에 '(예시)'를 붙였습니다.
// - 무장애 정보(주차·경사로 등)와 메뉴는 화면 시연용 예시 값으로, 실제 시설 정보가 아닙니다.
//   실제 정보는 TourAPI·무장애 여행 정보 API 키를 넣으면 그 응답으로 바뀝니다.

import type { AccessInfo, GeoResult, Place } from '../types.ts';

const acc = (items: Partial<Record<'parking' | 'ramp' | 'elevator' | 'wheelchair' | 'restroom', true>>): AccessInfo => ({
  known: true,
  source: 'sample',
  items: Object.fromEntries(
    Object.entries(items).map(([k]) => [k, { status: 'yes' as const, text: '예시 데이터' }]),
  ),
});

const NONE: AccessInfo = { known: false, items: {}, source: 'sample' };

const A = (
  id: string,
  name: string,
  lat: number,
  lng: number,
  contentTypeId: string,
  access: AccessInfo,
  extra: Partial<Place> = {},
): Place => ({ id: `sample:${id}`, source: 'sample', kind: 'attraction', name, pos: { lat, lng }, contentTypeId, ...extra, access });

const F = (id: string, name: string, lat: number, lng: number, menu: string, access: AccessInfo, extra: Partial<Place> = {}): Place => ({
  id: `sample:${id}`,
  source: 'sample',
  kind: 'restaurant',
  name,
  pos: { lat, lng },
  contentTypeId: '39',
  menu,
  ...extra,
  access,
});

const C = (id: string, name: string, lat: number, lng: number): Place => ({
  id: `sample:${id}`,
  source: 'sample',
  kind: 'cafe',
  name,
  pos: { lat, lng },
});

export const SAMPLE_AREA = {
  name: '서울 중구 · 명동',
  center: { lat: 37.5636, lng: 126.9834 },
  note: '예시 데이터는 서울 중구(명동·정동·남산) 일대만 있어요.',
};

export const SAMPLE_ATTRACTIONS: Place[] = [
  A('deoksugung', '덕수궁', 37.5658, 126.9752, '12', acc({ parking: true, ramp: true, restroom: true })),
  A('jeongdong', '정동길', 37.5665, 126.9722, '12', NONE),
  A('sema', '서울시립미술관 서소문본관', 37.5641, 126.9737, '14', acc({ ramp: true, elevator: true, restroom: true })),
  A('seoulplaza', '서울광장', 37.5655, 126.978, '12', acc({ ramp: true, restroom: true })),
  A('cheonggye', '청계천', 37.5692, 126.9779, '12', NONE),
  A('myeongdongcathedral', '명동대성당', 37.5633, 126.9873, '12', acc({ ramp: true })),
  A('myeongdongst', '명동거리', 37.5636, 126.985, '12', NONE, { tags: ['crowded'], lcls: ['VE', 'VE04', 'VE040100'] }),
  A('namsangol', '남산골한옥마을', 37.5593, 126.9946, '12', acc({ parking: true, ramp: true, restroom: true, wheelchair: true })),
  A('sungnyemun', '숭례문', 37.56, 126.9752, '12', acc({ ramp: true })),
  A('seoullo', '서울로7017', 37.5568, 126.9707, '12', acc({ elevator: true, ramp: true })),
  A('nseoultower', 'N서울타워', 37.5512, 126.9882, '12', acc({ elevator: true, restroom: true }), { tags: ['hill'] }),
  A('baekbeom', '남산공원 백범광장', 37.556, 126.983, '12', NONE),
  A('historymuseum', '서울역사박물관', 37.5703, 126.9703, '14', acc({ parking: true, elevator: true, restroom: true, wheelchair: true })),
];

/** 쇼핑(38) — 취향에서 시장·쇼핑을 고를 때만 후보로 받음 */
export const SAMPLE_SHOPPING: Place[] = [
  A('namdaemun', '남대문시장', 37.5592, 126.9776, '38', NONE, { tags: ['crowded'], lcls: ['SH', 'SH06', 'SH060200'] }),
  A('jungbu', '중부시장', 37.5672, 126.9965, '38', NONE, { tags: ['crowded'], lcls: ['SH', 'SH06', 'SH060200'] }),
];

/** 숙소(32) — 가상의 이름. 무장애 정보도 예시 값 */
export const SAMPLE_LODGINGS: Place[] = [
  { id: 'sample:hotel-myeongdong', source: 'sample', kind: 'lodging', name: '명동 호텔 (예시)', pos: { lat: 37.5622, lng: 126.9842 }, contentTypeId: '32', lcls: ['AC', 'AC01', 'AC010100'], access: acc({ elevator: true, parking: true, restroom: true }) },
  { id: 'sample:hotel-cityhall', source: 'sample', kind: 'lodging', name: '시청 호텔 (예시)', pos: { lat: 37.5668, lng: 126.9795 }, contentTypeId: '32', lcls: ['AC', 'AC01', 'AC010100'], access: acc({ elevator: true, ramp: true }) },
  { id: 'sample:hanok-namsan', source: 'sample', kind: 'lodging', name: '남산 한옥스테이 (예시)', pos: { lat: 37.5588, lng: 126.9905 }, contentTypeId: '32', lcls: ['AC', 'AC03', 'AC030200'], access: NONE },
  { id: 'sample:residence-seoulst', source: 'sample', kind: 'lodging', name: '서울역 레지던스 (예시)', pos: { lat: 37.5558, lng: 126.9725 }, contentTypeId: '32', lcls: ['AC', 'AC02', 'AC020200'], access: acc({ elevator: true, parking: true }) },
  { id: 'sample:guesthouse', source: 'sample', kind: 'lodging', name: '을지로 게스트하우스 (예시)', pos: { lat: 37.5665, lng: 126.989 }, contentTypeId: '32', lcls: ['AC', 'AC06', 'AC060200'], access: NONE },
];

export const SAMPLE_RESTAURANTS: Place[] = [
  F('gomtang', '정동 곰탕집 (예시)', 37.5663, 126.9735, '곰탕, 수육', NONE),
  F('kalguksu', '명동 칼국수집 (예시)', 37.5627, 126.9858, '칼국수, 만두', acc({ ramp: true })),
  F('hanjeongsik', '남산 한정식 (예시)', 37.5585, 126.9925, '한정식, 불고기', acc({ parking: true, ramp: true, restroom: true })),
  F('gukbap', '시청 국밥집 (예시)', 37.5648, 126.977, '순대국밥, 수육', acc({ ramp: true })),
  F('naengmyeon', '을지로 냉면집 (예시)', 37.5662, 126.991, '평양냉면, 편육', acc({ parking: true })),
  F('pasta', '명동 파스타 (예시)', 37.564, 126.984, '파스타, 스테이크', acc({ elevator: true, restroom: true })),
  F('baekban', '회현 백반집 (예시)', 37.5585, 126.98, '백반, 생선구이', NONE),
  F('jjamppong', '남대문 짬뽕집 (예시)', 37.5594, 126.977, '짬뽕, 짜장면', NONE, { tags: ['crowded'] }),
];

export const SAMPLE_CAFES: Place[] = [
  C('cafe-jeongdong', '정동 카페 (예시)', 37.5662, 126.9728),
  C('cafe-cityhall', '시청 카페 (예시)', 37.5652, 126.9772),
  C('cafe-myeongdong', '명동 카페 (예시)', 37.5638, 126.9862),
  C('cafe-namsangol', '남산골 카페 (예시)', 37.5598, 126.9935),
  C('cafe-namdaemun', '남대문 카페 (예시)', 37.5597, 126.9785),
  C('cafe-seoullo', '서울로 카페 (예시)', 37.5573, 126.9715),
  C('cafe-namsan', '남산 카페 (예시)', 37.553, 126.9875),
  C('cafe-museum', '신문로 카페 (예시)', 37.5698, 126.9712),
  C('cafe-cheonggye', '청계 카페 (예시)', 37.5688, 126.979),
];

/** 지역·출발 장소 검색용 예시 지명 (대략적 좌표) */
export const SAMPLE_GAZETTEER: GeoResult[] = [
  { name: '서울 중구 · 명동', addr: '서울 중구 명동', pos: { lat: 37.5636, lng: 126.9834 }, source: 'sample' },
  { name: '서울 중구 · 정동', addr: '서울 중구 정동', pos: { lat: 37.5657, lng: 126.9735 }, source: 'sample' },
  { name: '서울 중구 · 남산', addr: '서울 중구 예장동', pos: { lat: 37.5575, lng: 126.988 }, source: 'sample' },
  { name: '서울역 인근 숙소', addr: '서울 중구 봉래동2가 서울역 일대', pos: { lat: 37.5547, lng: 126.9707 }, source: 'sample' },
  { name: '서울역', addr: '서울 용산구 동자동', pos: { lat: 37.5547, lng: 126.9707 }, source: 'sample' },
  { name: '시청역', addr: '서울 중구 태평로1가', pos: { lat: 37.5657, lng: 126.9769 }, source: 'sample' },
  { name: '명동역', addr: '서울 중구 충무로2가', pos: { lat: 37.5609, lng: 126.9863 }, source: 'sample' },
  { name: '을지로입구역', addr: '서울 중구 을지로1가', pos: { lat: 37.566, lng: 126.9826 }, source: 'sample' },
  { name: '회현역', addr: '서울 중구 남창동', pos: { lat: 37.5585, lng: 126.9783 }, source: 'sample' },
  { name: '충무로역', addr: '서울 중구 필동', pos: { lat: 37.5612, lng: 126.9942 }, source: 'sample' },
];
