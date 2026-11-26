import type { Leg, Stop } from '@hyodo/core';
import { AccessBadges } from './ui';

function LegLine({ leg, walkLimit }: { leg: Leg; walkLimit: number }) {
  if (leg.minutes === 0) return null;
  if (leg.mode === 'taxi') {
    return (
      <div className="tl-leg taxi">
        도보 {leg.walkMinutes}분 → 택시 {leg.driveMinutes ?? leg.minutes}분
        <br />
        <small>
          {walkLimit}분 넘게 걸어야 해서 택시를 추천해요
          {leg.taxiFare ? ` · 약 ${leg.taxiFare.toLocaleString('ko-KR')}원` : ''}
        </small>
      </div>
    );
  }
  return <div className="tl-leg">도보 {leg.minutes}분</div>;
}

function kindLabel(s: Stop) {
  if (s.type === 'meal') return s.mealLabel === 'dinner' ? '저녁' : '점심';
  if (s.type === 'visit') return s.place.contentTypeId === '14' ? '문화시설' : s.place.contentTypeId === '38' ? '쇼핑' : '관광';
  return '';
}

function anchorText(s: Stop) {
  const lodging = s.place.kind === 'lodging';
  if (s.type === 'start') return lodging ? `숙소 ${s.place.name} 출발` : `${s.place.name} 출발`;
  return lodging ? `숙소 ${s.place.name} 도착 · 쉬기` : `${s.place.name} 도착 · 쉬기`;
}

/** 화면 ④ 시간순 타임라인. 관광지·식당을 누르면 상세·빼기·바꾸기, 숙소를 누르면 숙소 상세 */
export function Timeline({
  stops,
  walkLimit,
  onPick,
  onPickLodging,
}: {
  stops: Stop[];
  walkLimit: number;
  onPick: (s: Stop) => void;
  onPickLodging?: () => void;
}) {
  return (
    <div className="timeline">
      {stops.map((s, i) => (
        <div key={`${s.place.id}-${i}`}>
          {s.legFromPrev && <LegLine leg={s.legFromPrev} walkLimit={walkLimit} />}
          <div className="tl-row">
            <div className="tl-time">{s.type === 'start' ? s.depart : s.arrive}</div>
            {s.type === 'visit' || s.type === 'meal' ? (
              <button className={`tl-card ${s.type === 'meal' ? 'meal' : ''}`} onClick={() => onPick(s)} aria-label={`${s.place.name} — 자세히 보기, 빼거나 바꾸기`}>
                <div className="tl-body">
                  <div className="tl-text">
                    <div className="tl-name">
                      <span>{s.place.name}</span>
                      <span className="tl-more" aria-hidden>
                        ›
                      </span>
                    </div>
                    <div className="tl-meta">
                      <span className="tl-kind">{kindLabel(s)}</span> · {s.depart}까지 {s.stayMin}분
                      {s.type === 'meal' && s.place.menu ? ` · ${s.place.menu}` : ''}
                    </div>
                    <AccessBadges place={s.place} />
                  </div>
                  {(s.place.thumb || s.place.image) && <img className="tl-thumb" src={s.place.thumb || s.place.image} alt="" loading="lazy" />}
                </div>
              </button>
            ) : s.type === 'rest' ? (
              <div className="tl-card rest">
                <div className="tl-name">{s.restInPlace ? '잠시 쉬기' : '카페에서 쉬기'}</div>
                <div className="tl-meta">
                  {s.restInPlace ? '근처에 카페가 없어 그 자리에서 쉬어요' : s.place.name} · {s.stayMin}분
                </div>
              </div>
            ) : s.place.kind === 'lodging' && onPickLodging ? (
              <button className="tl-card anchor" onClick={onPickLodging} aria-label={`숙소 ${s.place.name} — 자세히 보기`}>
                <div className="tl-name">
                  <span>{anchorText(s)}</span>
                  <span className="tl-more" aria-hidden>
                    ›
                  </span>
                </div>
              </button>
            ) : (
              <div className="tl-card anchor">
                <div className="tl-name">{anchorText(s)}</div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
