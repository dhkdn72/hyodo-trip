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
    // 중심에서 가까운 순
    expect(list.map((p) => p.name)).toEqual(['미술관', '경복궁']);
    expect(list[1]).toMatchObject({ id: 'tour:126508', pos: { lat: 37.5796, lng: 126.977 }, contentTypeId: '12', image: 'https://img' });
    const tourCall = calls.find((c) => c.url.includes('contentTypeId=12'))!;
    expect(tourCall.url).toContain('serviceKey=TEST%2BKEY%2F%3D%3D&');
    expect(tourCall.url).toContain('mapX=126.98');
    expect(tourCall.url).toContain('arrange=E');
  });

  it('반경을 덮는 시군구 법정동 코드로 areaBasedList2 를 불러 합치고, 반경 밖은 버린다', async () => {
    const { tourSearch } = await import('../src/providers/tourApi.ts');
    handler = (url) => {
      if (url.includes('coord2regioncode'))
        return { body: { documents: [{ region_type: 'B', code: '1114010300' }, { region_type: 'H', code: '1114055000' }] } };
      if (url.includes('areaBasedList2') && url.includes('lDongRegnCd=11') && url.includes('lDongSignguCd=140') && url.includes('contentTypeId=12'))
        return {
          body: okTour([
            { contentid: '126509', contenttypeid: '12', title: '덕수궁', mapx: '126.9765746344', mapy: '37.5650549194', lDongRegnCd: '11', lDongSignguCd: '140', lclsSystm3: 'HS010100' },
            { contentid: '999', contenttypeid: '12', title: '먼 곳', mapx: '127.2', mapy: '37.7', lDongRegnCd: '11', lDongSignguCd: '140' },
          ]),
        };
      return { body: okTour('') };
    };
    const list = await tourSearch({ lat: 37.5636, lng: 126.9834 }, 3000, 'attraction');
    expect(list.map((p) => p.name)).toEqual(['덕수궁']);
    expect(list[0].lDong).toEqual({ regn: '11', signgu: '140' });
    expect(calls.some((c) => c.url.includes('coord2regioncode'))).toBe(true);
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

describe('장소 상세 (TourAPI 상세 + 카카오)', () => {
  it('detailCommon2·detailImage2·detailIntro2(음식점)와 카카오 장소 링크·근처 명소를 합친다', async () => {
    const { placeDetail } = await import('../src/providers/placeDetail.ts');
    handler = (url) => {
      if (url.includes('/detailCommon2'))
        return {
          body: okTour({
            contentid: '232229',
            contenttypeid: '39',
            title: '강서면옥',
            tel: '',
            homepage: '<a href="https://example.com/menu" target="_blank">example.com</a>',
            firstimage: '',
            overview: '평양냉면 전문점이다.<br>1953년 문을 열었다.',
            addr1: '서울특별시 중구 세종대로11길 35',
          }),
        };
      if (url.includes('/detailImage2'))
        return { body: okTour([{ originimgurl: 'http://tong.visitkorea.or.kr/a.jpg', smallimageurl: 'http://tong.visitkorea.or.kr/a_s.jpg', serialnum: '1' }]) };
      if (url.includes('/detailIntro2'))
        return {
          body: okTour({
            firstmenu: '평양물냉면',
            treatmenu: '함흥비빔냉면 / 모듬 버섯구이',
            opentimefood: '11:00~22:00 (준비시간 15:00~17:00)',
            restdatefood: '설·추석 연휴',
            parkingfood: '가능',
            chkcreditcardfood: '가능',
            infocenterfood: '02-752-1945',
          }),
        };
      if (url.includes('/search/keyword.json'))
        return { body: { documents: [{ place_name: '강서면옥', place_url: 'http://place.map.kakao.com/8157826', phone: '02-752-1945', category_name: '음식점 > 한식 > 냉면' }] } };
      if (url.includes('/search/category.json'))
        return {
          body: {
            documents: [
              { place_name: '강서면옥', distance: '5', category_name: '여행 > 관광,명소' },
              { place_name: '덕수궁', distance: '420', category_name: '여행 > 관광,명소 > 문화유적 > 고궁,궁', place_url: 'http://place.map.kakao.com/10305191' },
              { place_name: '서울도보관광코스', distance: '300', category_name: '여행 > 관광,명소 > 도보여행' },
            ],
          },
        };
      return { body: okTour('') };
    };
    const d = await placeDetail({ id: 'tour:232229', name: '강서면옥', pos: { lat: 37.5614, lng: 126.9748 }, contentTypeId: '39' });
    expect(d.source).toBe('tourapi');
    expect(d.images).toEqual(['https://tong.visitkorea.or.kr/a.jpg']);
    expect(d.overview).toBe('평양냉면 전문점이다.\n1953년 문을 열었다.');
    expect(d.homepage).toBe('https://example.com/menu');
    expect(d.info.map((r) => r.label)).toEqual(['주소', '대표 메뉴', '취급 메뉴', '영업시간', '쉬는 날', '주차', '카드', '문의']);
    expect(d.kakaoUrl).toBe('https://place.map.kakao.com/8157826');
    expect(d.kakaoUrlKind).toBe('place');
    expect(d.nearby).toEqual([{ name: '덕수궁', distance: 420, category: '고궁,궁', url: 'https://place.map.kakao.com/10305191' }]);
    const img = calls.find((c) => c.url.includes('/detailImage2'))!;
    expect(img.url).toContain('imageYN=Y');
  });

  it('카카오 장소를 못 찾으면 이름·좌표로 만든 지도 링크', async () => {
    const { placeDetail } = await import('../src/providers/placeDetail.ts');
    handler = (url) => (url.includes('dapi.kakao.com') ? { body: { documents: [] } } : { body: okTour('') });
    const d = await placeDetail({ id: 'kakao:999', name: '어느 카페', pos: { lat: 37.5, lng: 127 } });
    expect(d.kakaoUrl).toBe('https://place.map.kakao.com/999');
    const e = await placeDetail({ id: 'user:lodging', name: '우리 숙소', pos: { lat: 37.5, lng: 127 } });
    expect(e.kakaoUrlKind).toBe('map');
    expect(e.kakaoUrl).toBe(`https://map.kakao.com/link/map/${encodeURIComponent('우리 숙소')},37.5,127`);
  });

  it('/api/place 쿼리 검사', async () => {
    const { parsePlaceRef } = await import('../src/validate.ts');
    expect(parsePlaceRef({ id: 'tour:1', name: '덕수궁', lat: '37.5', lng: '126.9', type: '12' })).toMatchObject({ id: 'tour:1', contentTypeId: '12' });
    expect(parsePlaceRef({ id: 'javascript:alert(1)', name: 'x', lat: '37', lng: '127' })).toBeNull();
    expect(parsePlaceRef({ id: 'tour:1', name: '', lat: '37', lng: '127' })).toBeNull();
    expect(parsePlaceRef({ id: 'tour:1', name: 'x', lat: '999', lng: '127' })).toBeNull();
  });
});
