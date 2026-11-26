// F4 취향 설문 → 후보 점수
// '장소명·메뉴 키워드 + 관광타입(contentTypeId) + TourAPI 신분류(lclsSystm)'로 매칭합니다.
// 신분류 코드는 lclsSystmCode2(lclsSystmListYn=Y) 실제 응답으로 확인한 값입니다 (2026-11).
//   HS0101 고궁 · HS0104 고택 · HS0106 민속마을 · HS0301 불교 성지 · VE0701 박물관 · VE0703 전시관 · VE0706 미술관/화랑
//   VE03 도시공원 · NA0407 수목원·정원 · VE0102 타워/전망대 · VE0401 골목길·문화거리 · VE0403 둘레길
//   NA0201 강 · NA0202 호수 · NA0205 섬 · NA0207 항구/포구 · NA0208 해안절경 · NA0209 해변·해수욕장
//   EX01 전통문화체험 · EX02 공예체험 · EX0401 템플스테이 · EX0402 사찰문화체험 · EX0501 온천/사우나/스파
//   VE0601 공연장 · VE0602 영화관 · SH0601 비상설시장 · SH0602 상설시장 · SH0101 백화점 · SH0201 복합쇼핑몰
//   SH0202 아웃렛 · SH0501 공방/공예품점 · SH0503 관광기념품/특산물 · SH04 면세점
//   FD01 한식 · FD0201 중식 · FD0202 일식 · FD0203 서양식 · FD04 주점 · FD05 카페/찻집 · VE11 교통시설
//  관광타입: EX(체험)·HS0301(사찰)·VE0601(공연장 대부분 14)은 12·14, 시장(SH06)은 38(쇼핑)로 등록돼 있음

import type { FreeTextRule, Place, PrefInput } from './types.ts';

interface Rule {
  /** 장소명·메뉴에서 찾을 키워드 */
  re: RegExp;
  /** 일치하면 가산점이 붙는 관광타입 */
  contentTypes?: string[];
  /** 신분류 코드 접두어 */
  lcls?: string[];
  weight: number;
}

export const PREF_OPTIONS = {
  foods: ['한식', '국밥', '면', '해산물', '중식', '일식', '양식'],
  interests: ['궁궐', '미술관', '한옥', '공원', '시장', '바다', '사찰', '전통체험', '온천'],
  activities: ['구경하며 쉬기', '사진', '산책', '맛집 탐방', '쇼핑', '공연 관람'],
} as const;

