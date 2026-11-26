// 팀원 QA 반영: 1 취향 항목 확장·기타 입력 / 3 장소 상세(예시) / 4-2 여러 날 일정·숙소
import { describe, expect, it } from 'vitest';
import {
  addDays,
  categoryCheck,
  createSampleProviders,
  INTEREST_RULES,
  lodgingCheck,
  marketClosedOn,
  normalizePrefs,
  planJourney,
  planTrip,
  prefScore,
  sameSpot,
  sampleDetail,
  splitEtc,
  type ConditionInput,
  type Place,
  type PlanRequest,
} from '../src/index.ts';

const cond: ConditionInput = {
  walkLimitMin: 30,
  restEveryMin: 90,
  pace: 'slow',
  needs: { stepFree: false, parking: false },
  lunchTime: '12:00',
  dinnerTime: null,
};

const baseReq: PlanRequest = {
  trip: {
    regionName: '서울 중구 · 명동',
    center: { lat: 37.5636, lng: 126.9834 },
    date: '2026-12-12',
    startTime: '10:00',
    endTime: '17:00',
    origin: { name: '서울역', pos: { lat: 37.5547, lng: 126.9707 } },
    returnToOrigin: true,
  },
  condition: cond,
  prefs: null,
};

const P = (name: string, extra: Partial<Place> = {}): Place => ({
  id: `t:${name}`,
  source: 'tourapi',
  kind: 'attraction',
  name,
  pos: { lat: 37.56, lng: 126.98 },
  ...extra,
});

describe('취향 항목 확장 (QA 1)', () => {
  it('기타 입력: 목록 항목·별칭은 그 항목으로, 나머지는 키워드로', () => {
    expect(splitEtc('바닷가, 성당 / 야경')).toEqual(['바닷가', '성당', '야경']);
    const p = normalizePrefs({ foods: [], interests: ['궁궐'], activities: [], etc: { interests: '바닷가, 성당', foods: '회' } })!;
    expect(p.interests).toEqual(['궁궐', '바다', '성당']);
    expect(p.foods).toEqual(['해산물']);
    expect(p.custom).toEqual(['성당']);
  });

  it('기타 키워드가 장소 이름에 있으면 가산점', () => {
    const p = normalizePrefs({ foods: [], interests: [], activities: [], etc: { interests: '성당' } });
    const s = prefScore(P('약현성당'), p, null);
    expect(s.matched).toContain('성당');
    expect(s.bonus).toBeGreaterThan(0.5);
  });

  it('새 관심사는 실제 신분류 코드로 매칭 (사찰 HS0301 · 온천 EX0501 · 전통체험 EX01)', () => {
    const p = { foods: [], interests: ['사찰', '온천', '전통체험'], activities: [] };
    expect(prefScore(P('어느 곳', { lcls: ['HS', 'HS03', 'HS030100'] }), p, null).matched).toContain('사찰');
    expect(prefScore(P('힐링원', { lcls: ['EX', 'EX05', 'EX050100'] }), p, null).matched).toContain('온천');
    expect(prefScore(P('체험관', { lcls: ['EX', 'EX01', 'EX010100'] }), p, null).matched).toContain('전통체험');
  });

  it("'바다'는 공항을 항구로 보지 않는다", () => {
    expect(INTEREST_RULES['바다'].re.test('인천국제공항')).toBe(false);
    expect(INTEREST_RULES['바다'].re.test('주문진항')).toBe(true);
  });

  it('쇼핑(38)은 시장·백화점 등만, 공연장은 공연 관람을 고를 때만', () => {
    expect(categoryCheck(P('면세점 매장', { contentTypeId: '38', lcls: ['SH', 'SH04', 'SH040300'] })).excluded).toBe(true);
    expect(categoryCheck(P('광장시장', { contentTypeId: '38', lcls: ['SH', 'SH06', 'SH060200'] })).excluded).toBe(false);
    const hall = P('아트홀', { contentTypeId: '14', lcls: ['VE', 'VE06', 'VE060100'] });
    expect(categoryCheck(hall).excluded).toBe(true);
    expect(categoryCheck(hall, { foods: [], interests: [], activities: ['공연 관람'] }).excluded).toBe(false);
    const cinema = P('영화관', { contentTypeId: '14', lcls: ['VE', 'VE06', 'VE060200'] });
    expect(categoryCheck(cinema, { foods: [], interests: [], activities: ['공연 관람'] }).excluded).toBe(true);
  });

  it("5일장: '(5, 10일)'은 날짜 끝자리 5·0인 날만 연다", () => {
    expect(marketClosedOn('발안만세시장 (5, 10일)', '2026-11-25')).toBe(false);
    expect(marketClosedOn('발안만세시장 (5, 10일)', '2026-11-30')).toBe(false);
    expect(marketClosedOn('발안만세시장 (5, 10일)', '2026-11-26')).toBe(true);
    expect(marketClosedOn('남대문시장', '2026-11-26')).toBe(false);
  });

  it('시장을 고르면 쇼핑 장소도 후보로 받아 일정에 넣는다 (고르지 않으면 안 받음)', async () => {
    const withMarket = await planTrip({ ...baseReq, prefs: { foods: [], interests: ['시장'], activities: [] } }, createSampleProviders());
    expect(withMarket.stops.some((s) => s.place.name.includes('시장'))).toBe(true);
    const plain = await planTrip(baseReq, createSampleProviders());
    const all = [...plain.stops.map((s) => s.place), ...plain.alternatives.attractions];
    expect(all.some((p) => p.contentTypeId === '38')).toBe(false);
  });

  it('기타로 적은 말에 맞는 곳이 없으면 알려 준다', async () => {
    const r = await planTrip(
      { ...baseReq, prefs: { foods: [], interests: [], activities: [], etc: { interests: '케이블카' } } },
      createSampleProviders(),
    );
    expect(r.warnings.some((w) => w.includes("'케이블카'"))).toBe(true);
  });
});

