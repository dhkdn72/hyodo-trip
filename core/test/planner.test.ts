import { describe, expect, it } from 'vitest';
import {
  sameSpot,
  accessFromKorWith,
  buildLeg,
  closedOn,
  createSampleProviders,
  explanationIsGrounded,
  planTrip,
  ruleFreeText,
  runTimeline,
  stepFreeStatus,
  toMin,
  type ConditionInput,
  type Place,
  type PlanRequest,
  PLAN_DEFAULTS,
} from '../src/index.ts';

const cond: ConditionInput = {
  walkLimitMin: 30,
  restEveryMin: 90,
  pace: 'slow',
  needs: { stepFree: true, parking: false },
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
    origin: { name: '서울역 인근 숙소', pos: { lat: 37.5547, lng: 126.9707 } },
    returnToOrigin: true,
  },
  condition: cond,
  prefs: null,
};

describe('이동 구간 (F1·F2)', () => {
  it("'천천히'는 도보 시간에 1.3배를 곱한다", () => {
    const leg = buildLeg({ meters: 670, seconds: 600, source: 'kakao' }, null, cond);
    expect(leg.walkMinutes).toBe(13);
    expect(leg.mode).toBe('walk');
  });

  it('보행 한도를 넘으면 택시로 바꾸고 호출 대기 시간을 더한다', () => {
    const leg = buildLeg(
      { meters: 2500, seconds: 27 * 60, source: 'kakao' },
      { meters: 3000, seconds: 10 * 60, source: 'kakao', taxiFare: 6100 },
      cond,
    );
    expect(leg.walkMinutes).toBe(35);
    expect(leg.overLimit).toBe(true);
    expect(leg.mode).toBe('taxi');
    expect(leg.minutes).toBe(10 + PLAN_DEFAULTS.taxiPickupMin);
    expect(leg.taxiFare).toBe(6100);
  });
});

describe('무장애 정보 (F3)', () => {
  it('detailWithTour2 텍스트를 배지 상태로 바꾼다', () => {
    const a = accessFromKorWith({
      parking: '장애인 주차장 있음(4대)',
      route: '출입구까지 완만한 경사로가 설치되어 있음',
      elevator: '',
      restroom: '장애인 화장실 없음',
    });
    expect(a.items.parking?.status).toBe('yes');
    expect(a.items.ramp?.status).toBe('yes');
    expect(a.items.elevator?.status).toBe('unknown');
    expect(a.items.restroom?.status).toBe('no');
  });

  it('실제 응답 문구: 무단차·경사로 설치 → 경사로 있음, 가파르거나 어렵다고 하면 확인 필요', () => {
    expect(accessFromKorWith({ exit: '주출입구 무단차관람 동선 내에 전각마다 경사로 설치되어 있음' }).items.ramp?.status).toBe('yes');
    expect(accessFromKorWith({ exit: '주출입구 무단차주출입구 경사로가 가파름' }).items.ramp?.status).toBe('unknown');
    expect(
      accessFromKorWith({ route: '성당으로 접근할 때는 가파른 경사 때문에 어려움이 있지만 입구로 진입하면 내부는 경사 없이 휠체어 이동 가능' }).items.ramp
        ?.status,
    ).toBe('unknown');
  });

  it('긍정·부정이 섞이면 긍정으로 본다', () => {
    const a = accessFromKorWith({ parking: '장애인 주차구역 있음, 요금 없음' });
    expect(a.items.parking?.status).toBe('yes');
  });

  it('계단만 있다고 하면 경사로 없음 → 엘리베이터·경사로 조건에서 제외', () => {
    const a = accessFromKorWith({ exit: '출입구는 계단으로만 이용' });
    const p: Place = { id: 'x', source: 'tourapi', kind: 'attraction', name: 'x', pos: { lat: 0, lng: 0 }, access: a };
    expect(stepFreeStatus(p)).toBe('no');
  });
});

describe('휴무일', () => {
  it("'매주 월요일'은 월요일에만 휴무", () => {
    expect(closedOn('매주 월요일 (공휴일인 경우 개방)', '월')).toBe(true);
    expect(closedOn('매주 월요일', '일')).toBe(false);
    expect(closedOn('매주 일요일', '일')).toBe(true);
    expect(closedOn('연중무휴', '월')).toBe(false);
    expect(closedOn('매주 월, 화요일', '화')).toBe(true);
  });
});

