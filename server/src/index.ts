import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { planJourney, PlanError, SAMPLE_AREA, sampleGeoSearch, type PlanRequest } from '@hyodo/core';
import { env } from './env.ts';
import { log } from './http.ts';
import { createProviders, providerStatus } from './providers/index.ts';
import { kakaoGeoSearch } from './providers/kakao.ts';
import { parsePlaceRef, validatePlanRequest } from './validate.ts';

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
    const result = await planJourney(req.body as PlanRequest, providers);
    const visits = result.days.reduce((n, d) => n + d.summary.visitCount, 0);
    const taxis = result.days.reduce((n, d) => n + d.summary.taxiLegs, 0);
    log(`일정 계산 ${Date.now() - t0}ms · ${result.days.length}일 · 방문 ${visits}곳 · 택시 ${taxis}구간${result.lodging ? ` · 숙소 ${result.lodging.name}` : ''}`);
    res.json(result);
  } catch (e) {
    if (e instanceof PlanError) return res.status(422).json({ error: e.message, code: e.code });
    log('일정 계산 오류', e);
    res.status(500).json({ error: '일정을 계산하다 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', code: 'INTERNAL' });
  }
});

// 화면 ④ 장소 상세 (사진·소개·이용시간·메뉴·근처 관광지·카카오맵 링크)
app.get('/api/place', async (req, res) => {
  const ref = parsePlaceRef(req.query);
  if (!ref) return res.status(400).json({ error: '장소 정보가 잘못됐어요.', code: 'BAD_INPUT' });
  try {
    res.json(await providers.placeDetail!(ref));
  } catch (e) {
    log('장소 상세 오류', e);
    res.status(500).json({ error: '장소 정보를 불러오지 못했어요.', code: 'INTERNAL' });
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
