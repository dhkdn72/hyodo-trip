// LLM API — 6 설명 붙이기, 자유 입력 → 조건
// ANTHROPIC_API_KEY 가 있으면 Anthropic Messages API, 없고 OPENAI_API_KEY+OPENAI_MODEL 이 있으면
// OpenAI 호환 Chat Completions API 를 씁니다. 실패하면 null → 엔진이 템플릿·규칙으로 대체합니다.

import { EXPLAIN_SYSTEM_PROMPT, FREETEXT_SYSTEM_PROMPT, type ExplainContext, type FreeTextRule } from '@hyodo/core';
import { env, llmKind } from '../env.ts';
import { fetchJson, log } from '../http.ts';

/** 용도별 마지막 LLM 실패 이유 (/api/status 로 확인, 키는 담지 않음). 성공하면 지움 */
const lastErrors: Record<string, string> = {};
export const llmLastError = () => (Object.keys(lastErrors).length ? { ...lastErrors } : null);
let lastError: string | null = null;

const isGemini = () => /generativelanguage\.googleapis\.com/.test(env.openaiBaseUrl);

/** 일시적인 혼잡(503)·한도(429)면 잠깐 쉬고 한 번 더 */
async function complete(label: string, system: string, user: string, maxTokens = 300): Promise<string | null> {
  const t0 = Date.now();
  // OPENAI_MODEL 에 쉼표로 여러 모델을 적으면, 앞 모델이 혼잡(503)·한도(429)·시간 초과일 때 다음 모델로
  const models = llmKind() === 'openai' ? (env.openaiModel ?? '').split(',').map((m) => m.trim()).filter(Boolean) : [''];
  const tries = models.length > 1 ? models : [models[0], models[0]];
  const errs: string[] = [];
  for (const model of tries) {
    lastError = null;
    const r = await completeOnce(system, user, maxTokens, model);
    if (r !== 'retry') {
      if (r) delete lastErrors[label];
      else if (lastError) lastErrors[label] = `${[...errs, lastError].join(' → ')} (${Date.now() - t0}ms)`;
      return r;
    }
    errs.push(`${model || kindLabel()}: ${lastError}`);
    if (models.length <= 1) await new Promise((res) => setTimeout(res, 800));
  }
  lastErrors[label] = `${errs.join(' → ')} (${Date.now() - t0}ms)`;
  return null;
}

const kindLabel = () => llmKind() ?? 'llm';

async function completeOnce(system: string, user: string, maxTokens: number, model: string): Promise<string | null | 'retry'> {
  const kind = llmKind();
  if (!kind) return null;
  try {
    if (kind === 'anthropic') {
      const j = await fetchJson('https://api.anthropic.com/v1/messages', {
        api: 'anthropic',
        method: 'POST',
        timeoutMs: 12000,
        headers: {
          'x-api-key': env.anthropicKey!,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: env.anthropicModel,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });
      return (j?.content ?? []).map((c: any) => (c.type === 'text' ? c.text : '')).join('').trim() || null;
    }
    // Gemini(OpenAI 호환)는 생각(추론) 토큰도 출력 한도에 들어가 한도를 넉넉히, 추론 정도는 낮게
    const gemini = isGemini();
    const reasoning = env.openaiReasoning ?? (gemini ? 'low' : undefined);
    const j = await fetchJson(`${env.openaiBaseUrl}/chat/completions`, {
      api: 'openai',
      method: 'POST',
      timeoutMs: env.llmTimeoutMs,
      headers: { Authorization: `Bearer ${env.openaiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: gemini ? Math.max(maxTokens, 4096) : maxTokens,
        ...(reasoning ? { reasoning_effort: reasoning } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const text = j?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      lastError = `빈 응답 (finish_reason=${j?.choices?.[0]?.finish_reason ?? '?'}, usage=${JSON.stringify(j?.usage ?? {})})`;
      log('LLM', lastError);
      return null;
    }
    lastError = null;
    return text;
  } catch (e) {
    lastError = (e as Error).message.replace(/key=[^&\s]+/gi, 'key=***').slice(0, 300);
    const status = (e as { status?: number }).status;
    if (status === 503 || status === 429 || /aborted/i.test((e as Error).message)) {
      log('LLM 일시 오류(혼잡·한도·시간 초과) → 다음 시도:', status ?? 'timeout');
      return 'retry';
    }
    log('LLM 실패 → 템플릿 사용:', lastError);
    return null;
  }
}

export async function llmExplain(ctx: ExplainContext): Promise<string | null> {
  return complete('explain', EXPLAIN_SYSTEM_PROMPT, `[사실]\n${ctx.facts}\n\n위 일정의 순서를 이렇게 정한 이유를 설명해 줘.`, 200);
}

export async function llmFreeText(text: string): Promise<FreeTextRule | null> {
  const out = await complete('freeText', FREETEXT_SYSTEM_PROMPT, text, 300);
  if (!out) return null;
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) {
    lastErrors.freeText = `JSON 아님: ${out.slice(0, 120)}`;
    return null;
  }
  try {
    const j = JSON.parse(m[0]);
    // 한 글자 키워드('산', '회')는 '남산골', '○○회관'까지 걸러 버리므로 두 글자 이상만
    const arr = (x: unknown) =>
      Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.trim().length >= 2).map((s) => s.trim()).slice(0, 8) : [];
    return { avoid: arr(j.avoid), prefer: arr(j.prefer), avoidFood: arr(j.avoidFood), preferFood: arr(j.preferFood), summary: String(j.summary ?? ''), source: 'llm' };
  } catch (e) {
    lastErrors.freeText = `JSON 해석 실패: ${(e as Error).message} · ${m[0].slice(0, 120)}`;
    return null;
  }
}

/** 개발 도구: 이 키로 쓸 수 있는 모델 이름 목록 (OpenAI 호환 GET /models) */
export async function llmListModels(): Promise<string[]> {
  if (llmKind() !== 'openai') return [];
  const j = await fetchJson(`${env.openaiBaseUrl}/models`, {
    api: 'openai/models',
    headers: { Authorization: `Bearer ${env.openaiKey}` },
    timeoutMs: 10000,
  });
  return (j?.data ?? []).map((m: any) => String(m.id ?? '')).filter(Boolean);
}

/** 개발 도구: 모델·추론 정도별로 짧은 호출 하나의 시간과 결과 */
export async function llmProbe(model: string, effort?: string) {
  const t0 = Date.now();
  try {
    const j = await fetchJson(`${env.openaiBaseUrl}/chat/completions`, {
      api: 'openai',
      method: 'POST',
      timeoutMs: env.llmTimeoutMs,
      headers: { Authorization: `Bearer ${env.openaiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        ...(effort ? { reasoning_effort: effort } : {}),
        messages: [{ role: 'user', content: '덕수궁을 한 문장으로 소개해 줘.' }],
      }),
    });
    return { ok: true, ms: Date.now() - t0, text: String(j?.choices?.[0]?.message?.content ?? '').slice(0, 120), usage: j?.usage };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: (e as Error).message.slice(0, 200) };
  }
}
