import { useMemo, useState } from 'react';
import { formatKoreanDate, haversine, type DataSources, type Place, type PlanResult, type Stop } from '@hyodo/core';
import { RouteMap } from '../components/RouteMap';
import { Timeline } from '../components/Timeline';
import { AccessBadges, Header, Sheet } from '../components/ui';
import { FLOW } from '../state';

const SRC_LABEL: Record<string, string> = {
  tourapi: 'TourAPI',
  korwith: '무장애 여행 정보 API',
  kakao: '카카오',
  sample: '예시 데이터',
  estimate: '직선거리 추정',
  mixed: '카카오 + 일부 추정',
  none: '해당 없음',
  llm: 'LLM',
  template: '자동 문장(템플릿)',
  rule: '키워드 규칙',
};

function sourcesNotice(ds: DataSources): string | null {
  const fake: string[] = [];
  if (ds.places === 'sample') fake.push('장소');
  if (ds.access === 'sample') fake.push('무장애 정보');
  if (ds.walk !== 'kakao' || (ds.taxi !== 'kakao' && ds.taxi !== 'none')) fake.push('이동 시간');
  if (!fake.length) return null;
  return `${fake.join('·')}은(는) API 키가 없어 예시 데이터·추정치로 보여 주고 있어요. 실제 방문 계획에 그대로 쓰지 마세요.`;
}

