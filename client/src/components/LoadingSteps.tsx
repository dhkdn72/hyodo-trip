import { useEffect, useState } from 'react';

const STEPS = [
  { label: '후보 수집', src: 'TourAPI' },
  { label: '접근성 필터', src: '무장애 여행 정보 API' },
  { label: '이동 시간 계산', src: '카카오 도보·자동차 길찾기' },
  { label: '순서 최적화', src: '최적화 코드' },
  { label: '쉬는 곳 채우기', src: '카카오 로컬 API' },
  { label: '설명 붙이기', src: 'LLM API' },
];

/** 서버가 하는 6단계를 보여 주는 대기 화면 (단계 진행은 시간에 따른 표시용) */
export function LoadingSteps() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, STEPS.length - 1)), 420);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="loading" aria-live="polite">
      <h2>부모님께 맞는 일정을 짜고 있어요</h2>
      <ol className="load-steps">
        {STEPS.map((s, k) => (
          <li key={s.label} className={k < i ? 'done' : k === i ? 'doing' : ''}>
            <span className="dot">{k < i ? '✓' : k + 1}</span>
            <span>
              {s.label} <small>· {s.src}</small>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
