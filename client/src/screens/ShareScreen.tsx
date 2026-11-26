import { useCallback, useMemo, useRef, useState } from 'react';
import { formatKoreanDate, type PlanResult, type Stop, type TripPlan } from '@hyodo/core';
import { Header, Sheet, Toast } from '../components/ui';
import { IS_DEMO } from '../lib/api';
import { download, renderCard, savePdf, shareToKakaoTalk } from '../lib/share';

const HOME = /(숙소|호텔|집|게스트하우스|리조트|펜션|모텔|스테이)/;

/** 부모님이 보기 쉽게 짧게: '덕수궁', '점심 · 곰탕', '한옥마을 · 택시', '카페에서 쉬기' */
function rowLabel(s: Stop): string | null {
  const taxi = s.legFromPrev?.mode === 'taxi' ? ' · 택시' : '';
  switch (s.type) {
    case 'visit':
      return `${s.place.name}${taxi}`;
    case 'meal': {
      const food = s.place.menu?.split(/[,·/]/)[0]?.trim();
      return `${s.mealLabel === 'dinner' ? '저녁' : '점심'} · ${food || s.place.name}${taxi}`;
    }
    case 'rest':
      return s.restInPlace ? '잠시 쉬기' : '카페에서 쉬기';
    case 'end':
      return s.place.kind === 'lodging' || HOME.test(s.place.name) ? `숙소에서 쉬기${taxi}` : `${s.place.name} 도착${taxi}`;
    default:
      return null;
  }
}

const rowsOf = (d: PlanResult) =>
  d.stops.map((s) => ({ s, label: rowLabel(s) })).filter((r): r is { s: Stop; label: string } => !!r.label);

function Rows({ rows }: { rows: { s: Stop; label: string }[] }) {
  return (
    <ul className="share-rows">
      {rows.map(({ s, label }, i) => (
        <li key={i}>
          <time>{s.arrive}</time>
          <span>
            {label.endsWith(' · 택시') ? (
              <>
                {label.replace(/ · 택시$/, '')}
                <span className="taxi"> · 택시</span>
              </>
            ) : (
              label
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 화면 ⑤ 한 장 일정표 공유 — F5 (여러 날이면 날짜별로 나눠 한 장에) */
export function ShareScreen({ plan, onBack }: { plan: TripPlan; onBack: () => void }) {
  const result = plan.days[0];
  const multi = plan.days.length > 1;
  const [title, setTitle] = useState(plan.title);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const clearToast = useCallback(() => setToast(null), []);
  /** 데모 페이지(저장·공유가 막힌 곳)에서는 만들어진 이미지를 화면에 보여 줌 */
  const [preview, setPreview] = useState<string | null>(null);

  const dayRows = useMemo(() => plan.days.map(rowsOf), [plan]);
  const rows = dayRows[0];
  const hasTaxi = plan.days.some((d) => d.summary.taxiLegs > 0);
  const hasRest = plan.days.some((d) => d.summary.restCount > 0);
  const last = plan.days[plan.days.length - 1];
  const fileBase = `효도여행_일정_${result.date.replace(/-/g, '')}`;
  const description = rows.map((r) => `${r.s.arrive} ${r.label}`).slice(0, 4).join(' / ');

  const run = async (fn: (blob: Blob) => Promise<void>) => {
    if (!cardRef.current) return;
    setBusy(true);
    try {
      const blob = await renderCard(cardRef.current);
      if (IS_DEMO) {
        setPreview(URL.createObjectURL(blob));
        return;
      }
      await fn(blob);
    } catch (e) {
      setToast((e as Error).message || '문제가 생겼어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="screen">
      <Header step={5} title="부모님께 보내기" onBack={onBack} />
      <div className="screen-body">
        <label className="field-label" htmlFor="share-title">
          제목
        </label>
        <input id="share-title" className="title-input" value={title} maxLength={24} onChange={(e) => setTitle(e.target.value)} />

        <div ref={cardRef} className={`share-card ${multi ? 'compact' : ''}`} aria-label="한 장 일정표 미리보기">
          <p className="share-title">{title || ' '}</p>
          <p className="share-date">
            {multi ? `${formatKoreanDate(result.date)} ~ ${formatKoreanDate(last.date)}` : formatKoreanDate(result.date, true)}
          </p>
          {multi && plan.lodging && <p className="share-lodging">숙소 · {plan.lodging.name}</p>}
          {multi ? (
            plan.days.map((d, i) => (
              <div className="share-day" key={d.date}>
                <p className="share-day-head">
                  {i + 1}일차 · {formatKoreanDate(d.date)}
                </p>
                <Rows rows={dayRows[i]} />
              </div>
            ))
          ) : (
            <Rows rows={rows} />
          )}
          <div className="share-foot">
            {hasTaxi && <div>{result.condition.walkLimitMin}분 넘게 걷는 길은 택시로 가요</div>}
            {hasRest && <div>중간중간 카페에서 쉬어 가요</div>}
            {!hasTaxi && !hasRest && <div>천천히 다녀오세요</div>}
          </div>
        </div>
        <p className="subtitle" style={{ fontSize: 13 }}>
          부모님은 앱 설치 없이 사진 한 장으로 받으세요. 시간·장소·이동 방법만 크게 적었어요.
        </p>
      </div>

      <div className="actions">
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            run(async (blob) => {
              const r = await shareToKakaoTalk(blob, `${fileBase}.png`, title, description);
              if (r === 'download') setToast('이미지를 저장했어요. 카카오톡에서 사진으로 보내 주세요.');
            })
          }
        >
          {busy ? '만드는 중…' : '카카오톡으로 보내기'}
        </button>
        <div className="btn-row">
          <button
            className="btn outline"
            disabled={busy}
            onClick={() =>
              run(async (blob) => {
                download(blob, `${fileBase}.png`);
                setToast('이미지로 저장했어요.');
              })
            }
          >
            이미지로 저장
          </button>
          <button
            className="btn outline"
            disabled={busy}
            onClick={() =>
              run(async (blob) => {
                await savePdf(blob, `${fileBase}.pdf`);
                setToast('PDF로 저장했어요.');
              })
            }
          >
            PDF로 저장
          </button>
        </div>
      </div>
      <Toast text={toast} onDone={clearToast} />
      <Sheet
        open={!!preview}
        onClose={() => {
          if (preview) URL.revokeObjectURL(preview);
          setPreview(null);
        }}
        title="만들어진 일정표 이미지"
      >
        <p className="notice">데모 페이지에서는 저장·카카오톡 전송이 막혀 있어 만들어진 이미지만 보여 드려요. 실제 웹앱에서는 바로 저장·전송돼요.</p>
        {preview && <img src={preview} alt="한 장 일정표" style={{ width: '100%', marginTop: 10, borderRadius: 12 }} />}
      </Sheet>
    </section>
  );
}
