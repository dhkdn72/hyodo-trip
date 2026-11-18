import type { ConditionInput } from '@hyodo/core';
import { Header, Segmented } from '../components/ui';
import { FLOW } from '../state';

/** 화면 ② 부모님 컨디션 — F1 컨디션 반영 · F3 무장애 조건 */
export function ConditionScreen({
  cond,
  onChange,
  onBack,
  onNext,
}: {
  cond: ConditionInput;
  onChange: (c: ConditionInput) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <section className="screen">
      <Header step={2} title="부모님 컨디션은요?" onBack={onBack} />
      <div className="screen-body">
        <div className="card">
          <span className="field-label">한 번에 걷기</span>
          <Segmented
            label="한 번에 걸을 수 있는 시간"
            value={cond.walkLimitMin}
            options={[15, 30, 45].map((v) => ({ value: v, label: `${v}분` }))}
            onChange={(v) => onChange({ ...cond, walkLimitMin: v })}
          />
        </div>
        <div className="card">
          <span className="field-label">쉬는 간격</span>
          <Segmented
            label="쉬는 간격"
            value={cond.restEveryMin}
            options={[60, 90, 120].map((v) => ({ value: v, label: `${v}분` }))}
            onChange={(v) => onChange({ ...cond, restEveryMin: v })}
          />
        </div>
        <div className="card">
          <span className="field-label">걷는 속도</span>
          <Segmented
            label="걷는 속도"
            value={cond.pace}
            options={[
              { value: 'slow', label: '천천히' },
              { value: 'normal', label: '보통' },
            ]}
            onChange={(v) => onChange({ ...cond, pace: v })}
          />
        </div>
        <div className="card">
          <span className="field-label">필요한 시설</span>
          <label className="check-row">
            <input
              type="checkbox"
              checked={cond.needs.stepFree}
              onChange={(e) => onChange({ ...cond, needs: { ...cond.needs, stepFree: e.target.checked } })}
            />
            엘리베이터·경사로
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={cond.needs.parking}
              onChange={(e) => onChange({ ...cond, needs: { ...cond.needs, parking: e.target.checked } })}
            />
            주차
          </label>
        </div>
        <div className="card">
          <span className="field-label">점심 시간</span>
          <Segmented
            label="점심 시간"
            value={cond.lunchTime ?? 'none'}
            options={[
              { value: '11:30', label: '11:30' },
              { value: '12:00', label: '12:00' },
              { value: '12:30', label: '12:30' },
              { value: 'none', label: '안 함' },
            ]}
            onChange={(v) => onChange({ ...cond, lunchTime: v === 'none' ? null : v })}
          />
          <span className="field-label" style={{ marginTop: 12 }}>
            저녁 시간
          </span>
          <Segmented
            label="저녁 시간"
            value={cond.dinnerTime ?? 'none'}
            options={[
              { value: 'none', label: '안 함' },
              { value: '17:30', label: '17:30' },
              { value: '18:00', label: '18:00' },
              { value: '18:30', label: '18:30' },
            ]}
            onChange={(v) => onChange({ ...cond, dinnerTime: v === 'none' ? null : v })}
          />
        </div>
      </div>
      <div className="actions">
        <button className="btn" onClick={onNext}>
          {FLOW === 'mvp' ? '일정 만들기' : '다음'}
        </button>
      </div>
    </section>
  );
}
