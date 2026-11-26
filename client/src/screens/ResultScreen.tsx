import { useMemo, useState } from 'react';
import { formatKoreanDate, haversine, type DataSources, type Place, type Stop, type TripPlan } from '@hyodo/core';
import { PlaceDetailView } from '../components/PlaceDetailView';
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
  // 'mixed'는 카카오 값이 대부분이고 일부 구간(출발=도착 등)만 추정치라 경고하지 않음
  if (ds.walk === 'estimate' || ds.taxi === 'estimate') fake.push('이동 시간');
  if (!fake.length) return null;
  return `${fake.join('·')}은(는) API 키가 없어 예시 데이터·추정치로 보여 주고 있어요. 실제 방문 계획에 그대로 쓰지 마세요.`;
}

const fmtDist = (d: number) => (d < 1000 ? `${Math.round(d / 10) * 10}m` : `${(d / 1000).toFixed(1)}km`);
const shortDate = (ymd: string) => formatKoreanDate(ymd).replace(/^(\d+)월 (\d+)일/, '$1/$2');

/** 화면 ④ 일정 결과 — F1 컨디션 반영 · F2 동선 최적화 · F3 무장애 배지 · 장소 상세 · 여러 날 일정 */
export function ResultScreen({
  plan,
  dayIdx,
  onDay,
  busy,
  adjusted,
  onBack,
  onRemove,
  onReplace,
  onReplaceLodging,
  onResetAdjust,
  onShare,
}: {
  plan: TripPlan;
  dayIdx: number;
  onDay: (i: number) => void;
  busy: boolean;
  adjusted: boolean;
  onBack: () => void;
  onRemove: (s: Stop) => void;
  onReplace: (s: Stop, p: Place) => void;
  onReplaceLodging: (p: Place) => void;
  onResetAdjust: () => void;
  onShare: () => void;
}) {
  const result = plan.days[Math.min(dayIdx, plan.days.length - 1)];
  const multi = plan.days.length > 1;
  const [picked, setPicked] = useState<Stop | null>(null);
  const [mode, setMode] = useState<'menu' | 'replace'>('menu');
  const [lodgingSheet, setLodgingSheet] = useState<null | 'detail' | 'replace'>(null);
  const notice = sourcesNotice(result.dataSources);
  const s = result.summary;
  const first = plan.days[0];
  const lastDay = plan.days[plan.days.length - 1];
  const radiusNote = `반경 ${plan.radiusM / 1000}km${plan.radiusM > first.requestedRadiusM ? '(자동 확장)' : ''}`;

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
  const lodgingAlts = useMemo(() => {
    const l = plan.lodging;
    if (!l) return [];
    return plan.lodgingAlternatives.map((p) => ({ p, d: haversine(l.pos, p.pos) }));
  }, [plan]);

  return (
    <section className="screen" style={{ position: 'relative' }}>
      <Header
        step={4}
        title={multi ? plan.title : `${formatKoreanDate(result.date).replace(/ \(.\)/, '')} 일정`}
        subtitle={
          multi
            ? `${shortDate(first.date)} ~ ${shortDate(lastDay.date)} · 하루 ${first.trip.startTime}–${first.trip.endTime} · ${radiusNote}`
            : `${result.trip.regionName} · ${result.trip.startTime}–${result.trip.endTime} · ${radiusNote}`
        }
        onBack={onBack}
      />
      <div className="screen-body">
        {notice && <div className="notice">{notice}</div>}

        {multi && (
          <div className="seg day-tabs" role="tablist" aria-label="날짜">
            {plan.days.map((d, i) => (
              <button key={d.date} role="tab" aria-selected={i === dayIdx} aria-pressed={i === dayIdx} onClick={() => onDay(i)}>
                {i + 1}일차
                <small>{shortDate(d.date)}</small>
              </button>
            ))}
          </div>
        )}

        {multi && (
          <div className="card">
            <span className="field-label">숙소 {plan.lodgingSource === 'recommended' ? '(추천)' : plan.lodgingSource === 'user' ? '(직접 정함)' : ''}</span>
            {plan.lodging ? (
              <div className="lodging-card">
                {(plan.lodging.thumb || plan.lodging.image) && <img className="lc-thumb" src={plan.lodging.thumb || plan.lodging.image} alt="" />}
                <div className="lc-main">
                  <div className="lc-name">{plan.lodging.name}</div>
                  {plan.lodging.addr && <span className="field-sub">{plan.lodging.addr}</span>}
                  {plan.lodging.source !== 'user' && <AccessBadges place={plan.lodging} />}
                </div>
                <div className="lc-actions">
                  <button className="btn outline" onClick={() => setLodgingSheet('detail')}>
                    자세히
                  </button>
                  {lodgingAlts.length > 0 && (
                    <button className="btn outline" onClick={() => setLodgingSheet('replace')} disabled={busy}>
                      바꾸기
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="subtitle" style={{ margin: 0 }}>숙소를 정하지 못했어요.</p>
            )}
            {plan.warnings.length > 0 && (
              <ul className="subtitle" style={{ paddingLeft: 18, margin: '8px 0 0', fontSize: 13.5 }}>
                {plan.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

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

        <Timeline
          stops={result.stops}
          walkLimit={result.condition.walkLimitMin}
          onPick={(st) => {
            setMode('menu');
            setPicked(st);
          }}
          onPickLodging={plan.lodging ? () => setLodgingSheet('detail') : undefined}
        />
        <p className="subtitle" style={{ fontSize: 13 }}>
          장소를 누르면 사진·이용시간·메뉴를 보고, 빼거나 다른 곳으로 바꿀 수 있어요. 바꾸면 일정이 다시 계산돼요.
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
            <li>취향 추천</li>
            <li>
              {result.dataSources.recommend === 'semantic' ? `${result.dataSources.recommendModel} + 키워드 규칙` : '키워드 규칙'}
            </li>
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
            <PlaceDetailView place={picked.place} />
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
                  여기서 {fmtDist(d)}
                  {p.menu ? ` · ${p.menu}` : ''}
                </span>
                <AccessBadges place={p} />
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      <Sheet open={lodgingSheet === 'detail' && !!plan.lodging} onClose={() => setLodgingSheet(null)} title={plan.lodging ? `숙소 · ${plan.lodging.name}` : ''}>
        {plan.lodging && (
          <div className="sheet-actions">
            {plan.lodging.source === 'user' ? (
              <p className="subtitle">직접 정한 숙소예요. 체크인 시간과 엘리베이터·주차는 숙소에 확인해 주세요.</p>
            ) : (
              <PlaceDetailView place={plan.lodging} />
            )}
            {lodgingAlts.length > 0 && (
              <button className="btn" onClick={() => setLodgingSheet('replace')} disabled={busy}>
                다른 숙소로 바꾸기
              </button>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={lodgingSheet === 'replace'} onClose={() => setLodgingSheet(null)} title="다른 숙소">
        <p className="subtitle" style={{ marginTop: 0 }}>숙소를 바꾸면 다니는 곳은 그대로 두고 순서·이동만 다시 계산해요.</p>
        <ul className="result-list">
          {lodgingAlts.map(({ p, d }) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  onReplaceLodging(p);
                  setLodgingSheet(null);
                }}
              >
                <b>{p.name}</b>
                <span>
                  지금 숙소에서 {fmtDist(d)}
                  {p.addr ? ` · ${p.addr}` : ''}
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
