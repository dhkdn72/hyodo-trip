# 효도여행 설계 도우미

자녀가 화면 몇 장에 조건을 넣으면 서버가 동선을 계산하고, 부모님께는 큰 글씨 한 장 일정표로 전달합니다.
지금은 **모바일 웹사이트**로 동작하고, 나중에 같은 코드를 앱(Capacitor)으로 감쌀 수 있게 만들었습니다.

## 빠르게 실행

```bash
npm install
npm run dev          # 서버 http://localhost:8787 + 화면 http://localhost:5173
```

API 키가 없어도 바로 돌아갑니다. 키가 없는 단계는 **예시 데이터(서울 중구 일대)·직선거리 추정**으로 대신하고,
화면 ④ 맨 위에 그렇다고 표시합니다. 실제 데이터로 바꾸려면:

```bash
cp .env.example .env   # 키를 채운 뒤 npm run dev 다시 실행
```

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 모드 (서버 + Vite) |
| `npm run build && npm start` | 화면을 빌드해 서버 하나로 제공 (http://localhost:8787) |
| `npm run build:demo` | 서버 없이 브라우저에서 예시 데이터로 도는 한 파일짜리 데모 → `client/dist-demo/index.html` |
| `npm test` | 일정 엔진·API 응답 파싱 테스트 (25개) |
| `npm run typecheck` | 타입 검사 |

`?flow=mvp` 를 주소 뒤에 붙이면 **해커톤 MVP 흐름(① → ② → ④)**, 붙이지 않으면 **학술대회 버전(① ~ ⑤)** 입니다.

## 기획안 ↔ 구현

| 기획안 | 화면 | 구현 위치 |
| --- | --- | --- |
| F1 부모님 컨디션 반영 일정 (보행 한도·휴식 간격·식사 시간, '천천히' 1.3배) | ② → ④ | `core/src/schedule.ts`, `core/src/travel.ts` |
| F2 이동 부담 최소화 동선 (최소 이동 순서, 긴 도보 → 택시) | ④ | `core/src/optimize.ts`, `core/src/travel.ts` |
| F3 무장애·편의시설 (배지, 없으면 '정보 없음', 체크한 시설로 후보 거르기) | ② → ④ | `core/src/access.ts`, `server/src/providers/korWith.ts` |
| F4 취향 설문 → 맞춤 추천 (건너뛰기, 자유 입력 → 조건) | ③ | `core/src/prefs.ts`, `server/src/providers/llm.ts` |
| F5 공유용 한 장 일정표 (이미지·PDF, 카카오톡) | ⑤ | `client/src/screens/ShareScreen.tsx`, `client/src/lib/share.ts` |
| 장소를 빼거나 바꾸면 다시 계산 | ④ | `client/src/App.tsx` (`lockedFrom`), `planTrip` 의 `lockAttractions` |

### 서버가 하는 6단계 (`core/src/planner.ts`)

| 단계 | 키가 있을 때 | 키가 없을 때 |
| --- | --- | --- |
| 1 후보 수집 | TourAPI `KorService2/locationBasedList2` (관광지 12·문화시설 14·음식점 39) | 예시 데이터 |
| 2 접근성 필터 | 무장애 여행 정보 `KorWithService2/locationBasedList2` + `detailWithTour2` | 예시 데이터 |
| 3 이동 시간 계산 | 카카오맵 도보 경로 `GET /v2/routing/walk` (`route_mode=ACCESSIBLE`, 편안한 길) · 카카오모빌리티 `GET /v1/directions` | 직선거리 × 보정계수 |
| 4 순서 최적화 | 우리 코드: 하루 방문지(최대 7곳)의 모든 순서를 비교 | 같음 |
| 5 쉬는 곳 채우기 | 카카오 로컬 카테고리 검색 `CE7`(카페) | 예시 카페 |
| 6 설명 붙이기 | LLM (Anthropic 또는 OpenAI 호환) | 템플릿 문장 |

이동 시간과 순서는 코드가 계산하고, LLM은 문장만 씁니다. LLM 문장에 계산 결과에 없는 숫자가 나오면 버리고 템플릿을 씁니다
(`explanationIsGrounded`). 결과 화면 아래 **서버가 한 일 (6단계)** 에서 단계별 소요 시간·API 호출 수·데이터 출처를 볼 수 있어
발표의 정량 평가 자료로 쓸 수 있습니다.

### 일정 계산 규칙 (튜닝은 `core/src/config.ts`)

- 체류: 관광지 60분, 식사 60분, 휴식 20분 ('구경하며 쉬기'를 고르면 30분 + 관광지 1곳 줄임)
- 걷는 시간 × 1.3 ('천천히'), 보행 한도를 넘는 구간은 택시 (호출 대기 3분 포함)
- 다음 방문까지 활동 시간이 '쉬는 간격'을 넘으면 그 전에 근처 카페 휴식. 식사는 휴식으로 침
- 식당에 일찍 도착하게 되면 앞 장소에서 더 머물다 출발
- 하루 관광지 수는 시간 예산으로 정하고, 끝나는 시각을 넘기면 점수가 낮은 곳부터 빼고, 시간이 많이 남으면 근처 한 곳을 더함
- 비용 = 이동 시간 + 걷는 시간×0.2 + 식사 전 대기×0.3 + 늦은 식사×2 + 종료 초과×10
- TourAPI '매주 ○요일' 휴무 안내가 여행 요일과 겹치면 후보에서 뺌

## API 키 준비

| 키 | 어디서 | 메모 |
| --- | --- | --- |
| `TOUR_API_KEY` | 공공데이터포털 '한국관광공사_국문 관광정보 서비스_GW' 활용신청 | Decoding 키 권장 |
| `KORWITH_API_KEY` | '한국관광공사_무장애 여행 정보' 활용신청 | 같은 계정이면 비워 두기(위 키 사용) |
| `KAKAO_REST_API_KEY` | 카카오 디벨로퍼스 앱 → [카카오맵] 사용 설정 ON | 2026-07-21부터 카카오맵 API 이용 방식·무료 쿼터가 바뀜. 무료 쿼터는 계정에서 처음 활성화한 앱에만 |
| `VITE_KAKAO_JS_KEY` | 같은 앱의 JavaScript 키 | 'JavaScript SDK 도메인'과 'Web 사이트 도메인'에 접속 주소 등록 (지도·카카오톡 공유) |
| `ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY`+`OPENAI_MODEL` | 각 콘솔 | 없으면 템플릿 |

API 호출을 줄이려고 서버 메모리에 캐시합니다 (목록 6시간, 상세·무장애 24시간, 경로 1시간).
도보 경로는 A→B와 B→A를 같다고 보고 한 번만 부르고, 자동차 경로는 도보가 보행 한도를 넘는 구간에만 부릅니다.

## 카카오톡으로 보내기 (F5)

1. 휴대폰에서는 Web Share API로 **사진 파일**을 공유 시트에 넘깁니다 → 카카오톡을 고르면 부모님은 사진 한 장을 받습니다 (키 필요 없음).
2. 그게 안 되는 환경(대부분의 PC)에서 `VITE_KAKAO_JS_KEY` 가 있으면 `Kakao.Share.uploadImage` → `sendDefault`(피드)로 보냅니다.
3. 둘 다 안 되면 이미지를 저장하고 안내 문구를 띄웁니다.

기획안의 "서버가 이미지·PDF로 만듭니다"는 브라우저에서 만드는 방식으로 구현했습니다 (`html-to-image`, `jspdf`). 서버 비용이 들지 않고 결과는 같습니다.

## 앱으로 만들 때 (Capacitor)

```bash
cd client
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init "효도여행" kr.hyodo.trip --web-dir dist
# .env 에 VITE_API_BASE=https://배포한-서버-주소  를 넣고
npm run build && npx cap add android && npx cap sync
```

- 서버는 그대로 배포하고, 앱은 `VITE_API_BASE` 로 그 서버를 부릅니다. 서버 `.env` 의 `CORS_ORIGINS` 에 앱 Origin(`capacitor://localhost`, `https://localhost` 등)을 넣으세요.
- API 키는 전부 서버에만 있습니다. 카카오 JS 키만 화면에 들어가며, 앱에서 카카오 지도·공유를 쓰려면 카카오 디벨로퍼스에 앱 플랫폼 정보를 따로 등록해야 합니다.

## 폴더 구조

```
core/     일정 엔진 (TypeScript, 외부 의존성 없음 — 서버와 데모 화면이 같이 씀)
  src/planner.ts    6단계 오케스트레이션
  src/schedule.ts   시간표 펼치기 (휴식·식사·보행 한도)
  src/optimize.ts   순서 최적화
  src/access.ts     무장애 텍스트 → 배지
  src/prefs.ts      취향 매칭, 자유 입력 규칙
  src/sample/       예시 데이터 (서울 중구)
server/   Express API (/api/status, /api/geo, /api/plan) + 외부 API 어댑터
client/   React + Vite 모바일 웹 (화면 ① ~ ⑤)
```

## 확인된 것 / 아직 확인 못 한 것

- ✅ 일정 엔진: 보행 한도·종료 시각·점심 시각 준수, 빼기·바꾸기, 취향·자유 입력 반영 — `npm test`
- ✅ 화면 ① ~ ⑤ 전체 흐름, 이미지·PDF 저장 — 헤드리스 브라우저로 확인
- ⚠️ **실제 API 응답은 아직 확인하지 못했습니다.** 개발 환경에서 외부 API에 접속할 수 없어서, 각 API 문서의 응답 구조대로 만든 모의 응답으로
  파싱을 테스트했습니다 (`server/test/adapters.test.ts`). 키를 넣고 처음 실행할 때 서버 로그를 확인하고, 응답이 다르면 테스트의 모의 응답을 실제 값으로 바꿔 맞추세요.
  - 특히 `KorWithService2/locationBasedList2` 의 `numOfRows=200` 상한, 무장애 필드 텍스트의 실제 표현(긍정·부정 판별 규칙)은 실데이터로 다듬을 필요가 있습니다.
- ⚠️ 취향 매칭은 장소명·메뉴 키워드 + 관광타입 기준입니다. KorService2 는 구분류(cat1~3)가 비어 오는 경우가 많아, 신분류(lclsSystm) 코드 매핑은
  `lclsSystmCode2` 로 코드표를 확인한 뒤 `core/src/prefs.ts` 의 `lcls` 에 추가하면 됩니다.
- ⚠️ 예시 데이터의 무장애 정보·메뉴는 화면 시연용이며 실제 시설 정보가 아닙니다 (음식점·카페 이름에는 '(예시)'를 붙였습니다).
