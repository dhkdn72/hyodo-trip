import { useEffect, type ReactNode } from 'react';
import { accessBadges, type Place } from '@hyodo/core';
import { FLOW } from '../state';

const CIRCLED = ['①', '②', '③', '④', '⑤'];

/** 화면 머리: 뒤로가기 · ① / ⑤ · 제목 · 진행 막대 */
export function Header({
  step,
  title,
  subtitle,
  onBack,
}: {
  step: 1 | 2 | 3 | 4 | 5;
  title: string;
  subtitle?: string;
  onBack?: () => void;
}) {
  const steps = FLOW === 'mvp' ? [1, 2, 4] : [1, 2, 3, 4, 5];
  const pos = steps.indexOf(step);
  return (
    <header>
      <div className="head-top">
        {onBack ? (
          <button className="back" onClick={onBack} aria-label="이전 화면">
            ‹ 이전
          </button>
        ) : (
          <span />
        )}
        <span className="step-count" aria-label={`${steps.length}단계 중 ${pos + 1}단계`}>
          {CIRCLED[step - 1]} / {CIRCLED[steps[steps.length - 1] - 1]}
        </span>
      </div>
      <h1 className="title">{title}</h1>
      {subtitle && <p className="subtitle">{subtitle}</p>}
      <div className="progress" aria-hidden>
        {steps.map((s, i) => (
          <span key={s} className={i <= pos ? 'on' : ''} />
        ))}
      </div>
    </header>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** bare: 감싸는 div 없이 칩만 (다른 칩과 한 줄에 이어 붙일 때) */
export function Chips({
  options,
  selected,
  onToggle,
  label,
  bare,
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
  label: string;
  bare?: boolean;
}) {
  const chips = options.map((o) => (
    <button key={o} type="button" className="chip" aria-pressed={selected.includes(o)} onClick={() => onToggle(o)}>
      {o}
    </button>
  ));
  if (bare) return <>{chips}</>;
  return (
    <div className="chips" role="group" aria-label={label}>
      {chips}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** F3 무장애 배지. 데이터가 없으면 '정보 없음' */
export function AccessBadges({ place }: { place: Place }) {
  const list = accessBadges(place);
  const sample = place.access?.source === 'sample' && place.access.known;
  return (
    <div className="badges">
      {list.map((b) => (
        <span key={b.label} className={`badge ${b.status === 'unknown' ? 'unknown' : ''}`}>
          {b.label}
        </span>
      ))}
      {sample && <span className="badge sample">예시</span>}
    </div>
  );
}

export function Toast({ text, onDone }: { text: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [text, onDone]);
  if (!text) return null;
  return (
    <div className="toast" role="status">
      {text}
    </div>
  );
}