describe('시간표 (F1)', () => {
  it('쉬는 간격을 넘기 전에 휴식을 넣는다', () => {
    const mk = (id: string, lng: number): Place => ({ id, source: 'sample', kind: 'attraction', name: id, pos: { lat: 37.56, lng } });
    const origin = mk('o', 126.97);
    const places = [mk('a', 126.971), mk('b', 126.972), mk('c', 126.973)];
    const tl = runTimeline(
      places.map((p) => ({ type: 'visit' as const, place: p })),
      {
        origin,
        start: toMin('10:00'),
        end: toMin('17:00'),
        returnToOrigin: true,
        cond: { ...cond, restEveryMin: 90 },
        restMin: 20,
        legOf: () => ({ mode: 'walk', minutes: 10, meters: 500, walkMinutes: 10, overLimit: false, walkSource: 'estimate' }),
        d: PLAN_DEFAULTS,
      },
      true,
    );
    // 10 + 60 = 70분 활동 후 다음 방문(10+60)을 하면 140 > 90 → 휴식
    const types = tl.stops.map((s) => s.type);
    expect(types).toEqual(['start', 'visit', 'rest', 'visit', 'rest', 'visit', 'end']);
  });
});

describe('일정 계산 전체 (예시 데이터)', () => {
  it('보행 한도·종료 시각·점심 시각을 지킨다', async () => {
    const r = await planTrip(baseReq, createSampleProviders());
    const legs = r.stops.map((s) => s.legFromPrev).filter(Boolean);
    expect(legs.every((l) => l!.mode === 'taxi' || l!.minutes <= cond.walkLimitMin)).toBe(true);
    expect(r.summary.overflowMin).toBe(0);
    expect(toMin(r.summary.endsAt)).toBeLessThanOrEqual(toMin('17:00'));
    const meal = r.stops.find((s) => s.type === 'meal');
    expect(meal).toBeTruthy();
    expect(Math.abs(toMin(meal!.arrive) - toMin('12:00'))).toBeLessThanOrEqual(PLAN_DEFAULTS.mealLateTolerance);
    expect(r.stops[0].type).toBe('start');
    expect(r.stops[r.stops.length - 1].type).toBe('end');
    expect(r.pipeline.map((p) => p.key)).toEqual(['collect', 'access', 'travel', 'optimize', 'rest', 'explain']);
  });

  it('엘리베이터·경사로 조건이면 정보가 확인된 곳을 우선한다', async () => {
    const r = await planTrip(baseReq, createSampleProviders());
    const visits = r.stops.filter((s) => s.type === 'visit');
    expect(visits.every((s) => stepFreeStatus(s.place) === 'yes')).toBe(true);
  });

  it('같은 입력이면 같은 결과 (결정적)', async () => {
    const a = await planTrip(baseReq, createSampleProviders());
    const b = await planTrip(baseReq, createSampleProviders());
    expect(a.stops.map((s) => s.place.id)).toEqual(b.stops.map((s) => s.place.id));
  });

  it('장소를 빼면 다시 계산해 그 장소가 빠진다', async () => {
    const a = await planTrip(baseReq, createSampleProviders());
    const first = a.stops.find((s) => s.type === 'visit')!.place.id;
    const b = await planTrip({ ...baseReq, excludeIds: [first] }, createSampleProviders());
    expect(b.stops.some((s) => s.place.id === first)).toBe(false);
  });

  it('바꿔 넣은 장소는 반드시 들어간다', async () => {
    const a = await planTrip(baseReq, createSampleProviders());
    const alt = a.alternatives.attractions[0];
    const b = await planTrip({ ...baseReq, includeIds: [alt.id] }, createSampleProviders());
    expect(b.stops.some((s) => s.place.id === alt.id)).toBe(true);
  });

  it('취향(궁궐·한옥)을 고르면 해당 장소가 들어간다', async () => {
    const r = await planTrip(
      { ...baseReq, condition: { ...cond, needs: { stepFree: false, parking: false } }, prefs: { foods: ['국밥'], interests: ['궁궐', '한옥'], activities: [] } },
      createSampleProviders(),
    );
    const names = r.stops.map((s) => s.place.name);
    expect(names.some((n) => n.includes('궁'))).toBe(true);
    expect(names.some((n) => n.includes('한옥'))).toBe(true);
  });

  it("자유 입력 '시끄러운 곳은 싫어하세요' → 시장·쇼핑가 제외", async () => {
    const rule = ruleFreeText('시끄러운 곳은 싫어하세요');
    expect(rule?.avoid).toContain('#crowded');
    const r = await planTrip(
      {
        ...baseReq,
        condition: { ...cond, needs: { stepFree: false, parking: false } },
        prefs: { foods: [], interests: [], activities: [], freeText: '시끄러운 곳은 싫어하세요' },
      },
      createSampleProviders(),
    );
    expect(r.stops.some((s) => s.place.tags?.includes('crowded'))).toBe(false);
  });

  it('템플릿 설명에는 계산된 숫자만 나온다', async () => {
    const r = await planTrip(baseReq, createSampleProviders());
    expect(r.explanation.length).toBeGreaterThan(10);
  });
});