describe('장소 상세 (QA 3, 예시 데이터)', () => {
  it('카카오맵 지도 링크와 근처 장소를 준다', () => {
    const d = sampleDetail({ id: 'sample:deoksugung', name: '덕수궁', pos: { lat: 37.5658, lng: 126.9752 } });
    expect(d.kakaoUrl).toContain('map.kakao.com/link/map/');
    expect(d.nearby.length).toBeGreaterThan(0);
    expect(d.nearby.every((n) => n.distance <= 700)).toBe(true);
    expect(d.nearby.some((n) => n.name === '덕수궁')).toBe(false);
  });
});

describe('여러 날 일정·숙소 (QA 4-2)', () => {
  it('날짜 더하기', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('게스트하우스·캠핑은 숙소 추천에서 뺀다', () => {
    expect(lodgingCheck(P('어느 게스트하우스', { lcls: ['AC', 'AC06', 'AC060200'] })).excluded).toBe(true);
    expect(lodgingCheck(P('어느 호텔', { lcls: ['AC', 'AC01', 'AC010100'] })).bonus).toBeGreaterThan(0);
  });

  it('1박 2일: 1일차는 숙소에서 끝나고 2일차는 숙소에서 시작해 출발 장소로 돌아온다', async () => {
    const r = await planJourney({ ...baseReq, nights: 1 }, createSampleProviders());
    expect(r.days).toHaveLength(2);
    expect(r.lodging).not.toBeNull();
    expect(r.lodgingSource).toBe('recommended');
    expect(r.lodging!.name).not.toContain('게스트하우스');
    const [d1, d2] = r.days;
    expect(d1.date).toBe('2026-12-12');
    expect(d2.date).toBe('2026-12-13');
    expect(d1.stops[0].place.name).toBe('서울역');
    expect(d1.stops.at(-1)!.type).toBe('end');
    expect(d1.stops.at(-1)!.place.kind).toBe('lodging');
    expect(d2.stops[0].place.kind).toBe('lodging');
    expect(d2.stops.at(-1)!.place.name).toBe('서울역');
  });

  it('다른 날에 간 관광지·식당은 다시 넣지 않는다', async () => {
    const r = await planJourney({ ...baseReq, nights: 1 }, createSampleProviders());
    const [d1, d2] = r.days.map((d) => d.stops.filter((s) => s.type === 'visit' || s.type === 'meal').map((s) => s.place));
    for (const p of d2) expect(d1.some((q) => q.id === p.id || (p.kind === 'attraction' && sameSpot(p, q)))).toBe(false);
    for (const p of r.days[0].alternatives.attractions) expect(d2.some((q) => q.id === p.id)).toBe(false);
  });

  it('직접 정한 숙소를 그대로 쓴다', async () => {
    const r = await planJourney(
      { ...baseReq, nights: 1, lodging: { name: '우리 숙소', pos: { lat: 37.5605, lng: 126.98 } } },
      createSampleProviders(),
    );
    expect(r.lodgingSource).toBe('user');
    expect(r.days[0].stops.at(-1)!.place.name).toBe('우리 숙소');
    expect(r.days[1].stops[0].place.name).toBe('우리 숙소');
  });

  it('숙소 바꾸기: 고정한 장소는 그대로, 숙소만 바뀐다', async () => {
    const a = await planJourney({ ...baseReq, nights: 1 }, createSampleProviders());
    const alt = a.lodgingAlternatives[0];
    expect(alt).toBeDefined();
    const days = a.days.map((d) => ({
      includeIds: d.stops.filter((s) => s.type === 'visit').map((s) => s.place.id),
      pinnedMeals: Object.fromEntries(d.stops.filter((s) => s.type === 'meal').map((s) => [s.mealLabel ?? 'lunch', s.place.id])),
      lockAttractions: true,
    }));
    const b = await planJourney(
      { ...baseReq, nights: 1, days, lodging: { name: alt.name, pos: alt.pos, id: alt.id, recommended: true } },
      createSampleProviders(),
    );
    expect(b.lodging!.id).toBe(alt.id);
    expect(b.lodgingAlternatives.some((p) => p.id === a.lodging!.id)).toBe(true);
    const ids = (r: typeof a) => r.days.map((d) => d.stops.filter((s) => s.type === 'visit').map((s) => s.place.id).sort());
    expect(ids(b)).toEqual(ids(a));
  });

  it('당일치기는 숙소 없이 하루', async () => {
    const r = await planJourney(baseReq, createSampleProviders());
    expect(r.days).toHaveLength(1);
    expect(r.lodging).toBeNull();
  });
});
