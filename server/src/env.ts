// 환경 변수 (루트의 .env). 키가 없는 API 는 예시 데이터·추정치로 자동 대체됩니다.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 루트 .env 를 읽어 process.env 에 채움 (이미 있는 값은 덮어쓰지 않음, 의존성 없이) */
function loadDotEnv() {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../../.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadDotEnv();

const v = (k: string) => {
  const x = process.env[k]?.trim();
  return x ? x : undefined;
};

export const env = {
  port: Number(v('PORT') ?? 8787),
  /** 공공데이터포털 일반 인증키 — Decoding 키 권장(Encoding 키도 동작) */
  tourApiKey: v('TOUR_API_KEY'),
  /** 무장애 여행 정보(KorWithService2) 키. 같은 포털 계정이면 TOUR_API_KEY 와 같음 */
  korWithApiKey: v('KORWITH_API_KEY') ?? v('TOUR_API_KEY'),
  /** 카카오 REST API 키 (로컬·도보 경로·카카오모빌리티 길찾기) */
  kakaoRestKey: v('KAKAO_REST_API_KEY'),
  /** 'ACCESSIBLE'(편안한 길, 기본) | 'BROAD_FIRST' | 'SHORTEST' */
  kakaoWalkMode: v('KAKAO_WALK_ROUTE_MODE') ?? 'ACCESSIBLE',
  anthropicKey: v('ANTHROPIC_API_KEY'),
  anthropicModel: v('ANTHROPIC_MODEL') ?? 'claude-haiku-5-5',
  openaiKey: v('OPENAI_API_KEY'),
  openaiModel: v('OPENAI_MODEL'),
  openaiBaseUrl: (v('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
  /**
   * 추론(생각) 정도 — Gemini 같은 추론 모델은 기본값이 높아 느리고 토큰을 많이 써서 낮춤.
   * 비우면 Gemini 주소일 때 'low', 그 밖에는 보내지 않음 (추론 모델이 아닌 OpenAI 모델은 이 값을 받지 않음)
   */
  openaiReasoning: v('OPENAI_REASONING_EFFORT'),
  /** LLM 한 번 호출 제한 시간(ms). 넘으면 다음 모델(또는 한 번 더)로 */
  llmTimeoutMs: Number(v('LLM_TIMEOUT_MS') ?? 8000),
  /** 앱(Capacitor 등)에서 호출할 때 허용할 Origin, 쉼표 구분. 비우면 모두 허용 */
  corsOrigins: (v('CORS_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  /** TourAPI MobileApp 파라미터 */
  appName: v('TOUR_API_APP_NAME') ?? 'HyodoTrip',
  /** 의미 기반 추천 문장 임베딩 모델 (Hugging Face, transformers.js 용 ONNX). 'off' 면 끔 */
  embeddingModel: v('EMBEDDING_MODEL') ?? 'Xenova/multilingual-e5-small',
  /** 개발 도구(/api/dev/*) — npm run dev 로 켰을 때만 */
  devTools: process.argv.includes('--dev'),
};

export function llmKind(): 'anthropic' | 'openai' | null {
  if (env.anthropicKey) return 'anthropic';
  if (env.openaiKey && env.openaiModel) return 'openai';
  return null;
}