describe('LLM 설명 검증', () => {
  it('주어진 숫자 밖의 숫자를 쓰면 거른다', () => {
    expect(explanationIsGrounded('도보 9분 거리라 묶었어요', [9, 30])).toBe(true);
    expect(explanationIsGrounded('도보 12분 거리라 묶었어요', [9, 30])).toBe(false);
  });
});

describe('화면 ④ 손으로 고치기', () => {
  it('바꾸기는 그 장소만 바뀌고 나머지는 그대로 (lockAttractions)', async () => {
    const a = await planTrip(baseReq, createSampleProviders());
    const visits = a.stops.filter((s) => s.type === 'visit').map((s) => s.place.id);
    const meal = a.stops.find((s) => s.type === 'meal')!.place.id;
    const alt = a.alternatives.attractions[0].id;
    const b = await planTrip(
      { ...baseReq, excludeIds: [visits[0]], includeIds: [...visits.slice(1), alt], pinnedMeals: { lunch: meal }, lockAttractions: true },
      createSampleProviders(),
    );
    const after = b.stops.filter((s) => s.type === 'visit').map((s) => s.place.id).sort();
    expect(after).toEqual([...visits.slice(1), alt].sort());
    expect(b.stops.find((s) => s.type === 'meal')!.place.id).toBe(meal);
  });

  it('고른 음식에 맞는 식당을 우선한다', async () => {
    const r = await planTrip(
      { ...baseReq, condition: { ...cond, needs: { stepFree: false, parking: false } }, prefs: { foods: ['국밥'], interests: [], activities: [] } },
      createSampleProviders(),
    );
    const meal = r.stops.find((s) => s.type === 'meal')!;
    expect(meal.place.menu).toMatch(/곰탕|국밥/);
  });
});

describe('중복 장소', () => {
  const P = (name: string, lat: number, lng: number): Place => ({ id: name, source: 'tourapi', kind: 'attraction', name, pos: { lat, lng } });
  it('덕수궁과 덕수궁 대한문(같은 좌표)은 같은 곳으로 본다', () => {
    expect(sameSpot(P('덕수궁', 37.5650549194, 126.9765746344), P('덕수궁 대한문', 37.5650549194, 126.9765746344))).toBe(true);
  });
  it('이름이 겹쳐도 멀리 떨어져 있으면 다른 곳', () => {
    expect(sameSpot(P('경복궁', 37.5760, 126.9767), P('경복궁', 35.5347, 129.3503))).toBe(false);
  });
  it('가까워도 이름이 다르면 다른 곳 (60m 밖)', () => {
    expect(sameSpot(P('국립고궁박물관', 37.5768, 126.9752), P('경복궁', 37.5760, 126.9767))).toBe(false);
  });
});

describe('반경 (화면 ① 선택 + 자동 확장)', () => {
  it('고른 반경이 결과에 그대로 남는다', async () => {
    const r = await planTrip({ ...baseReq, trip: { ...baseReq.trip, radiusM: 2000 } }, createSampleProviders());
    expect(r.requestedRadiusM).toBe(2000);
    expect(r.radiusM).toBe(2000);
    expect(r.stops.filter((s) => s.type === 'visit').every((s) => (s.place.distFromCenter ?? 0) <= 2000)).toBe(true);
  });

  it('후보가 모자라면 반경을 2배씩 넓히고 안내한다', async () => {
    const r = await planTrip({ ...baseReq, trip: { ...baseReq.trip, radiusM: 300 } }, createSampleProviders());
    expect(r.requestedRadiusM).toBe(300);
    expect(r.radiusM).toBeGreaterThan(300);
    expect(r.radiusM).toBeLessThanOrEqual(1200);
    expect(r.warnings.some((w) => w.includes('넓혀 찾았어요'))).toBe(true);
    expect(r.pipeline[0].detail).toContain('넓힘');
  });

  it('손으로 고친 일정(lockAttractions)은 반경을 넓히지 않는다', async () => {
    const r = await planTrip(
      { ...baseReq, trip: { ...baseReq.trip, radiusM: 300 }, includeIds: ['sample:myeongdongcathedral'], lockAttractions: true },
      createSampleProviders(),
    );
    expect(r.radiusM).toBe(300);
  });
});
