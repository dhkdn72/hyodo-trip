import { useCallback, useEffect, useState } from 'react';
import type { Place, PlanResult, Stop } from '@hyodo/core';
import { LoadingSteps } from './components/LoadingSteps';
import { fetchPlan, getStatus, IS_DEMO, type ServerStatus } from './lib/api';
import { ConditionScreen } from './screens/ConditionScreen';
import { PrefsScreen } from './screens/PrefsScreen';
import { ResultScreen } from './screens/ResultScreen';
import { ShareScreen } from './screens/ShareScreen';
import { TripScreen } from './screens/TripScreen';
import { EMPTY_ADJ, FLOW, loadForm, saveForm, toRequest, type Adjustments, type FormState } from './state';

type Step = 1 | 2 | 3 | 4 | 5;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uniq = (a: string[]) => [...new Set(a)];

export function App() {
  const [form, setForm] = useState<FormState>(loadForm);
  const [step, setStep] = useState<Step>(1);
  const [adj, setAdj] = useState<Adjustments>(EMPTY_ADJ);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);

  // 서버 상태 확인. 키가 없으면(예시 데이터 모드) 첫 화면을 예시 지역으로 채워 둠
  useEffect(() => {
    getStatus()
      .then((s) => {
        setStatus(s);
        if (!s.providers.kakao) {
          setForm((f) =>
            f.trip.region
              ? f
              : {
                  ...f,
                  trip: {
                    ...f.trip,
                    region: { name: s.sampleArea.name, pos: s.sampleArea.center },
                    origin: f.trip.origin ?? { name: '서울역 인근 숙소', pos: { lat: 37.5547, lng: 126.9707 } },
                  },
                },
          );
        }
      })
      .catch(() => setError('서버에 연결하지 못했어요. 서버(npm run dev)가 켜져 있는지 확인해 주세요.'));
  }, []);

  useEffect(() => saveForm(form), [form]);

  // 휴대폰 뒤로가기 버튼으로 이전 화면으로
  useEffect(() => {
    try {
      history.replaceState({ step: 1 }, '');
    } catch {
      /* 일부 임베드 환경 */
    }
    const onPop = (e: PopStateEvent) => setStep((e.state?.step as Step) ?? 1);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((s: Step) => {
    try {
      history.pushState({ step: s }, '');
    } catch {
      /* 무시 */
    }
    setStep(s);
    setError(null);
    window.scrollTo(0, 0);
  }, []);
  const back = useCallback(() => {
    try {
      history.back();
    } catch {
      setStep((s) => Math.max(1, s - 1) as Step);
    }
  }, []);

  /** 일정 계산. f 를 넘기면 아직 반영 전인 입력값으로 요청 */
  const make = async (nextAdj: Adjustments, fullScreen: boolean, f: FormState = form) => {
    setError(null);
    if (fullScreen) setLoading(true);
    else setBusy(true);
    try {
      // 전체 화면 대기는 6단계 안내를 읽을 수 있게 최소 1.4초 보여 줌
      const [r] = await Promise.all([fetchPlan(toRequest(f, nextAdj, FLOW === 'full')), fullScreen ? wait(1400) : null]);
      setResult(r);
      setAdj(nextAdj);
      if (fullScreen) go(4);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setBusy(false);
    }
  };

  /**
   * 화면 ④에서 손댄 장소만 바뀌도록, 지금 일정의 나머지 관광지·식당을 고정한 채 다시 계산
   * (빼기: 그 장소만 빠짐 / 바꾸기: 그 장소만 바뀜. 식당을 빼면 그 끼니만 다른 식당으로)
   */
  const lockedFrom = (r: PlanResult, a: Adjustments, dropId: string): Adjustments => {
    const visits = r.stops.filter((s) => s.type === 'visit').map((s) => s.place.id);
    const pinned: Adjustments['pinnedMeals'] = {};
    r.stops.forEach((s) => {
      if (s.type === 'meal' && s.place.id !== dropId) pinned[s.mealLabel ?? 'lunch'] = s.place.id;
    });
    return {
      excludeIds: uniq([...a.excludeIds, dropId]),
      includeIds: visits.filter((id) => id !== dropId),
      pinnedMeals: pinned,
      lock: true,
    };
  };

  const onRemove = (s: Stop) => result && make(lockedFrom(result, adj, s.place.id), false);
  const onReplace = (s: Stop, p: Place) => {
    if (!result) return;
    const base = lockedFrom(result, adj, s.place.id);
    base.excludeIds = base.excludeIds.filter((x) => x !== p.id);
    if (s.type === 'meal') base.pinnedMeals = { ...base.pinnedMeals, [s.mealLabel ?? 'lunch']: p.id };
    else base.includeIds = uniq([...base.includeIds, p.id]);
    make(base, false);
  };

  // 결과 없이 ④·⑤로 돌아온 경우(새로고침 등)
  const shown: Step = (step === 4 || step === 5) && !result ? 2 : step;

  return (
    <main className="app">
      {IS_DEMO && (
        <div className="notice" style={{ borderRadius: 0, border: 0, borderBottom: '1px solid #f1e3b8', textAlign: 'center' }}>
          데모 — 서버 없이 예시 데이터(서울 중구)로 동작해요
        </div>
      )}
      {error && !loading && (
        <div className="notice warn" role="alert" style={{ margin: '12px 18px 0' }}>
          {error}
        </div>
      )}
      {loading ? (
        <section className="screen">
          <LoadingSteps />
        </section>
      ) : shown === 1 ? (
        <TripScreen trip={form.trip} onChange={(trip) => setForm({ ...form, trip })} onNext={() => go(2)} sampleNote={status && !status.providers.kakao ? status.sampleArea.note : null} />
      ) : shown === 2 ? (
        <ConditionScreen
          cond={form.condition}
          onChange={(condition) => setForm({ ...form, condition })}
          onBack={back}
          onNext={() => (FLOW === 'mvp' ? make(EMPTY_ADJ, true) : go(3))}
        />
      ) : shown === 3 ? (
        <PrefsScreen
          prefs={form.prefs}
          onChange={(prefs) => setForm({ ...form, prefs, prefsSkipped: false })}
          onBack={back}
          onMake={() => {
            const f = { ...form, prefsSkipped: false };
            setForm(f);
            make(EMPTY_ADJ, true, f);
          }}
          onSkip={() => {
            const f = { ...form, prefsSkipped: true };
            setForm(f);
            make(EMPTY_ADJ, true, f);
          }}
        />
      ) : shown === 4 && result ? (
        <ResultScreen
          result={result}
          busy={busy}
          adjusted={adj.lock}
          onBack={back}
          onRemove={onRemove}
          onReplace={onReplace}
          onResetAdjust={() => make(EMPTY_ADJ, false)}
          onShare={() => go(5)}
        />
      ) : shown === 5 && result ? (
        <ShareScreen result={result} onBack={back} />
      ) : null}
    </main>
  );
}
