// 외부 API 어댑터의 응답 파싱 테스트.
// 실제 API 를 부르지 않고, 각 API 문서에 나온 응답 구조대로 만든 모의 응답(fetch stub)으로 검사합니다.
// → 키를 넣은 뒤 실제 응답이 문서와 다르면 이 테스트의 모의 응답을 실제 응답으로 바꿔 다시 맞추세요.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.TOUR_API_KEY = 'TEST+KEY/==';
process.env.KAKAO_REST_API_KEY = 'kakao-test';

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown };
let handler: Handler;
const calls: { url: string; init?: RequestInit }[] = [];

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status });
  });
});
afterEach(() => {
  calls.length = 0;
});

const okTour = (item: unknown) => ({
  response: { header: { resultCode: '0000', resultMsg: 'OK' }, body: { items: item === '' ? '' : { item }, numOfRows: 10, pageNo: 1, totalCount: 1 } },
});

describe('TourAPI KorService2', () => {
  it('locationBasedList2 응답을 장소로 바꾸고, 키를 한 번만 인코딩한다', async () => {
    const { tourSearch } = await import('../src/providers/tourApi.ts');
    handler = (url) => {
      if (url.includes('contentTypeId=12'))
        return {
          body: okTour([
            { contentid: '126508', contenttypeid: '12', title: '경복궁', addr1: '서울 종로구', mapx: '126.9770', mapy: '37.5796', firstimage: 'http://img', lclsSystm1: 'VE', lclsSystm2: 'VE01', lclsSystm3: 'VE010100', dist: '10' },
          ]),
        };
      if (url.includes('contentTypeId=14'))
        return { body: okTour({ contentid: '1', contenttypeid: '14', title: '미술관', mapx: '126.97', mapy: '37.57' }) }; // item 이 객체 하나
      return { body: okTour('') };
    };
    const list = await tourSearch({ lat: 37.57, lng: 126.98 }, 3000, 'attraction');
    expect(list.map((p) => p.name)).toEqual(['경복궁', '미술관']);
    expect(list[0]).toMatchObject({ id: 'tour:126508', pos: { lat: 37.5796, lng: 126.977 }, contentTypeId: '12', image: 'http://img' });
    expect(calls[0].url).toContain('serviceKey=TEST%2BKEY%2F%3D%3D&');
    expect(calls[0].url).toContain('mapX=126.98');
    expect(calls[0].url).toContain('arrange=E');
  });

  it('인증 오류(XML)는 메시지를 담아 실패한다', async () => {
    const { dataGoKr } = await import('../src/providers/tourApi.ts');
    handler = () => ({
      body: '<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>',
    });
    await expect(dataGoKr('KorService2', 'areaCode2', { x: 1 }, 'k')).rejects.toThrow(/SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
  });
});

describe('무장애 여행 정보 KorWithService2', () => {
  it('등록된 곳만 상세를 부르고 배지를 붙인다', async () => {
    const { attachKorWith } = await import('../src/providers/korWith.ts');
    handler = (url) => {
      if (url.includes('KorWithService2/locationBasedList2')) return { body: okTour([{ contentid: '100' }]) };
      if (url.includes('detailWithTour2'))
        return { body: okTour([{ contentid: '100', parking: '장애인 주차장 있음(4대)', route: '출입구까지 완만한 경사로', elevator: '' }]) };
      return { body: okTour('') };
    };
    const places: any[] = [
      { id: 'tour:100', source: 'tourapi', kind: 'attraction', name: 'A', pos: { lat: 37.57, lng: 126.98 } },
      { id: 'tour:200', source: 'tourapi', kind: 'attraction', name: 'B', pos: { lat: 37.571, lng: 126.981 } },
    ];
    await attachKorWith(places);
    expect(calls.filter((c) => c.url.includes('detailWithTour2'))).toHaveLength(1);
    expect(places[0].access.known).toBe(true);
    expect(places[0].access.items.parking.status).toBe('yes');
    expect(places[0].access.items.ramp.status).toBe('yes');
    expect(places[1].access.known).toBe(false);
  });
});

describe('카카오', () => {
  it('도보 경로(편안한 길): totalTime 초·totalDistance m·경로 좌표', async () => {
    const { kakaoWalk } = await import('../src/providers/kakao.ts');
    handler = () => ({
      body: {
        status: 'OK',
        route: {
          properties: { totalDistance: 640, totalTime: 540, landingUrl: 'x' },
          legs: [{ properties: { distance: 640, time: 540 }, steps: [{ properties: { distance: 640, time: 540, guidance: '', x: 1, y: 2 }, path: { points: [[126.97, 37.56], [126.98, 37.57]] } }] }],
        },
      },
    });
    const r = await kakaoWalk({ lat: 37.56, lng: 126.97 }, { lat: 37.57, lng: 126.98 });
    expect(r).toMatchObject({ meters: 640, seconds: 540, source: 'kakao' });
    expect(r.path).toEqual([[126.97, 37.56], [126.98, 37.57]]);
    expect(calls[0].url).toContain('route_mode=ACCESSIBLE');
    expect(calls[0].url).toContain('start_x=126.97');
    expect((calls[0].init?.headers as any).Authorization).toBe('KakaoAK kakao-test');
  });

  it('도보 경로 없음(TOO_FAR_AWAY)은 오류 → 호출부에서 추정치로 대체', async () => {
    const { kakaoWalk } = await import('../src/providers/kakao.ts');
    handler = () => ({ body: { status: 'TOO_FAR_AWAY' } });
    await expect(kakaoWalk({ lat: 37.0, lng: 126.0 }, { lat: 38.0, lng: 127.0 })).rejects.toThrow(/TOO_FAR_AWAY/);
  });

  it('카카오모빌리티 길찾기: duration 초·distance m·택시요금·vertexes', async () => {
    const { kakaoDrive } = await import('../src/providers/kakao.ts');
    handler = () => ({
      body: {
        routes: [
          {
            result_code: 0,
            result_msg: '길찾기 성공',
            summary: { distance: 3100, duration: 610, fare: { taxi: 6100, toll: 0 } },
            sections: [{ roads: [{ vertexes: [126.97, 37.56, 126.975, 37.565, 126.98, 37.57] }] }],
          },
        ],
      },
    });
    const r = await kakaoDrive({ lat: 37.56, lng: 126.97 }, { lat: 37.57, lng: 126.98 });
    expect(r).toMatchObject({ meters: 3100, seconds: 610, taxiFare: 6100, source: 'kakao' });
    expect(r.path).toHaveLength(3);
    expect(calls[0].url).toContain('origin=126.97%2C37.56');
  });

  it('카페 카테고리 검색(CE7)', async () => {
    const { kakaoCafes } = await import('../src/providers/kakao.ts');
    handler = () => ({ body: { documents: [{ id: '9', place_name: '카페', x: '126.97', y: '37.56', road_address_name: '서울' }], meta: {} } });
    const r = await kakaoCafes({ lat: 37.56, lng: 126.97 }, 350);
    expect(r[0]).toMatchObject({ id: 'kakao:9', kind: 'cafe', pos: { lat: 37.56, lng: 126.97 } });
    expect(calls[0].url).toContain('category_group_code=CE7');
  });
});
