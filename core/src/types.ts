// 효도여행 설계 도우미 — 공용 타입
// 서버(API 응답)·클라이언트(화면)·엔진이 모두 이 타입을 씁니다.

export interface LatLng {
  lat: number;
  lng: number;
}

/** attraction=관광지·문화시설·쇼핑, restaurant=음식점, cafe=휴식용 카페, lodging=숙소, origin=출발 장소 */
export type PlaceKind = 'attraction' | 'restaurant' | 'cafe' | 'lodging' | 'origin';

/** 데이터 출처. sample 은 API 키가 없을 때 쓰는 예시 데이터 */
export type PlaceSource = 'tourapi' | 'kakao' | 'sample' | 'user';

// ───────── F3 무장애 정보 ─────────
export type AccessKey = 'parking' | 'ramp' | 'elevator' | 'wheelchair' | 'restroom';
/** yes=있음, no=없다고 명시됨, unknown=정보 없음 */
export type AccessStatus = 'yes' | 'no' | 'unknown';

export interface AccessItem {
  status: AccessStatus;
  /** 무장애 여행 정보 API 원문 (화면에서 '자세히'로 보여 줌) */
  text?: string;
}

export interface AccessInfo {
  /** 무장애 여행 정보 DB에 이 장소가 등록돼 있는지 */
  known: boolean;
  items: Partial<Record<AccessKey, AccessItem>>;
  source: 'korwith' | 'sample' | 'none';
}

export interface Place {
  /** 'tour:126508' | 'kakao:12345' | 'sample:deoksugung' 형식 */
  id: string;
  source: PlaceSource;
  kind: PlaceKind;
  name: string;
  addr?: string;
  pos: LatLng;
  /** TourAPI 관광타입 (12 관광지, 14 문화시설, 38 쇼핑, 39 음식점 …) */
  contentTypeId?: string;
  /** TourAPI 신분류체계 코드 [lclsSystm1, lclsSystm2, lclsSystm3] (예: ['HS','HS01','HS010100']) */
  lcls?: string[];
  /** TourAPI 법정동 코드 (lDongRegnCd 시도 2자리, lDongSignguCd 시군구 3자리) */
  lDong?: { regn: string; signgu: string };
  image?: string;
  /** 작은 사진 (TourAPI firstimage2) */
  thumb?: string;
  /** 음식점 대표·취급 메뉴 (detailIntro2 firstmenu/treatmenu) */
  menu?: string;
  /** 휴무일 원문 (detailIntro2 restdate…) */
  restDate?: string;
  /** 예시 데이터용 보조 태그 (crowded 등) */
  tags?: string[];
  access?: AccessInfo;
  /** 지역 중심에서의 직선거리(m) — 후보 정렬용 */
  distFromCenter?: number;
  /** 추천 이유: 맞은 취향 항목·기타 키워드 (일정에 든 곳만) */
  matched?: string[];
  /** 의미 유사도(취향 문장 ↔ 소개글)를 후보 안에서 표준화한 값 — 임베딩 모델을 썼을 때만 */
  semanticZ?: number;
}

// ───────── 화면 ① 여행 만들기 ─────────
export interface TripInput {
  regionName: string;
  center: LatLng;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  startTime: string;
  endTime: string;
  /** 출발 장소. 여러 날 일정의 2일차부터는 숙소 (isLodging) */
  origin: { name: string; pos: LatLng; isLodging?: boolean };
  /** 일정 끝에 갈 곳. 없으면 출발 장소 (여러 날 일정에서는 숙소) */
  endPlace?: { name: string; pos: LatLng; isLodging?: boolean };
  /** 일정 끝에 endPlace(없으면 출발 장소)로 가기 */
  returnToOrigin: boolean;
  /** 후보 검색 반경(m). 기본 3000. 후보가 모자라면 서버가 넓힐 수 있음 */
  radiusM?: number;
}

// ───────── 화면 ② 부모님 컨디션 (F1·F3) ─────────
export interface ConditionInput {
  /** 한 번에 걸을 수 있는 시간(분) = 보행 한도 */
  walkLimitMin: number;
  /** 쉬는 간격(분) */
  restEveryMin: number;
  pace: 'slow' | 'normal';
  needs: {
    /** 엘리베이터·경사로 필요 */
    stepFree: boolean;
    parking: boolean;
  };
  /** 점심 시각 HH:MM, null 이면 점심 없음 */
  lunchTime: string | null;
  /** 저녁 시각 HH:MM, null 이면 저녁 없음 */
  dinnerTime: string | null;
}

