import { useState } from 'react';
import { PREF_OPTIONS, type PrefInput } from '@hyodo/core';
import { Chips, Header } from '../components/ui';

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

type Group = 'foods' | 'interests' | 'activities';

const GROUPS: { key: Group; label: string; etcHint: string }[] = [
  { key: 'foods', label: '음식', etcHint: '예: 순두부, 보리밥' },
  { key: 'interests', label: '관심사', etcHint: '예: 성당, 야경, 벽화마을' },
  { key: 'activities', label: '하고 싶은 것', etcHint: '예: 케이블카, 유람선' },
];

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
  // 기타 칸은 눌렀거나 이미 적은 내용이 있을 때 보여 줌
  const [open, setOpen] = useState<Record<Group, boolean>>({
    foods: !!prefs.etc?.foods,
    interests: !!prefs.etc?.interests,
    activities: !!prefs.etc?.activities,
  });
  const setEtc = (g: Group, v: string) => onChange({ ...prefs, etc: { ...prefs.etc, [g]: v } });

  return (
    <section className="screen">
      <Header step={3} title="부모님 취향은요?" subtitle="여러 개 골라도 돼요" onBack={onBack} />
      <div className="screen-body">
        {GROUPS.map(({ key, label, etcHint }) => {
          const etc = prefs.etc?.[key] ?? '';
          return (
            <div className="card" key={key}>
              <span className="field-label">{label}</span>
              <div className="chips" role="group" aria-label={label}>
                <Chips
                  label={label}
                  options={PREF_OPTIONS[key]}
                  selected={prefs[key]}
                  onToggle={(v) => onChange({ ...prefs, [key]: toggle(prefs[key], v) })}
                  bare
                />
                <button
                  type="button"
                  className="chip"
                  aria-pressed={open[key] || !!etc.trim()}
                  aria-expanded={open[key]}
                  onClick={() => {
                    if (open[key] && etc) setEtc(key, '');
                    setOpen({ ...open, [key]: !open[key] });
                  }}
                >
                  기타
                </button>
              </div>
              {open[key] && (
                <div className="etc-row">
                  <input
                    className="etc-input"
                    value={etc}
                    maxLength={60}
                    placeholder={etcHint}
                    aria-label={`${label} 기타 직접 입력`}
                    autoFocus={!etc}
                    onChange={(e) => setEtc(key, e.target.value)}
                  />
                  <span className="field-sub">쉼표로 여러 개 적을 수 있어요. 장소·메뉴 이름에 들어간 곳을 우선해요.</span>
                </div>
              )}
            </div>
          );
        })}
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
