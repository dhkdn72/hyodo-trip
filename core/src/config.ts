// 일정 계산에 쓰는 기본값. 팀에서 튜닝할 값은 전부 여기 모아 둡니다.
// 값을 바꾸면 테스트(npm test)로 결과가 어떻게 달라지는지 확인하세요.

export const PLAN_DEFAULTS = {
  /** 후보 검색 반경(m) */
  radiusM: 3000,

  /** 체류 시간(분) */
  visitMin: 60,
  mealMin: 60,
  restMin: 20,
  /** '구경하며 쉬기'를 고르면 휴식을 조금 더 길게 */
  restMinRelaxed: 30,

  /** 식사 시각 허용 범위(분): 이보다 일찍 도착하면 앞 장소에서 더 머물고, 늦으면 벌점 */
  mealEarlyTolerance: 10,
  mealLateTolerance: 30,

  /** 휴식 카페 찾는 반경(m) */
  cafeRadiusM: 350,

  /** 하루 최대·최소 관광지 수 */
  maxAttractions: 5,
  minAttractions: 1,
  /** 점심 후보로 고려할 음식점 수 (많을수록 정확하지만 API 호출이 늘어남) */
  restaurantOptions: 2,

  // ── 이동 시간 추정 (API 키가 없거나 호출이 실패했을 때만 사용) ──
  /** 보통 걸음 속도 m/분 (약 4km/h) */
  walkMetersPerMin: 67,
  /** 직선거리 → 실제 보행 거리 보정 */
  walkDetour: 1.3,
  /** 택시 평균 속도 m/분 (도심 약 18km/h) */
  taxiMetersPerMin: 300,
  /** 직선거리 → 실제 도로 거리 보정 */
  roadDetour: 1.4,

  /** '천천히'를 고르면 도보 시간에 곱하는 보정계수 (기획안: 1.3배) */
  slowPaceFactor: 1.3,
  /** 택시 호출·승하차에 드는 시간(분). 이동 시간에 더해 일정을 짭니다 */
  taxiPickupMin: 3,
};

export type PlanDefaults = typeof PLAN_DEFAULTS;
