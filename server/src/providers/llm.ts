// LLM API — 6 설명 붙이기, 자유 입력 → 조건
// ANTHROPIC_API_KEY 가 있으면 Anthropic Messages API, 없고 OPENAI_API_KEY+OPENAI_MODEL 이 있으면
// OpenAI 호환 Chat Completions API 를 씁니다. 실패하면 null → 엔진이 템플릿·규칙으로 대체합니다.

import { EXPLAIN_SYSTEM_PROMPT, FREETEXT_SYSTEM_PROMPT, type ExplainContext, type FreeTextRule } from '@hyodo/core';
import { env, llmKind } from '../env.ts';
import { fetchJson, log } from '../http.ts';

async function complete(system: string, user: string, maxTokens = 300): Promise<string | null> {
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
    const j = await fetchJson(`${env.openaiBaseUrl}/chat/completions`, {
      api: 'openai',
      method: 'POST',
      timeoutMs: 12000,
      headers: { Authorization: `Bearer ${env.openaiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.openaiModel,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    return j?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    log('LLM 실패 → 템플릿 사용:', (e as Error).message);
    return null;
  }
}

export async function llmExplain(ctx: ExplainContext): Promise<string | null> {
  return complete(EXPLAIN_SYSTEM_PROMPT, `[사실]\n${ctx.facts}\n\n위 일정의 순서를 이렇게 정한 이유를 설명해 줘.`, 200);
}

export async function llmFreeText(text: string): Promise<FreeTextRule | null> {
  const out = await complete(FREETEXT_SYSTEM_PROMPT, text, 300);
  if (!out) return null;
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const arr = (x: unknown) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s.trim()).slice(0, 8) : []);
    return { avoid: arr(j.avoid), prefer: arr(j.prefer), avoidFood: arr(j.avoidFood), summary: String(j.summary ?? ''), source: 'llm' };
  } catch {
    return null;
  }
}
