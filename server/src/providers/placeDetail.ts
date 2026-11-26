// 장소 상세 (화면 ④에서 장소를 누르면) — 네이버·카카오 지도의 장소 화면처럼
//  - TourAPI detailCommon2 : 소개(overview)·전화·홈페이지·대표 사진
//  - TourAPI detailImage2  : 사진 여러 장 (imageYN=Y, originimgurl)
//  - TourAPI detailIntro2  : 관광타입별 이용시간·쉬는 날·요금·메뉴·체크인 등
//  - 카카오 키워드 검색     : 카카오맵 장소 페이지 링크 (메뉴 가격·리뷰·사진은 카카오맵에서)
//  - 카카오 카테고리 AT4    : 근처 관광명소
// TourAPI 에는 음식점 가격 정보가 없어 '카카오맵에서 보기'로 연결합니다.

import { kakaoMapLink, type PlaceDetail, type PlaceRef } from '@hyodo/core';
import { env } from '../env.ts';
import { log, TtlCache } from '../http.ts';
import { kakaoFindPlace, kakaoNearbySpots } from './kakao.ts';
import { dataGoKr } from './tourApi.ts';

const cache = new TtlCache<PlaceDetail>(500);
const H24 = 24 * 3600_000;

/** HTML 을 줄바꿈이 남은 평문으로 */
export function plain(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** homepage 필드는 <a href="…">…</a> 형태일 때가 많음 */
export function firstUrl(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  const m = s.match(/https?:\/\/[^\s"'<>]+/);
  return m ? m[0] : undefined;
}

const https = (u: string) => u.replace(/^http:\/\//, 'https://');

/** detailIntro2 필드 → 화면에 보여 줄 항목 (관광타입별 필드명은 실제 응답으로 확인) */
const INTRO_FIELDS: Record<string, [string, string][]> = {
  '12': [
    ['usetime', '이용시간'],
    ['restdate', '쉬는 날'],
    ['parking', '주차'],
    ['infocenter', '문의'],
  ],
  '14': [
    ['usetimeculture', '이용시간'],
    ['restdateculture', '쉬는 날'],
    ['usefee', '이용요금'],
    ['parkingculture', '주차'],
    ['infocenterculture', '문의'],
  ],
  '39': [
    ['firstmenu', '대표 메뉴'],
    ['treatmenu', '취급 메뉴'],
    ['opentimefood', '영업시간'],
    ['restdatefood', '쉬는 날'],
    ['parkingfood', '주차'],
    ['chkcreditcardfood', '카드'],
    ['infocenterfood', '문의'],
  ],
  '32': [
    ['checkintime', '체크인'],
    ['checkouttime', '체크아웃'],
    ['roomtype', '객실'],
    ['parkinglodging', '주차'],
    ['subfacility', '부대시설'],
    ['infocenterlodging', '문의'],
  ],
  '38': [
    ['opentime', '영업시간'],
    ['fairday', '장날'],
    ['restdateshopping', '쉬는 날'],
    ['saleitem', '판매 품목'],
    ['saleitemcost', '가격'],
    ['parkingshopping', '주차'],
    ['infocentershopping', '문의'],
  ],
};

async function tourParts(contentId: string, typeId: string | undefined) {
  const key = env.tourApiKey!;
  const [common, images, intro] = await Promise.all([
    dataGoKr('KorService2', 'detailCommon2', { contentId }, key, H24).catch((e) => {
      log('detailCommon2 실패', (e as Error).message);
      return [] as any[];
    }),
    dataGoKr('KorService2', 'detailImage2', { contentId, imageYN: 'Y', numOfRows: 12, pageNo: 1 }, key, H24).catch((e) => {
      log('detailImage2 실패', (e as Error).message);
      return [] as any[];
    }),
    typeId
      ? dataGoKr('KorService2', 'detailIntro2', { contentId, contentTypeId: typeId }, key, H24).catch((e) => {
          log('detailIntro2 실패', (e as Error).message);
          return [] as any[];
        })
      : Promise.resolve([] as any[]),
  ]);
  return { c: common[0], images, it: intro[0] };
}

export async function placeDetail(ref: PlaceRef): Promise<PlaceDetail> {
  const ck = `${ref.id}|${ref.name}`;
  const hit = cache.get(ck);
  if (hit) return hit;

  const out: PlaceDetail = {
    id: ref.id,
    images: [],
    info: [],
    kakaoUrl: kakaoMapLink(ref.name, ref.pos),
    kakaoUrlKind: 'map',
    nearby: [],
    source: 'kakao',
  };

  const tourId = ref.id.startsWith('tour:') ? ref.id.slice(5) : null;
  const jobs: Promise<unknown>[] = [];

  if (tourId && env.tourApiKey) {
    out.source = 'tourapi';
    jobs.push(
      tourParts(tourId, ref.contentTypeId).then(({ c, images, it }) => {
        const imgs: string[] = [];
        for (const im of images) if (im?.originimgurl) imgs.push(https(String(im.originimgurl)));
        if (c?.firstimage && !imgs.includes(https(c.firstimage))) imgs.unshift(https(c.firstimage));
        out.images = imgs.slice(0, 10);
        const ov = plain(c?.overview);
        if (ov) out.overview = ov.length > 1200 ? `${ov.slice(0, 1200)}…` : ov;
        const tel = plain(c?.tel);
        if (tel) out.tel = tel;
        out.homepage = firstUrl(c?.homepage);
        const typeId = ref.contentTypeId ?? String(c?.contenttypeid ?? '');
        for (const [field, label] of INTRO_FIELDS[typeId] ?? []) {
          const v = plain(it?.[field]);
          if (v && v !== '0') out.info.push({ label, value: v.length > 300 ? `${v.slice(0, 300)}…` : v });
        }
        if (c?.addr1) out.info.unshift({ label: '주소', value: `${plain(c.addr1)}${c.addr2 ? ` ${plain(c.addr2)}` : ''}` });
      }),
    );
  }

  if (env.kakaoRestKey) {
    const kakaoId = ref.id.startsWith('kakao:') ? ref.id.slice(6) : null;
    if (kakaoId) {
      out.kakaoUrl = `https://place.map.kakao.com/${kakaoId}`;
      out.kakaoUrlKind = 'place';
    } else {
      jobs.push(
        kakaoFindPlace(ref.name, ref.pos)
          .then((k) => {
            if (!k) return;
            out.kakaoUrl = k.url;
            out.kakaoUrlKind = 'place';
            if (!out.tel && k.phone) out.tel = k.phone;
          })
          .catch((e) => log('카카오 장소 찾기 실패', (e as Error).message)),
      );
    }
    jobs.push(
      kakaoNearbySpots(ref.name, ref.pos)
        .then((n) => {
          out.nearby = n;
        })
        .catch((e) => log('카카오 근처 명소 실패', (e as Error).message)),
    );
  }

  await Promise.all(jobs);
  if (!out.info.some((x) => x.label === '주소') && ref.addr) out.info.unshift({ label: '주소', value: ref.addr });
  cache.set(ck, out, H24);
  return out;
}