/** 화면 ④ 일정 결과 — F1 컨디션 반영 · F2 동선 최적화 · F3 무장애 배지 */
export function ResultScreen({
  result,
  busy,
  adjusted,
  onBack,
  onRemove,
  onReplace,
  onResetAdjust,
  onShare,
}: {
  result: PlanResult;
  busy: boolean;
  adjusted: boolean;
  onBack: () => void;
  onRemove: (s: Stop) => void;
  onReplace: (s: Stop, p: Place) => void;
  onResetAdjust: () => void;
  onShare: () => void;
}) {
  const [picked, setPicked] = useState<Stop | null>(null);
  const [mode, setMode] = useState<'menu' | 'replace'>('menu');
  const notice = sourcesNotice(result.dataSources);
  const s = result.summary;

  const alternatives = useMemo(() => {
    if (!picked) return [];
    const list = picked.type === 'meal' ? result.alternatives.restaurants : result.alternatives.attractions;
    return list
      .map((p) => ({ p, d: haversine(picked.place.pos, p.pos) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
  }, [picked, result]);

  const close = () => {
    setPicked(null);
    setMode('menu');
  };

  return (
    <section className="screen" style={{ position: 'relative' }}>
      <Header step={4} title={`${formatKoreanDate(result.date).replace(/ \(.\)/, '')} 일정`} subtitle={`${result.trip.regionName} · ${result.trip.startTime}–${result.trip.endTime}`} onBack={onBack} />
      <div className="screen-body">
        {notice && <div className="notice">{notice}</div>}

        <RouteMap stops={result.stops} />

        <div className="summary" aria-label="요약">
          <div>
            <b>{s.totalWalkMin}분</b>
            <span>총 걷기</span>
          </div>
          <div>
            <b>{s.taxiLegs}구간</b>
            <span>택시</span>
          </div>
          <div>
            <b>{s.restCount}번</b>
            <span>휴식</span>
          </div>
          <div>
            <b>{s.endsAt}</b>
            <span>끝나는 시각</span>
          </div>
        </div>

        <div className="why">
          <div className="why-head">
            왜 이 순서인가요?<span className="why-src">{result.dataSources.explain === 'llm' ? 'AI가 계산 결과를 풀어 씀' : '계산 결과로 만든 문장'}</span>
          </div>
          {result.explanation}
        </div>

        {result.freeTextRule && (
          <div className="notice" style={{ background: 'var(--primary-softer)', borderColor: '#d3e6e4', color: 'var(--ink-2)' }}>
            “{result.freeTextRule.summary}” <small>({SRC_LABEL[result.freeTextRule.source]})</small>
          </div>
        )}

        {result.warnings.length > 0 && (
          <div className="notice warn" role="note">
            <b>확인해 주세요</b>
            <ul>
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <Timeline stops={result.stops} walkLimit={result.condition.walkLimitMin} onPick={setPicked} />
        <p className="subtitle" style={{ fontSize: 13 }}>
          장소를 누르면 빼거나 다른 곳으로 바꿀 수 있어요. 바꾸면 일정이 다시 계산돼요.
        </p>
        {adjusted && (
          <button className="btn text" onClick={onResetAdjust}>
            처음 일정으로 되돌리기
          </button>
        )}

        <details className="pipe">
          <summary>서버가 한 일 (6단계)</summary>
          <ol className="pipe-list">
            {result.pipeline.map((p, i) => (
              <li key={p.key}>
                <span className="pipe-no">{i + 1}</span>
                <span>
                  <b>{p.label}</b> — {p.detail}
                </span>
                <span className="pipe-ms">{p.ms}ms</span>
              </li>
            ))}
          </ol>
          <ul className="src-list">
            <li>장소</li>
            <li>{SRC_LABEL[result.dataSources.places]}</li>
            <li>무장애</li>
            <li>{SRC_LABEL[result.dataSources.access]}</li>
            <li>도보</li>
            <li>{SRC_LABEL[result.dataSources.walk]}{result.dataSources.walk !== 'estimate' ? ' (편안한 길)' : ''}</li>
            <li>택시</li>
            <li>{SRC_LABEL[result.dataSources.taxi]}</li>
            <li>카페</li>
            <li>{SRC_LABEL[result.dataSources.cafes]}</li>
            <li>설명</li>
            <li>{SRC_LABEL[result.dataSources.explain]}</li>
          </ul>
        </details>
      </div>

      <div className="actions">
        {FLOW === 'full' && (
          <button className="btn" onClick={onShare} disabled={busy}>
            부모님께 보내기
          </button>
        )}
        <button className={`btn ${FLOW === 'full' ? 'outline' : ''}`} onClick={onBack} disabled={busy}>
          조건 바꾸기
        </button>
      </div>

      {busy && <div className="overlay">일정을 다시 계산하고 있어요…</div>}

      <Sheet open={!!picked && mode === 'menu'} onClose={close} title={picked?.place.name ?? ''}>
        {picked && (
          <div className="sheet-actions">
            {picked.place.addr && <p className="subtitle">{picked.place.addr}</p>}
            <AccessBadges place={picked.place} />
            {picked.place.access?.known && (
              <ul className="subtitle" style={{ paddingLeft: 18, margin: '4px 0 8px' }}>
                {Object.entries(picked.place.access.items)
                  .filter(([, v]) => v?.text && v.text !== '예시 데이터')
                  .map(([k, v]) => (
                    <li key={k}>{v!.text}</li>
                  ))}
              </ul>
            )}
            <button className="btn" onClick={() => setMode('replace')} disabled={!alternatives.length}>
              다른 {picked.type === 'meal' ? '식당' : '곳'}으로 바꾸기
            </button>
            <button
              className="btn outline"
              disabled={picked.type === 'visit' && result.summary.visitCount <= 1}
              onClick={() => {
                onRemove(picked);
                close();
              }}
            >
              이 {picked.type === 'meal' ? '식당' : '장소'} 빼기
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={!!picked && mode === 'replace'} onClose={close} title={`${picked?.place.name ?? ''} 대신`}>
        <ul className="result-list">
          {alternatives.map(({ p, d }) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  onReplace(picked!, p);
                  close();
                }}
              >
                <b>{p.name}</b>
                <span>
                  여기서 {d < 1000 ? `${Math.round(d / 10) * 10}m` : `${(d / 1000).toFixed(1)}km`}
                  {p.menu ? ` · ${p.menu}` : ''}
                </span>
                <AccessBadges place={p} />
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </section>
  );
}
