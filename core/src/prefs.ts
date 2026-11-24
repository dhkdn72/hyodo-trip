// F4 취향 설문 → 후보 점수
// '장소명·메뉴 키워드 + 관광타입(contentTypeId) + TourAPI 신분류(lclsSystm)'로 매칭합니다.
// 신분류 코드는 lclsSystmCode2(lclsSystmListYn=Y) 실제 응답으로 확인한 값입니다 (2026-11).
//   HS0101 고궁 · HS0104 고택 · HS0106 민속마을 · VE0701 박물관 · VE0703 전시관 · VE0706 미술관/화랑
//   VE03 도시공원 · NA0407 수목원·정원 · VE0102 타워/전망대 · VE0401 골목길·문화거리 · NA0208 해안절경
//   FD01 한식 · FD0203 서양식 · FD04 주점 · FD05 카페/찻집 · VE11 교통시설

import type { FreeTextRule, Place, PrefInput } from './types.ts';

interface Rule {
  /** 장소명·메뉴에서 찾을 키워드 */
  re: RegExp;
  /** 일치하면 가산점이 붙는 관광타입 */
  contentTypes?: string[];
  /** 신분류 코드 접두어 (확장용) */
  lcls?: string[];
  weight: number;
}

export const PREF_OPTIONS = {
  foods: ['한식', '국밥', '면', '양식'],
  interests: ['궁궐', '미술관', '한옥', '공원'],
  activities: ['구경하며 쉬기', '사진'],
} as const;

export const INTEREST_RULES: Record<string, Rule> = {
  궁궐: { re: /(궁(\s|$|\(|·)|궁궐|고궁|행궁|궁$)/, lcls: ['HS0101'], weight: 1.0 },
  미술관: { re: /(미술관|갤러리|박물관|아트|전시)/, contentTypes: ['14'], lcls: ['VE0701', 'VE0703', 'VE0706'], weight: 1.0 },
  한옥: { re: /(한옥|민속|전통|고택)/, lcls: ['HS0104', 'HS0106'], weight: 1.0 },
  공원: { re: /(공원|정원|숲|산책|둘레길|광장|천$|청계천)/, lcls: ['VE03', 'NA0407'], weight: 1.0 },
};

export const ACTIVITY_RULES: Record<string, Rule> = {
  '구경하며 쉬기': { re: /(공원|정원|숲|궁|한옥|산책|광장|청계천|길$)/, lcls: ['VE03', 'NA0407', 'HS0101', 'HS0106'], weight: 0.3 },
  사진: { re: /(전망|타워|궁|한옥|벽화|정원|성곽|야경|돌담|서울로)/, lcls: ['VE0102', 'HS0101', 'NA0208', 'VE0401'], weight: 0.3 },
};

export const FOOD_RULES: Record<string, Rule> = {
  한식: {
    re: /(한식|한정식|국밥|곰탕|설렁탕|비빔밥|불고기|갈비|찌개|백반|해장국|순두부|보쌈|칼국수|냉면|삼계탕|추어탕|생선구이|정식)/,
    lcls: ['FD01'],
    weight: 0.6,
  },
  국밥: { re: /(국밥|곰탕|설렁탕|해장국|순대국|감자탕|삼계탕|추어탕|국수전골)/, weight: 0.8 },
  면: { re: /(면옥|국수|냉면|칼국수|우동|소바|짜장|짬뽕|라멘|막국수|쌀국수|파스타)/, weight: 0.8 },
  양식: { re: /(양식|파스타|스테이크|피자|브런치|레스토랑|이탈리|프렌치|비스트로|버거)/, lcls: ['FD0203'], weight: 0.8 },
};

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
    for (const kw of rule.prefer) {
      if (kw && t.includes(kw)) {
        bonus += 0.4;
        matched.push(kw);
      }
    }
  }

  if (!prefs) return { bonus, matched, excluded: false };

  if (p.kind === 'attraction') {
    for (const k of prefs.interests) {
      const r = INTEREST_RULES[k];
      if (r && ruleMatch(p, r)) {
        bonus += r.weight;
        matched.push(k);
      }
    }
    for (const k of prefs.activities) {
      const r = ACTIVITY_RULES[k];
      if (r && ruleMatch(p, r)) {
        bonus += r.weight;
        matched.push(k);
      }
    }
  } else if (p.kind === 'restaurant') {
    for (const k of prefs.foods) {
      const r = FOOD_RULES[k];
      if (r && ruleMatch(p, r)) {
        bonus += r.weight;
        matched.push(k);
      }
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
  const out: FreeTextRule = { avoid: [], prefer: [], avoidFood: [], source: 'rule', summary: '' };
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

export function categoryCheck(p: Place): { excluded: boolean; bonus: number } {
  if (p.kind === 'attraction') {
    if (hasPrefix(p, UNSUITABLE_ATTRACTION)) return { excluded: true, bonus: 0 };
    return { excluded: false, bonus: hasPrefix(p, SIGHTSEEING) ? 0.15 : 0 };
  }
  if (p.kind === 'restaurant' && hasPrefix(p, UNSUITABLE_MEAL)) return { excluded: true, bonus: 0 };
  return { excluded: false, bonus: 0 };
}
