import { useState } from 'react';
import { addDays, formatKoreanDate, toMin } from '@hyodo/core';
import { PlaceSearchSheet } from '../components/PlaceSearchSheet';
import { Header, Segmented } from '../components/ui';
import type { TripForm } from '../state';

const START_OPTIONS = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '13:00'];
const END_OPTIONS = ['13:00', '14:00', '15:00', '16:00', '16:30', '17:00', '17:30', '18:00', '19:00', '20:00'];

/** 화면 ① 여행 만들기 — 지역·날짜·시간·출발지 */
export function TripScreen({
  trip,
  onChange,
  onNext,
  sampleNote,
}: {
  trip: TripForm;
  onChange: (t: TripForm) => void;
  onNext: () => void;
  sampleNote: string | null;
}) {
  const [sheet, setSheet] = useState<null | 'region' | 'origin' | 'lodging'>(null);
  const multi = trip.nights > 0;
  const timeOk = toMin(trip.endTime) - toMin(trip.startTime) >= 120;
  const ready = !!trip.region && !!trip.origin && !!trip.date && timeOk;

  return (
    <section className="screen">
      <Header step={1} title="어디로 가세요?" />
      <div className="screen-body">
        <button className="field" onClick={() => setSheet('region')}>
          <span className="field-label">지역</span>
          <span className={`field-value ${trip.region ? '' : 'placeholder'}`}>{trip.region?.name ?? '지역을 골라 주세요'}</span>
        </button>

        <div className="field" style={{ position: 'relative' }}>
          <span className="field-label">{multi ? '가는 날' : '날짜'}</span>
          <span className="field-value" aria-hidden>
            {formatKoreanDate(trip.date)}
            {multi && ` ~ ${formatKoreanDate(addDays(trip.date, trip.nights)).replace(/^\d+년 /, '')}`}
          </span>
          {/* 투명한 기본 날짜 입력을 카드 전체에 덮어, 누르면 기기의 날짜 선택기가 열림 */}
          <input
            type="date"
            value={trip.date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => e.target.value && onChange({ ...trip, date: e.target.value })}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker?.();
              } catch {
                /* 일부 브라우저는 showPicker 미지원 */
              }
            }}
            aria-label="날짜"
            style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
          />
        </div>

        <div className="card">
          <span className="field-label">여행 기간</span>
          <Segmented
            label="여행 기간"
            value={trip.nights}
            options={[
              { value: 0, label: '당일치기' },
              { value: 1, label: '1박 2일' },
              { value: 2, label: '2박 3일' },
            ]}
            onChange={(v) => onChange({ ...trip, nights: v })}
          />
        </div>

        <div className="field">
          <span className="field-label">{multi ? '하루 일정 시간 (날마다 같아요)' : '일정 시간'}</span>
          <div className="time-row field-value">
            <select value={trip.startTime} onChange={(e) => onChange({ ...trip, startTime: e.target.value })} aria-label="시작 시각">
              {START_OPTIONS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <span>–</span>
            <select value={trip.endTime} onChange={(e) => onChange({ ...trip, endTime: e.target.value })} aria-label="종료 시각">
              {END_OPTIONS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          {!timeOk && <span className="error-text">일정은 2시간 이상으로 잡아 주세요.</span>}
        </div>

        <div className="card">
          <span className="field-label">얼마나 넓게 다닐까요?</span>
          <Segmented
            label="후보를 찾을 반경"
            value={trip.radiusM}
            options={[
              { value: 2000, label: '동네 2km' },
              { value: 3000, label: '보통 3km' },
              { value: 5000, label: '넓게 5km' },
            ]}
            onChange={(v) => onChange({ ...trip, radiusM: v })}
          />
          <span className="field-sub" style={{ marginTop: 6 }}>
            지역 중심에서 이 거리 안의 장소로 코스를 짜요. 갈 곳이 적으면 자동으로 더 넓혀 찾아요.
          </span>
        </div>

        <button className="field" onClick={() => setSheet('origin')}>
          <span className="field-label">출발 장소</span>
          <span className={`field-value ${trip.origin ? '' : 'placeholder'}`}>{trip.origin?.name ?? '숙소나 집 주소'}</span>
        </button>

        {multi && (
          <div className="field lodging-field">
            <button className="field-main" onClick={() => setSheet('lodging')}>
              <span className="field-label">숙소</span>
              <span className="field-value">{trip.lodging?.name ?? '추천받기'}</span>
              <span className="field-sub">
                {trip.lodging
                  ? '이 숙소에서 묵고 다음 날 여기서 출발해요.'
                  : '지역 안에서 부모님 조건(엘리베이터·주차)에 맞는 숙소를 골라 드려요. 정한 숙소가 있으면 눌러서 찾아 주세요.'}
              </span>
            </button>
            {trip.lodging && (
              <button className="btn text small" onClick={() => onChange({ ...trip, lodging: null })}>
                추천받기로 바꾸기
              </button>
            )}
          </div>
        )}

        <label className="check-row">
          <input type="checkbox" checked={trip.returnToOrigin} onChange={(e) => onChange({ ...trip, returnToOrigin: e.target.checked })} />
          {multi ? '마지막 날 일정이 끝나면 출발 장소로 돌아와요' : '일정이 끝나면 출발 장소로 돌아와요'}
        </label>
      </div>

      <div className="actions">
        <button className="btn" disabled={!ready} onClick={onNext}>
          다음
        </button>
      </div>

      <PlaceSearchSheet
        open={sheet !== null}
        kind={sheet ?? 'region'}
        sampleNote={sampleNote}
        onClose={() => setSheet(null)}
        onPick={(v) =>
          sheet === 'region'
            ? onChange({ ...trip, region: v })
            : sheet === 'lodging'
              ? onChange({ ...trip, lodging: v })
              : onChange({ ...trip, origin: v })
        }
      />
    </section>
  );
}
