// 6 설명 붙이기 — '왜 이 순서인지' 한두 문장.
// 이동 시간과 순서는 코드가 계산하고, LLM 은 문장만 다듬습니다.
// LLM 문장에 우리가 준 숫자 말고 다른 숫자가 나오면(시간을 지어내면) 버리고 템플릿을 씁니다.

import type { ConditionInput, ExplainContext, Stop } from './types.ts';

export function buildExplainContext(stops: Stop[], cond: ConditionInput, originName: string): ExplainContext & {
  template: string;
} {
  const places = stops.filter((s) => s.type === 'visit' || s.type === 'meal');
  const taxiLegs = stops.filter((s) => s.legFromPrev?.mode === 'taxi');
  const walkLegs = stops.filter((s) => s.legFromPrev?.mode === 'walk' && s.type !== 'rest');
  const maxWalk = walkLegs.reduce((m, s) => Math.max(m, s.legFromPrev!.minutes), 0);
  const rests = stops.filter((s) => s.type === 'rest').length;
  const meal = stops.find((s) => s.type === 'meal');

  const names = places.map((s) => s.place.name);
  const routeText = names.length ? names.join(' → ') : '';

  const parts: string[] = [];
  if (names.length >= 2) {
    parts.push(`${originName}에서 출발해 ${routeText} 순으로, 서로 가까운 곳끼리 이어 이동을 줄였어요.`);
  } else if (names.length === 1) {
    parts.push(`${originName}에서 가까운 ${names[0]} 한 곳을 여유 있게 둘러보도록 짰어요.`);
  }
  // 어간만 만들어 두고 '-고,' / '-어요.'로 이어 붙임
  const a = taxiLegs.length
    ? `한 번에 ${cond.walkLimitMin}분 넘게 걸어야 하는 ${taxiLegs.length}구간은 택시로 바꿨`
    : maxWalk > 0
      ? `걷는 길은 모두 한 번에 ${maxWalk}분 이내로 맞췄`
      : null;
  const b = rests ? `${cond.restEveryMin}분마다 쉬는 시간을 넣었` : meal ? `식사 시간을 쉬는 시간으로 삼았` : null;
  if (a && b) parts.push(`${a}고, ${b}어요.`);
  else if (a || b) parts.push(`${a ?? b}어요.`);

  const template = parts.join(' ');

  const facts = [
    `출발: ${originName}`,
    `방문 순서: ${routeText || '없음'}`,
    meal ? `식사: ${meal.arrive} ${meal.place.name}` : '',
    `보행 한도: ${cond.walkLimitMin}분, 쉬는 간격: ${cond.restEveryMin}분, 걷는 속도: ${cond.pace === 'slow' ? '천천히' : '보통'}`,
    `택시로 바꾼 구간: ${taxiLegs.map((s) => `${s.place.name}까지 도보 ${s.legFromPrev!.walkMinutes}분 → 택시 ${s.legFromPrev!.minutes}분`).join(', ') || '없음'}`,
    `가장 긴 도보: ${maxWalk}분`,
    `휴식 횟수: ${rests}`,
  ]
    .filter(Boolean)
    .join('\n');

  const allowed = new Set<number>();
  const collect = (s: string) => (s.match(/\d+/g) ?? []).forEach((n) => allowed.add(Number(n)));
  collect(facts);
  stops.forEach((s) => {
    collect(s.arrive);
    collect(s.depart);
  });
  [1, 2].forEach((n) => allowed.add(n)); // "한두 문장", "두 곳" 같은 일반 표현 허용

  return { facts, allowedNumbers: [...allowed], template };
}

/** LLM 문장이 허용된 숫자만 쓰는지 검사 */
export function explanationIsGrounded(text: string, allowedNumbers: number[]): boolean {
  const allowed = new Set(allowedNumbers);
  const nums = text.match(/\d+/g) ?? [];
  return nums.every((n) => allowed.has(Number(n)));
}

export const EXPLAIN_SYSTEM_PROMPT = `너는 부모님과 여행하는 자녀에게 하루 일정의 '순서를 이렇게 정한 이유'를 설명하는 도우미야.
규칙:
- 한국어 존댓말(해요체)로 한두 문장, 100자 안팎.
- 아래 [사실]에 있는 내용만 말해. 시간·거리·숫자는 [사실]에 있는 값만 그대로 쓰고, 새 숫자를 만들지 마.
- 장소를 새로 추천하거나 순서를 바꾸지 마.
- 문장만 출력해. 따옴표·머리말 없이.`;

export const FREETEXT_SYSTEM_PROMPT = `부모님 여행 취향에 대한 자유 입력을 장소 필터 조건으로 바꿔.
JSON 하나만 출력해: {"avoid": string[], "prefer": string[], "avoidFood": string[], "preferFood": string[], "summary": string}
- avoid: 피해야 할 관광지 이름 키워드 (예: "시장", "타워"). 붐비는 곳을 싫어하면 "#crowded" 도 넣어.
- prefer: 선호하는 관광지 이름 키워드 (예: "공원", "미술관", "한옥").
- avoidFood: 피해야 할 음식점 이름·메뉴 키워드 (예: "매운", "회").
- preferFood: 선호하는 음식점 이름·메뉴 키워드 (예: "국밥", "생선").
- summary: 해석한 조건을 해요체 한 문장으로.
키워드는 장소 이름·메뉴에 실제로 들어갈 한국어 명사 2~4글자로, 각 배열 최대 8개. 한 글자 키워드('산', '회')는 쓰지 마.`;
