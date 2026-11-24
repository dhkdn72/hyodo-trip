import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { planTrip, PlanError, SAMPLE_AREA, sampleGeoSearch, type PlanRequest } from '@hyodo/core';
import { env } from './env.ts';
import { log } from './http.ts';
import { createProviders, providerStatus } from './providers/index.ts';
import { kakaoGeoSearch } from './providers/kakao.ts';
import { validatePlanRequest } from './validate.ts';

const app = express();
app.use(express.json({ limit: '200kb' }));

// 앱(Capacitor 등 다른 Origin)에서 호출할 수 있도록 CORS
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && (env.corsOrigins.length === 0 || env.corsOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const providers = createProviders();

app.get('/api/status', (_req, res) => {
  res.json({ providers: providerStatus(), sampleArea: SAMPLE_AREA });
});

// 화면 ① 지역·출발 장소 검색 (카카오 로컬 API, 키 없으면 예시 지명)
app.get('/api/geo', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 60);
  const kind = req.query.kind === 'origin' ? 'origin' : 'region';
  if (!env.kakaoRestKey) return res.json({ results: sampleGeoSearch(q), source: 'sample' });
  if (!q) return res.json({ results: [], source: 'kakao' });
  try {
    res.json({ results: await kakaoGeoSearch(q, kind), source: 'kakao' });
  } catch (e) {
    log('지오코딩 실패', (e as Error).message);
    res.json({ results: sampleGeoSearch(q), source: 'sample', error: '카카오 검색에 실패해 예시 지명을 보여 줘요.' });
  }
});

// 화면 ④ 일정 계산 (6단계)
app.post('/api/plan', async (req, res) => {
  const problem = validatePlanRequest(req.body);
  if (problem) return res.status(400).json({ error: problem, code: 'BAD_INPUT' });
  const t0 = Date.now();
  try {
    const result = await planTrip(req.body as PlanRequest, providers);
    log(`일정 계산 ${Date.now() - t0}ms · 방문 ${result.summary.visitCount}곳 · 택시 ${result.summary.taxiLegs}구간`);
    res.json(result);
  } catch (e) {
    if (e instanceof PlanError) return res.status(422).json({ error: e.message, code: e.code });
    log('일정 계산 오류', e);
    res.status(500).json({ error: '일정을 계산하다 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', code: 'INTERNAL' });
  }
});

// 빌드된 웹 화면 제공 (npm run build 후)
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '../../client/dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(env.port, () => {
  const s = providerStatus();
  log(`효도여행 서버 http://localhost:${env.port}`);
  log(
    `TourAPI ${s.tourApi ? '✓' : '× (예시 데이터)'} · 무장애 ${s.korWith ? '✓' : '× (예시)'} · 카카오 ${s.kakao ? '✓' : '× (직선거리 추정)'} · LLM ${s.llm ?? '× (템플릿)'}`,
  );
});
