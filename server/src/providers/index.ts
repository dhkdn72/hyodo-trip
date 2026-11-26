// 실제 API 어댑터 조립. 키가 없는 API 는 예시 데이터·직선거리 추정으로 대체됩니다.
//
//  단계            | 키 있음                          | 키 없음
//  1 후보 수집      | TourAPI KorService2 (숙소·쇼핑 포함) | 예시 데이터(서울 중구)
//  장소 상세        | TourAPI 상세·사진 + 카카오 장소   | 예시 상세(지도 링크)
//  2 접근성 필터    | 무장애 여행 정보 KorWithService2 | 예시 데이터
//  3 이동 시간      | 카카오 도보(편안한 길)·카카오모빌리티 | 직선거리 추정
//  5 쉬는 곳        | 카카오 로컬 카테고리(카페)       | 예시 카페
//  6 설명           | LLM                              | 템플릿 문장

import { createSampleProviders, estimateDrive, estimateWalk, sampleDetail, type Providers } from '@hyodo/core';
import { env, llmKind } from '../env.ts';
import { attachKorWith } from './korWith.ts';
import { kakaoCafes, kakaoDrive, kakaoWalk, logKakaoError } from './kakao.ts';
import { llmExplain, llmFreeText } from './llm.ts';
import { placeDetail } from './placeDetail.ts';
import { tourEnrich, tourSearch } from './tourApi.ts';

export function createProviders(): Providers {
  const sample = createSampleProviders();
  const hasTour = !!env.tourApiKey;
  const hasKakao = !!env.kakaoRestKey;
  const hasLlm = !!llmKind();

  return {
    sources: {
      places: hasTour ? 'tourapi' : 'sample',
      access: hasTour && env.korWithApiKey ? 'korwith' : 'sample',
      walk: hasKakao ? 'kakao' : 'estimate',
      taxi: hasKakao ? 'kakao' : 'estimate',
      cafes: hasKakao ? 'kakao' : 'sample',
    },
    searchPlaces: hasTour ? tourSearch : sample.searchPlaces,
    attachAccessibility: hasTour && env.korWithApiKey ? attachKorWith : sample.attachAccessibility,
    enrichDetails: hasTour ? tourEnrich : undefined,
    walk: hasKakao
      ? (a, b) =>
          kakaoWalk(a, b).catch((e) => {
            logKakaoError('도보 경로', e);
            return estimateWalk(a, b);
          })
      : sample.walk,
    drive: hasKakao
      ? (a, b) =>
          kakaoDrive(a, b).catch((e) => {
            logKakaoError('자동차 경로', e);
            return estimateDrive(a, b);
          })
      : sample.drive,
    nearbyCafes: hasKakao
      ? (p, r) =>
          kakaoCafes(p, r).catch((e) => {
            logKakaoError('카페 검색', e);
            return [];
          })
      : sample.nearbyCafes,
    // 예시 장소는 예시 상세, 그 밖에는 TourAPI·카카오 (키가 하나도 없으면 지도 링크만)
    placeDetail: (ref) => (ref.id.startsWith('sample:') || (!hasTour && !hasKakao) ? Promise.resolve(sampleDetail(ref)) : placeDetail(ref)),
    explain: hasLlm ? llmExplain : undefined,
    parseFreeText: hasLlm ? llmFreeText : undefined,
  };
}

export function providerStatus() {
  return {
    tourApi: !!env.tourApiKey,
    korWith: !!(env.tourApiKey && env.korWithApiKey),
    kakao: !!env.kakaoRestKey,
    llm: llmKind(),
  };
}