export const INTEREST_RULES: Record<string, Rule> = {
  궁궐: { re: /(궁(\s|$|\(|·)|궁궐|고궁|행궁|궁$)/, lcls: ['HS0101'], weight: 1.0 },
  미술관: { re: /(미술관|갤러리|박물관|아트|전시)/, contentTypes: ['14'], lcls: ['VE0701', 'VE0703', 'VE0706'], weight: 1.0 },
  한옥: { re: /(한옥|민속|전통|고택)/, lcls: ['HS0104', 'HS0106'], weight: 1.0 },
  공원: { re: /(공원|정원|숲|산책|둘레길|광장|천$|청계천)/, lcls: ['VE03', 'NA0407'], weight: 1.0 },
  시장: { re: /(시장|장터|오일장|5일장)/, lcls: ['SH0601', 'SH0602'], weight: 1.0 },
  바다: { re: /(바다|해변|해수욕장|해안|포구|등대|갯벌|해상|[^공]항$)/, lcls: ['NA0205', 'NA0207', 'NA0208', 'NA0209'], weight: 1.0 },
  사찰: { re: /(사찰|템플|(^|\s)[가-힣]{1,4}사($|\s|\())/, lcls: ['HS0301', 'EX0401', 'EX0402'], weight: 1.0 },
  전통체험: { re: /(전통.?체험|문화체험|공예|공방|도예|한지|다도|국악|민속촌)/, lcls: ['EX01', 'EX02'], weight: 1.0 },
  온천: { re: /(온천|스파|족욕|노천탕|해수탕|사우나)/, lcls: ['EX0501'], weight: 1.0 },
};

export const ACTIVITY_RULES: Record<string, Rule> = {
  '구경하며 쉬기': { re: /(공원|정원|숲|궁|한옥|산책|광장|청계천|길$)/, lcls: ['VE03', 'NA0407', 'HS0101', 'HS0106'], weight: 0.3 },
  사진: { re: /(전망|타워|궁|한옥|벽화|정원|성곽|야경|돌담|서울로)/, lcls: ['VE0102', 'HS0101', 'NA0208', 'VE0401'], weight: 0.3 },
  산책: {
    re: /(공원|정원|숲|산책|둘레길|수목원|호수|강변|천$|길$|돌담)/,
    lcls: ['VE03', 'NA0407', 'VE0401', 'VE0403', 'NA0201', 'NA0202'],
    weight: 0.5,
  },
  쇼핑: {
    re: /(시장|백화점|아울렛|아웃렛|쇼핑|기념품|특산물|공예품)/,
    lcls: ['SH0101', 'SH0201', 'SH0202', 'SH0501', 'SH0503', 'SH0601', 'SH0602'],
    weight: 0.6,
  },
  '공연 관람': { re: /(공연장|극장|아트홀|아트센터|예술의전당|문화회관|국악원)/, lcls: ['VE0601'], weight: 0.8 },
};

export const FOOD_RULES: Record<string, Rule> = {
  한식: {
    re: /(한식|한정식|국밥|곰탕|설렁탕|비빔밥|불고기|갈비|찌개|백반|해장국|순두부|보쌈|칼국수|냉면|삼계탕|추어탕|생선구이|정식)/,
    lcls: ['FD01'],
    weight: 0.6,
  },
  국밥: { re: /(국밥|곰탕|설렁탕|해장국|순대국|감자탕|삼계탕|추어탕|국수전골)/, weight: 0.8 },
  면: { re: /(면옥|국수|냉면|칼국수|우동|소바|짜장|짬뽕|라멘|막국수|쌀국수|파스타)/, weight: 0.8 },
  해산물: {
    re: /(해물|해산물|횟집|회센터|생선|조개|게장|대게|꽃게|전복|아구|아귀|장어|낙지|주꾸미|쭈꾸미|문어|매운탕|물회|복어|복국|굴)/,
    weight: 0.8,
  },
  중식: { re: /(중식|중화|중국집|중국요리|짜장|자장|짬뽕|탕수육|딤섬|반점|양꼬치)/, lcls: ['FD0201'], weight: 0.8 },
  일식: { re: /(일식|스시|초밥|돈카츠|돈까스|우동|소바|라멘|오마카세|규동|텐동|사시미)/, lcls: ['FD0202'], weight: 0.8 },
  양식: { re: /(양식|파스타|스테이크|피자|브런치|레스토랑|이탈리|프렌치|비스트로|버거)/, lcls: ['FD0203'], weight: 0.8 },
};

/** '기타'에 적은 말을 목록의 항목으로 바꿔 읽는 사전 (목록에 없으면 장소 이름·메뉴 키워드로 씀) */
const ALIASES: Record<'foods' | 'interests' | 'activities', Record<string, string>> = {
  foods: {
    회: '해산물', 해물: '해산물', 생선: '해산물', 횟집: '해산물', 짜장면: '중식', 짬뽕: '중식', 중국음식: '중식',
    초밥: '일식', 스시: '일식', 돈까스: '일식', 국수: '면', 냉면: '면', 칼국수: '면', 파스타: '양식', 스테이크: '양식',
    한정식: '한식', 백반: '한식', 곰탕: '국밥', 설렁탕: '국밥',
  },
  interests: {
    고궁: '궁궐', 궁: '궁궐', 박물관: '미술관', 전시: '미술관', 갤러리: '미술관', 한옥마을: '한옥', 민속마을: '한옥',
    정원: '공원', 수목원: '공원', 전통시장: '시장', 재래시장: '시장', 오일장: '시장', 바닷가: '바다', 해변: '바다',
    해수욕장: '바다', 절: '사찰', 템플스테이: '사찰', 공예: '전통체험', 공방: '전통체험', 스파: '온천', 족욕: '온천',
  },
  activities: {
    휴식: '구경하며 쉬기', 사진찍기: '사진', 걷기: '산책', 맛집: '맛집 탐방', 먹방: '맛집 탐방', 기념품: '쇼핑',
    공연: '공연 관람', 연극: '공연 관람', 국악: '공연 관람', 뮤지컬: '공연 관람',
  },
};

/** '기타' 입력 → 키워드 목록 (쉼표·띄어쓰기로 나눔, 2~10자, 그룹당 5개까지) */
export function splitEtc(s: string | undefined): string[] {
  if (!s) return [];
  const out: string[] = [];
  for (const w of s.split(/[,，、/·\s]+/)) {
    const k = w.replace(/[^가-힣A-Za-z0-9]/g, '');
    if (k.length >= 1 && k.length <= 10 && !out.includes(k)) out.push(k);
  }
  return out.filter((k) => k.length >= 2 || ['회', '절', '궁'].includes(k)).slice(0, 5);
}

/**
 * 고른 항목 + '기타' 입력을 하나로 합침.
 * 기타에 적은 말이 목록 항목(또는 별칭)이면 그 항목으로, 아니면 키워드 그대로 넣음.
 * custom = 목록에 없어 이름·메뉴 키워드로만 찾는 말
 */
export function normalizePrefs(p: PrefInput | null | undefined): (PrefInput & { custom: string[] }) | null {
  if (!p) return null;
  const merge = (group: 'foods' | 'interests' | 'activities') => {
    const opts = PREF_OPTIONS[group] as readonly string[];
    const list = [...(p[group] ?? [])];
    const custom: string[] = [];
    for (const k of splitEtc(p.etc?.[group])) {
      const mapped = opts.includes(k) ? k : ALIASES[group][k];
      const v = mapped ?? k;
      if (!list.includes(v)) list.push(v);
      if (!mapped) custom.push(k);
    }
    return { list, custom };
  };
  const f = merge('foods');
  const i = merge('interests');
  const a = merge('activities');
  return {
    ...p,
    foods: f.list,
    interests: i.list,
    activities: a.list,
    custom: [...f.custom, ...i.custom, ...a.custom],
  };
}

/** 시장·쇼핑을 고르면 쇼핑(38) 장소도 후보로 받음 */
export function wantsShopping(p: PrefInput | null | undefined) {
  return !!p && (p.interests.includes('시장') || p.activities.includes('쇼핑'));
}

/** 공연 관람을 고르면 공연장(VE0601)을 후보에 넣음 (영화관은 계속 뺌) */
export function wantsPerformance(p: PrefInput | null | undefined) {
  return !!p?.activities.includes('공연 관람');
}

/** 맛집 탐방: 사진·대표 메뉴가 등록된 식당을 우선하고, 조금 멀어도 고름 */
export function wantsFoodie(p: PrefInput | null | undefined) {
  return !!p?.activities.includes('맛집 탐방');
}

function text(p: Place) {
  return `${p.name} ${p.menu ?? ''}`;
}

function ruleMatch(p: Place, r: Rule): boolean {
  if (r.re.test(text(p))) return true;
  if (r.contentTypes && p.contentTypeId && r.contentTypes.includes(p.contentTypeId)) return true;
  if (r.lcls && p.lcls?.some((c) => r.lcls!.some((pre) => c?.startsWith(pre)))) return true;
  return false;
}

export interface PrefScore {
  bonus: number;
  matched: string[];
  excluded: boolean;
}

/** 취향 점수. 자유 입력의 '피하기'에 걸리면 제외 */
export function prefScore(p: Place, prefs: PrefInput | null | undefined, rule: FreeTextRule | null | undefined): PrefScore {
  let bonus = 0;
  const matched: string[] = [];

  if (rule) {
    const t = text(p);
    const avoidList = p.kind === 'restaurant' ? [...rule.avoid, ...rule.avoidFood] : rule.avoid;
    for (const kw of avoidList) {
      if (kw && t.includes(kw)) return { bonus: 0, matched: [], excluded: true };
    }
    if (rule.avoid.includes('#crowded') && (p.tags?.includes('crowded') || p.contentTypeId === '38')) {
      return { bonus: 0, matched: [], excluded: true };
    }
    const preferList = p.kind === 'restaurant' ? rule.preferFood ?? [] : rule.prefer;
    for (const kw of preferList) {
      if (kw && t.includes(kw)) {
        bonus += 0.4;
        matched.push(kw);
      }
    }
  }

  if (!prefs) return { bonus, matched, excluded: false };

  // 목록에 있는 항목은 규칙으로, '기타'로 적은 말은 장소 이름·메뉴에 들어 있는지로 찾음
  const apply = (keys: string[], rules: Record<string, Rule>, customWeight: number) => {
    for (const k of keys) {
      const r = rules[k];
      const hit = r ? ruleMatch(p, r) : k.length >= 1 && text(p).includes(k);
      if (hit) {
        bonus += r ? r.weight : customWeight;
        matched.push(k);
      }
    }
  };
  if (p.kind === 'attraction') {
    apply(prefs.interests, INTEREST_RULES, 1.0);
    apply(
      prefs.activities.filter((k) => k !== '맛집 탐방'),
      ACTIVITY_RULES,
      0.6,
    );
  } else if (p.kind === 'restaurant') {
    apply(prefs.foods, FOOD_RULES, 0.8);
    // 맛집 탐방: 관광공사에 사진과 대표 메뉴가 함께 등록된 식당
    if (wantsFoodie(prefs) && p.image && p.menu) {
      bonus += 0.3;
      matched.push('맛집 탐방');
    }
  }
  return { bonus, matched, excluded: false };
}

// ───────── 자유 입력 → 조건 (LLM 이 없을 때 쓰는 규칙) ─────────

interface TextRule {
  when: RegExp;
  avoid?: string[];
  prefer?: string[];
  avoidFood?: string[];
  say: string;
}

const TEXT_RULES: TextRule[] = [
  {
    when: /(시끄|북적|붐비|사람\s*많|복잡|혼잡)/,
    avoid: ['#crowded', '시장', '쇼핑', '면세', '백화점', '명동거리'],
    say: '붐비는 시장·쇼핑가는 뺐어요',
  },
  {
    when: /(조용|한적|여유|느긋)/,
    prefer: ['공원', '정원', '미술관', '한옥', '도서관', '숲'],
    say: '조용한 공원·미술관·한옥을 우선했어요',
  },
  {
    when: /(계단|오르막|언덕|등산|산길)/,
    avoid: ['타워', '전망대', '성곽', '둘레길', '언덕', '등산', '산성', '케이블카'],
    say: '오르막이 있는 타워·성곽·둘레길은 뺐어요',
  },
  {
    when: /(매운|맵)/,
    avoidFood: ['매운', '불닭', '짬뽕', '떡볶이', '마라', '낙지', '닭갈비'],
    say: '매운 음식점은 뺐어요',
  },
  {
    when: /(고기\s*(를\s*)?(안|못|싫)|채식)/,
    avoidFood: ['갈비', '불고기', '고기', '삼겹', '스테이크', '보쌈'],
    say: '고기 위주 음식점은 뺐어요',
  },
  {
    when: /(날\s*것|회\s*(를\s*)?(안|못|싫)|생선회)/,
    avoidFood: ['횟집', '회센터', '스시', '초밥'],
    say: '회·초밥집은 뺐어요',
  },
];

export function ruleFreeText(input: string): FreeTextRule | null {
  const t = input.trim();
  if (!t) return null;
  const out: FreeTextRule = { avoid: [], prefer: [], avoidFood: [], preferFood: [], source: 'rule', summary: '' };
  const says: string[] = [];
  for (const r of TEXT_RULES) {
    if (r.when.test(t)) {
      out.avoid.push(...(r.avoid ?? []));
      out.prefer.push(...(r.prefer ?? []));
      out.avoidFood.push(...(r.avoidFood ?? []));
      says.push(r.say);
    }
  }
  if (!says.length) return { ...out, summary: '자유 입력에서 조건을 찾지 못했어요' };
  out.summary = says.join(' · ');
  return out;
}

/** '구경하며 쉬기'를 고르면 하루 밀도를 낮춤 (관광지 1곳 줄이고 휴식을 길게) */
export function wantsRelaxed(prefs: PrefInput | null | undefined) {
  return !!prefs?.activities.includes('구경하며 쉬기');
}

// ───────── 신분류로 거르기 ─────────

/**
 * 부모님 나들이 장소로 맞지 않는 분류 (교통시설·연회장·어학당·학교·카지노·숙박)
 * 공연장·영화관(VE06)은 공연 시간이 있어야 의미가 있어 '60분 둘러보기' 일정에서 뺌
 */
const UNSUITABLE_ATTRACTION = ['VE11', 'VE0806', 'VE0905', 'VE0906', 'VE1202', 'VE06', 'AC'];
/** 점심·저녁 식당으로 맞지 않는 분류 (주점·카페/찻집·제과) */
const UNSUITABLE_MEAL = ['FD04', 'FD05', 'FD0301'];
/** 역사·자연·문화 관광지는 기본 가산점 */
const SIGHTSEEING = ['HS', 'NA', 'VE'];

const hasPrefix = (p: Place, list: string[]) => !!p.lcls?.some((c) => list.some((pre) => c?.startsWith(pre)));

/** 쇼핑(38) 중 나들이로 갈 만한 곳: 시장·백화점·복합쇼핑몰·아웃렛·공방·기념품/특산물점 (면세점·전문상가·대형마트는 뺌) */
const SHOP_OK = ['SH0101', 'SH0201', 'SH0202', 'SH0501', 'SH0503', 'SH0601', 'SH0602'];
const SHOP_NAME = /(시장|백화점|아울렛|아웃렛|쇼핑몰)/;

export const isShoppingSpot = (p: Place) => (p.lcls?.length ? hasPrefix(p, SHOP_OK) : SHOP_NAME.test(p.name));

export function categoryCheck(p: Place, prefs?: PrefInput | null): { excluded: boolean; bonus: number } {
  if (p.kind === 'attraction') {
    if (p.contentTypeId === '38') return isShoppingSpot(p) ? { excluded: false, bonus: 0 } : { excluded: true, bonus: 0 };
    if (wantsPerformance(prefs) && hasPrefix(p, ['VE0601'])) return { excluded: false, bonus: 0 };
    if (hasPrefix(p, UNSUITABLE_ATTRACTION)) return { excluded: true, bonus: 0 };
    return { excluded: false, bonus: hasPrefix(p, SIGHTSEEING) ? 0.15 : 0 };
  }
  if (p.kind === 'restaurant' && hasPrefix(p, UNSUITABLE_MEAL)) return { excluded: true, bonus: 0 };
  return { excluded: false, bonus: 0 };
}

export const isPerformanceHall = (p: Place) => hasPrefix(p, ['VE0601']);

/**
 * 5일장처럼 이름에 장날이 적힌 시장 — 예: '발안만세시장 (5, 10일)' → 날짜 끝자리가 5·0인 날만 열림.
 * 장날이 아니면 true
 */
export function marketClosedOn(name: string, date: string): boolean {
  const m = name.match(/\((\d{1,2})\s*[,·]\s*(\d{1,2})\s*일\)/);
  if (!m) return false;
  const day = Number(date.slice(8, 10));
  if (!day) return false;
  const ends = [Number(m[1]) % 10, Number(m[2]) % 10];
  return !ends.includes(day % 10);
}
