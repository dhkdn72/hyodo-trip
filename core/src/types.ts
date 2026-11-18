// 효도여행 설계 도우미 — 공용 타입
// 서버(API 응답)·클라이언트(화면)·엔진이 모두 이 타입을 씁니다.

export interface LatLng {
  lat: number;
  lng: number;
}

/** attraction=관광지·문화시설, restaurant=음식점, cafe=휴식용 카페, origin=출발 장소 */
export type PlaceKind = 'attraction' | 'restaurant' | 'cafe' | 'origin';

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
  /** TourAPI 신분류체계 코드 (lclsSystm1~3). 매핑 확장용으로 보관 */
  lcls?: string[];
  image?: string;
  /** 음식점 대표·취급 메뉴 (detailIntro2 firstmenu/treatmenu) */
  menu?: string;
  /** 휴무일 원문 (detailIntro2 restdate…) */
  restDate?: string;
  /** 예시 데이터용 보조 태그 (crowded 등) */
  tags?: string[];
  access?: AccessInfo;
  /** 지역 중심에서의 직선거리(m) — 후보 정렬용 */
  distFromCenter?: number;
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
  origin: { name: string; pos: LatLng };
  /** 일정 끝에 출발 장소(숙소)로 돌아오기 */
  returnToOrigin: boolean;
  /** 후보 검색 반경(m). 기본 3000 */
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
  /** "시끄러운 곳은 싫어하세요" 같은 자유 입력 */
  freeText?: string;
}

/** 자유 입력을 조건으로 바꾼 결과 (LLM 또는 규칙) */
export interface FreeTextRule {
  avoid: string[];
  prefer: string[];
  avoidFood: string[];
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
  /** 1 후보 수집 */
  searchPlaces(center: LatLng, radiusM: number, kind: 'attraction' | 'restaurant'): Promise<Place[]>;
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
