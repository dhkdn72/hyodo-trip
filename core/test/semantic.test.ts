// 의미 기반 추천 (임베딩) — 모델 대신 가짜 점수로 엔진 연결을 검사
import { describe, expect, it } from 'vitest';
import {
  bigrams,
  customHit,
  bm25Scorer,
  createSampleProviders,
  nameKeywordScore,
  planTrip,
  rankBy,
  rankMetrics,
  semanticBonus,
  semanticQueries,
  zscores,
  type PlanRequest,
  type Providers,
} from '../src/index.ts';

const baseReq: PlanRequest = {
  trip: {
    regionName: '서울 중구',
    center: { lat: 37.5636, lng: 126.9834 },
    date: '2026-12-12',
    startTime: '10:00',
    endTime: '17:00',
    origin: { name: '서울역', pos: { lat: 37.5547, lng: 126.9707 } },
    returnToOrigin: true,
  },
  condition: { walkLimitMin: 30, restEveryMin: 90, pace: 'slow', needs: { stepFree: false, parking: false }, lunchTime: '12:00', dinnerTime: null },
  prefs: null,
};

describe('의미 추천 질의', () => {
  it('고른 항목은 설명 문장으로, 기타는 그대로', () => {
    const q = semanticQueries({ foods: [], interests: ['궁궐', '야경'], activities: ['맛집 탐방'] }, null);
    expect(q).toEqual(['조선 왕실의 궁궐과 고궁', '야경']);
  });

  it("부정문('시끄러운 곳은 싫어')은 질의에 넣지 않는다 — 임베딩은 부정을 잘 못 다룸", () => {
    expect(semanticQueries({ foods: [], interests: [], activities: [], freeText: '시끄러운 곳은 싫어하세요' }, null)).toEqual([]);
    expect(semanticQueries({ foods: [], interests: [], activities: [], freeText: '나무 많은 조용한 곳' }, null)).toEqual(['나무 많은 조용한 곳']);
  });

  it('표준화와 가산점 상한', () => {
    const z = zscores(new Map([['a', 0.8], ['b', 0.9], ['c', 1.0]]));
    expect(z.get('b')).toBeCloseTo(0);
    expect(z.get('c')!).toBeGreaterThan(1);
    expect(semanticBonus(10)).toBeCloseTo(0.8);
    expect(semanticBonus(-10)).toBeCloseTo(-0.6);
  });
});

describe('의미 추천 → 일정', () => {
  it('모델 점수가 높은 곳이 들어가고, 추천 이유와 출처가 남는다', async () => {
    const base = createSampleProviders();
    let seenQueries: string[] = [];
    // 가짜 모델: 서울시립미술관만 아주 비슷하다고 답함
    const providers: Providers = {
      ...base,
      semantic: {
        model: 'fake-e5',
        async score(queries, places) {
          seenQueries = queries;
          return { scores: new Map(places.map((p) => [p.id, p.name.includes('시립미술관') ? 0.95 : 0.8])), method: 'fake-e5 + BM25' };
        },
      },
    };
    const r = await planTrip({ ...baseReq, prefs: { foods: [], interests: [], activities: [], etc: { interests: '그림 감상' } } }, providers);
    expect(seenQueries).toEqual(['그림 감상']);
    const visit = r.stops.find((s) => s.place.name.includes('시립미술관'));
    expect(visit).toBeDefined();
    expect(visit!.place.matched).toContain('소개글이 취향과 비슷');
    expect(r.dataSources.recommend).toBe('semantic');
    expect(r.dataSources.recommendModel).toBe('fake-e5 + BM25');
    expect(r.pipeline[0].detail).toContain('의미 추천(fake-e5 + BM25)');
  });

  it('모델을 못 쓰면(null) 규칙만으로 계속', async () => {
    const providers: Providers = { ...createSampleProviders(), semantic: { model: 'x', score: async () => null } };
    const r = await planTrip({ ...baseReq, prefs: { foods: [], interests: ['궁궐'], activities: [] } }, providers);
    expect(r.dataSources.recommend).toBe('rule');
    expect(r.stops.some((s) => s.type === 'visit')).toBe(true);
  });
});

describe('기타 입력 키워드 매칭', () => {
  it('띄어 쓴 말은 낱말이 모두 있어야 맞음 (전통만 겹치는 곳은 아님)', () => {
    expect(customHit('전통 술 빚기', '전주전통한지원')).toBe(false);
    expect(customHit('전통 술', '전주 전통술박물관')).toBe(true);
    expect(customHit('성당', '서울 명동성당')).toBe(true);
  });
});

describe('평가 도구', () => {
  it('순위 지표', () => {
    const m = rankMetrics(['a', 'x', 'b', 'y', 'z'], new Set(['a', 'b']));
    expect(m.p5).toBeCloseTo(0.4);
    expect(m.r10).toBe(1);
    expect(m.rr).toBe(1);
    expect(m.ndcg10).toBeCloseTo((1 + 1 / Math.log2(4)) / (1 + 1 / Math.log2(3)));
  });

  it('BM25(글자 2개씩)는 조사가 붙어도 찾는다', () => {
    expect(bigrams('정원을')).toEqual(['정원', '원을']);
    const docs = new Map([
      ['p1', '비원. 창덕궁 후원의 연못과 숲이 있는 정원'],
      ['p2', '서울역. 기차역'],
    ]);
    const bm = bm25Scorer(docs);
    expect(bm('조용한 정원을 걷고 싶어요', 'p1')).toBeGreaterThan(bm('조용한 정원을 걷고 싶어요', 'p2'));
    expect(rankBy(['p2', 'p1'], (id) => bm('정원', id))).toEqual(['p1', 'p2']);
  });

  it('지금 방식(이름 키워드)은 이름에 낱말이 있어야만 맞는다', () => {
    expect(nameKeywordScore('성당, 야경', '명동성당')).toBe(1);
    expect(nameKeywordScore('그림 감상', '서울시립미술관')).toBe(0);
  });
});
