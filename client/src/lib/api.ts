// 서버 API 호출. 데모 빌드(mode=demo)에서는 서버 없이 브라우저 안에서 같은 엔진을 예시 데이터로 돌립니다.

import type { GeoResult, PlanRequest, PlanResult } from '@hyodo/core';

export const IS_DEMO = import.meta.env.MODE === 'demo';
const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export interface ServerStatus {
  providers: { tourApi: boolean; korWith: boolean; kakao: boolean; llm: string | null };
  sampleArea: { name: string; center: { lat: number; lng: number }; note: string };
}

export async function getStatus(): Promise<ServerStatus> {
  if (IS_DEMO) {
    const core = await import('@hyodo/core');
    return { providers: { tourApi: false, korWith: false, kakao: false, llm: null }, sampleArea: core.SAMPLE_AREA };
  }
  const r = await fetch(`${BASE}/api/status`);
  if (!r.ok) throw new Error('서버에 연결하지 못했어요.');
  return r.json();
}

export async function geoSearch(q: string, kind: 'region' | 'origin'): Promise<{ results: GeoResult[]; source: string }> {
  if (IS_DEMO) {
    const core = await import('@hyodo/core');
    return { results: core.sampleGeoSearch(q), source: 'sample' };
  }
  const r = await fetch(`${BASE}/api/geo?${new URLSearchParams({ q, kind })}`);
  if (!r.ok) throw new Error('검색에 실패했어요.');
  return r.json();
}

export async function fetchPlan(req: PlanRequest): Promise<PlanResult> {
  if (IS_DEMO) {
    const core = await import('@hyodo/core');
    try {
      return await core.planTrip(req, core.createSampleProviders({ latencyMs: 120 }));
    } catch (e) {
      throw new Error((e as Error).message);
    }
  }
  const r = await fetch(`${BASE}/api/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  const j = await r.json().catch(() => ({ error: '서버 응답을 읽지 못했어요.' }));
  if (!r.ok) throw new Error(j.error ?? '일정을 만들지 못했어요.');
  return j as PlanResult;
}