// ───────── 화면 ③ 취향 설문 (F4) ─────────
export interface PrefInput {
  foods: string[];
  interests: string[];
  activities: string[];
  /** 목록에 없는 항목 — 그룹별 '기타' 직접 입력 (쉼표로 여러 개) */
  etc?: { foods?: string; interests?: string; activities?: string };
  /** "시끄러운 곳은 싫어하세요" 같은 자유 입력 */
  freeText?: string;
}

/** 자유 입력을 조건으로 바꾼 결과 (LLM 또는 규칙) */
export interface FreeTextRule {
  avoid: string[];
  /** 관광지 이름에 있으면 가산점 */
  prefer: string[];
  avoidFood: string[];
  /** 음식점 이름·메뉴에 있으면 가산점 */
  preferFood?: string[];
  source: 'llm' | 'rule';
  /** 화면에 보여 줄 해석 문장 */
  summary: string;
}

export interface PlanRequest {
  trip: TripInput;
  condition: ConditionInput;
  prefs?: PrefInput | null;
  /** 화면 ④에서 뺀 장소 */
  excludeIds?: string[];
  /** 화면 ④에서 바꿔 넣은 관광지 (반드시 포함) */
  includeIds?: string[];
  /** 화면 ④에서 바꿔 넣은 식당 (끼니별 고정) */
  pinnedMeals?: { lunch?: string; dinner?: string };
  /** true 면 관광지를 includeIds 그대로 쓰고 더하거나 빼지 않음 (화면 ④에서 손으로 고친 뒤) */
  lockAttractions?: boolean;
  /** 여행 기간: 0 당일치기, 1 = 1박 2일, 2 = 2박 3일 */
  nights?: number;
  /** 숙소. 없으면 지역 안에서 추천. recommended=true 는 추천받은 숙소를 그대로 유지할 때 */
  lodging?: { name: string; pos: LatLng; id?: string; recommended?: boolean } | null;
  /** 여러 날 일정에서 날짜별로 손으로 고친 내용 (days[0] = 1일차) */
  days?: DayAdjust[];
}

export interface DayAdjust {
  includeIds?: string[];
  pinnedMeals?: { lunch?: string; dinner?: string };
  lockAttractions?: boolean;
}

/** 당일·여러 날 일정 결과 (/api/plan 응답) */
export interface TripPlan {
  title: string;
  nights: number;
  days: PlanResult[];
  /** 여러 날 일정의 숙소 */
  lodging: Place | null;
  lodgingSource: 'recommended' | 'user' | 'none';
  /** 숙소 '바꾸기' 후보 */
  lodgingAlternatives: Place[];
  /** 모든 날짜에 쓴 반경 중 가장 큰 값 (고칠 때 그대로 씀) */
  radiusM: number;
  warnings: string[];
}

/** 장소 상세를 찾을 때 쓰는 최소 정보 */
export interface PlaceRef {
  id: string;
  name: string;
  pos: LatLng;
  contentTypeId?: string;
  kind?: PlaceKind;
  addr?: string;
}

/** 장소 상세 (/api/place 응답) */
export interface PlaceDetail {
  id: string;
  images: string[];
  overview?: string;
  tel?: string;
  homepage?: string;
  /** 이용시간·쉬는 날·메뉴·체크인 같은 항목 */
  info: { label: string; value: string }[];
  /** 카카오맵 장소 페이지(메뉴·가격·사진·리뷰) 또는 지도 링크 */
  kakaoUrl: string;
  kakaoUrlKind: 'place' | 'map';
  nearby: { name: string; distance: number; category?: string; url?: string }[];
  source: 'tourapi' | 'kakao' | 'sample';
}

// ───────── 이동 ─────────
export type TravelMode = 'walk' | 'taxi';

export interface RawRoute {
  meters: number;
  seconds: number;
  /** [lng, lat] 좌표열 — 지도 그리기용 */
  path?: [number, number][];
  taxiFare?: number;
  source: 'kakao' | 'estimate';
}

export interface Leg {
  mode: TravelMode;
  /** 실제 일정에 쓰는 이동 시간(분). 택시는 호출 대기 포함 */
  minutes: number;
  meters: number;
  /** 걸어갔다면 걸리는 시간(분, 걷는 속도 보정 후) */
  walkMinutes: number;
  /** 택시 주행 시간(분, 대기 제외) */
  driveMinutes?: number;
  taxiFare?: number;
  /** 도보가 보행 한도를 넘어 택시로 바꾼 구간 */
  overLimit: boolean;
  walkSource: 'kakao' | 'estimate';
  driveSource?: 'kakao' | 'estimate';
  path?: [number, number][];
}

export type StopType = 'start' | 'visit' | 'meal' | 'rest' | 'end';

export interface Stop {
  type: StopType;
  place: Place;
  /** HH:MM */
  arrive: string;
  depart: string;
  stayMin: number;
  legFromPrev?: Leg;
  /** 'lunch' | 'dinner' */
  mealLabel?: 'lunch' | 'dinner';
  /** 카페를 못 찾아 그 자리에서 쉬는 경우 */
  restInPlace?: boolean;
  note?: string;
}

