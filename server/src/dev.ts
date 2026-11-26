// 개발 도구 (/api/dev/*) — `npm run dev` 로 켠 서버에서만 열립니다 (--dev). 배포(npm start)에서는 없음.
//  GET /api/dev/eval-dump?name=seoul-center&lat=..&lng=..&radius=3000
//      반경 안의 관광지·쇼핑 후보를 앱과 같은 기준으로 모아 소개글·분류 이름과 함께 eval/data/<name>.json 에 저장
//  GET /api/dev/eval-run
//      eval/ 의 데이터·정답으로 추천 방식 비교 → eval/results.md
//  GET /api/dev/llm-models, /api/dev/llm-probe?model=..&effort=low
//      LLM 키로 쓸 수 있는 모델 목록, 짧은 호출 하나의 응답 시간 (모델 고르기용)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Express } from 'express';
import { categoryCheck, haversine, isShoppingSpot, type Place } from '@hyodo/core';
import { env } from './env.ts';
import { EVAL_DIR, reportMarkdown, runEval, writeReport, type EvalPlace } from './evalRecommend.ts';
import { log, mapLimit } from './http.ts';
import { llmListModels, llmProbe } from './providers/llm.ts';
import { lclsNames, overviewOf } from './providers/semantic.ts';
import { tourSearch } from './providers/tourApi.ts';

export function mountDevTools(app: Express) {
  if (!env.devTools) return;
  log('개발 도구 켜짐: /api/dev/eval-dump, /api/dev/eval-run, /api/dev/llm-models, /api/dev/llm-probe');

  app.get('/api/dev/eval-dump', async (req, res) => {
    const name = String(req.query.name ?? '');
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = Math.min(20000, Math.max(500, Number(req.query.radius ?? 3000)));
    const max = Math.min(150, Math.max(10, Number(req.query.max ?? 80)));
    if (!/^[a-z0-9-]{2,30}$/.test(name) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'name(영문 소문자·숫자·-), lat, lng 가 필요해요.' });
    }
    if (!env.tourApiKey) return res.status(400).json({ error: 'TOUR_API_KEY 가 필요해요.' });
    try {
      const center = { lat, lng };
      const [attr, shop] = await Promise.all([tourSearch(center, radius, 'attraction'), tourSearch(center, radius, 'shopping')]);
      const seen = new Set<string>();
      // 앱이 후보로 쓰는 곳만 (교통시설·공연장·숙박 등 제외, 쇼핑은 시장·백화점 등만)
      const list: Place[] = [...attr, ...shop]
        .filter((p) => !seen.has(p.id) && seen.add(p.id))
        .filter((p) => (p.contentTypeId === '38' ? isShoppingSpot(p) : !categoryCheck(p, null).excluded))
        .sort((a, b) => haversine(center, a.pos) - haversine(center, b.pos))
        .slice(0, max);
      const names = await lclsNames();
      const out: EvalPlace[] = await mapLimit(list, 4, async (p) => ({
        id: p.id,
        name: p.name,
        addr: p.addr,
        lcls: p.lcls,
        catPath: p.lcls?.[2] ? names.get(p.lcls[2]) : undefined,
        overview: await overviewOf(p),
        dist: Math.round(haversine(center, p.pos)),
      }));
      mkdirSync(join(EVAL_DIR, 'data'), { recursive: true });
      const file = join(EVAL_DIR, 'data', `${name}.json`);
      writeFileSync(file, JSON.stringify(out, null, 1));
      res.json({ file: `eval/data/${name}.json`, count: out.length, withOverview: out.filter((p) => p.overview).length });
    } catch (e) {
      log('eval-dump 오류', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/dev/llm-models', async (_req, res) => {
    try {
      res.json({ models: await llmListModels() });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message.slice(0, 200) });
    }
  });

  app.get('/api/dev/llm-probe', async (req, res) => {
    const model = String(req.query.model ?? env.openaiModel ?? '');
    const effort = req.query.effort ? String(req.query.effort) : undefined;
    if (!/^[\w./:-]{2,80}$/.test(model) || (effort && !/^[a-z]{3,10}$/.test(effort))) return res.status(400).json({ error: '모델 이름이 잘못됐어요.' });
    res.json(await llmProbe(model, effort));
  });

  app.get('/api/dev/eval-run', async (_req, res) => {
    try {
      const r = await runEval();
      writeReport(r);
      res.json({ ...r, markdown: reportMarkdown(r) });
    } catch (e) {
      log('eval-run 오류', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
