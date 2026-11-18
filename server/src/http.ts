// 외부 API 호출 공통: 타임아웃, 메모리 캐시, 로그(키는 남기지 않음)

export class TtlCache<T> {
  private m = new Map<string, { v: T; exp: number }>();
  constructor(private max = 2000) {}
  get(k: string): T | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) {
      this.m.delete(k);
      return undefined;
    }
    return e.v;
  }
  set(k: string, v: T, ttlMs: number) {
    if (this.m.size >= this.max) {
      const first = this.m.keys().next().value;
      if (first !== undefined) this.m.delete(first);
    }
    this.m.set(k, { v, exp: Date.now() + ttlMs });
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public api: string,
    public status?: number,
  ) {
    super(message);
  }
}

/** URL 에서 인증키를 가린 문자열 (로그용) */
export function redact(url: string) {
  return url.replace(/(serviceKey=)[^&]+/i, '$1***');
}

export async function fetchText(
  url: string,
  init: RequestInit & { timeoutMs?: number; api: string },
): Promise<{ status: number; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e) {
    throw new ApiError(`${init.api} 호출 실패: ${(e as Error).message}`, init.api);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T = any>(url: string, init: RequestInit & { timeoutMs?: number; api: string }): Promise<T> {
  const { status, text } = await fetchText(url, init);
  if (status >= 400) throw new ApiError(`${init.api} HTTP ${status}: ${text.slice(0, 200)}`, init.api, status);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(`${init.api} JSON 아님: ${text.slice(0, 200)}`, init.api, status);
  }
}

/** 동시 실행 수 제한 map */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