export interface PlanSummary {
  totalTravelMin: number;
  totalWalkMin: number;
  totalTaxiMin: number;
  longestWalkMin: number;
  taxiLegs: number;
  restCount: number;
  visitCount: number;
  endsAt: string;
  /** 종료 시각을 넘긴 분 */
  overflowMin: number;
}

export interface DataSources {
  places: 'tourapi' | 'sample';
  access: 'korwith' | 'sample' | 'none';
  walk: 'kakao' | 'estimate' | 'mixed';
  taxi: 'kakao' | 'estimate' | 'mixed' | 'none';
  cafes: 'kakao' | 'sample' | 'none';
  explain: 'llm' | 'template';
  freeText?: 'llm' | 'rule';
  /** 관광지 취향 추천 방식: 의미 점수(임베딩·BM25) + 규칙, 또는 규칙만 */
  recommend?: 'semantic' | 'rule';
  /** 의미 점수에 쓴 방식 (예: 'multilingual-e5-small + BM25') */
  recommendModel?: string;
}

export interface PipelineStep {
  key: 'collect' | 'access' | 'travel' | 'optimize' | 'rest' | 'explain';
  label: string;
  ms: number;
  detail: string;
}

export interface PlanResult {
  title: string;
  date: string;
  trip: TripInput;
  /** 실제로 후보를 찾은 반경(m). 후보가 모자라 넓혔으면 requestedRadiusM 보다 큼 */
  radiusM: number;
  requestedRadiusM: number;
  condition: ConditionInput;
  stops: Stop[];
  summary: PlanSummary;
  explanation: string;
  warnings: string[];
  /** 화면 ④ '바꾸기' 후보 */
  alternatives: { attractions: Place[]; restaurants: Place[] };
  dataSources: DataSources;
  pipeline: PipelineStep[];
  freeTextRule?: FreeTextRule | null;
}

// ───────── 외부 API 어댑터 인터페이스 ─────────
export interface ExplainContext {
  facts: string;
  /** 설명에 나와도 되는 숫자 목록 (그 외 숫자가 나오면 LLM 결과를 버림) */
  allowedNumbers: number[];
}

export interface Providers {
  /** 1 후보 수집 (shopping = 시장·백화점 등 쇼핑 장소, attraction 으로 돌려줌) */
  searchPlaces(center: LatLng, radiusM: number, kind: 'attraction' | 'restaurant' | 'lodging' | 'shopping'): Promise<Place[]>;
  /** 2 접근성 정보 붙이기 (places 를 직접 수정) */
  attachAccessibility(places: Place[]): Promise<void>;
  /** 음식점 메뉴·휴무일 같은 상세 정보 (선택) */
  enrichDetails?(places: Place[]): Promise<void>;
  /** 3 도보 경로 (편안한 길 기준) */
  walk(a: LatLng, b: LatLng): Promise<RawRoute>;
  /** 3 자동차(택시) 경로 */
  drive(a: LatLng, b: LatLng): Promise<RawRoute>;
  /** 5 휴식용 카페 */
  nearbyCafes(p: LatLng, radiusM: number): Promise<Place[]>;
  /** 장소 상세 — 사진·소개·이용시간·메뉴·근처 관광지 (화면 ④ 장소 누르기) */
  placeDetail?(ref: PlaceRef): Promise<PlaceDetail>;
  /**
   * 의미 기반 추천 (선택) — 장소마다 질의 문장들 중 가장 잘 맞는 정도 (클수록 비슷).
   * 엔진이 후보 안에서 다시 표준화해 씀. 모델을 못 쓰면 null → 규칙 점수만 씀
   */
  semantic?: {
    model: string;
    /** method: 실제로 쓴 방식 이름 (예: 'multilingual-e5-small + BM25', 모델 준비 전이면 'BM25') */
    score(queries: string[], places: Place[]): Promise<{ scores: Map<string, number>; method: string } | null>;
  };
  /** 6 설명 (실패하면 null → 템플릿) */
  explain?(ctx: ExplainContext): Promise<string | null>;
  /** 자유 입력 → 조건 (실패하면 null → 규칙) */
  parseFreeText?(text: string): Promise<FreeTextRule | null>;
  /** 어떤 데이터가 실데이터인지 */
  sources: Pick<DataSources, 'places' | 'access' | 'cafes'> & { walk: 'kakao' | 'estimate'; taxi: 'kakao' | 'estimate' };
}

export interface GeoResult {
  name: string;
  addr?: string;
  pos: LatLng;
  source: 'kakao' | 'sample';
}
