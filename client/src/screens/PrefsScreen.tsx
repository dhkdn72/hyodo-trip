import { PREF_OPTIONS, type PrefInput } from '@hyodo/core';
import { Chips, Header } from '../components/ui';

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** 화면 ③ 취향 설문 — F4 맞춤 추천 (건너뛸 수 있음) */
export function PrefsScreen({
  prefs,
  onChange,
  onBack,
  onMake,
  onSkip,
}: {
  prefs: PrefInput;
  onChange: (p: PrefInput) => void;
  onBack: () => void;
  onMake: () => void;
  onSkip: () => void;
}) {
  return (
    <section className="screen">
      <Header step={3} title="부모님 취향은요?" subtitle="여러 개 골라도 돼요" onBack={onBack} />
      <div className="screen-body">
        <div className="card">
          <span className="field-label">음식</span>
          <Chips label="음식" options={PREF_OPTIONS.foods} selected={prefs.foods} onToggle={(v) => onChange({ ...prefs, foods: toggle(prefs.foods, v) })} />
        </div>
        <div className="card">
          <span className="field-label">관심사</span>
          <Chips
            label="관심사"
            options={PREF_OPTIONS.interests}
            selected={prefs.interests}
            onToggle={(v) => onChange({ ...prefs, interests: toggle(prefs.interests, v) })}
          />
        </div>
        <div className="card">
          <span className="field-label">하고 싶은 것</span>
          <Chips
            label="하고 싶은 것"
            options={PREF_OPTIONS.activities}
            selected={prefs.activities}
            onToggle={(v) => onChange({ ...prefs, activities: toggle(prefs.activities, v) })}
          />
        </div>
        <div className="card">
          <label className="field-label" htmlFor="free">
            그 밖에 알려 주실 것 (선택)
          </label>
          <textarea
            id="free"
            className="free"
            maxLength={300}
            placeholder="예: 시끄러운 곳은 싫어하세요 / 매운 음식은 못 드세요"
            value={prefs.freeText ?? ''}
            onChange={(e) => onChange({ ...prefs, freeText: e.target.value })}
          />
        </div>
      </div>
      <div className="actions">
        <button className="btn" onClick={onMake}>
          일정 만들기
        </button>
        <button className="btn outline" onClick={onSkip}>
          건너뛰기
        </button>
      </div>
    </section>
  );
}
