// 추천 평가 실행기 — 임베딩 모델 대신 글자 기반 가짜 벡터로 흐름만 검사
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/providers/semantic.ts', () => ({
  // '정원'·'궁' 이 들어간 정도로 2차원 벡터를 만듦
  embedTexts: async (texts: string[]) =>
    texts.map((t) => {
      const v = [t.includes('정원') || t.includes('숲') ? 1 : 0.1, t.includes('궁') ? 1 : 0.1];
      const n = Math.hypot(v[0], v[1]);
      return v.map((x) => x / n);
    }),
}));

describe('추천 평가 실행기', () => {
  it('지역 데이터와 정답으로 네 방식의 지표·리포트를 만든다', async () => {
    const { runEval, reportMarkdown } = await import('../src/evalRecommend.ts');
    const dir = mkdtempSync(join(tmpdir(), 'eval-'));
    mkdirSync(join(dir, 'data'));
    writeFileSync(
      join(dir, 'data', 'test.json'),
      JSON.stringify([
        { id: 'a', name: '서울역', catPath: '교통', overview: '기차역' },
        { id: 'b', name: '비원', catPath: '정원', overview: '숲과 연못이 있는 정원' },
        { id: 'c', name: '경복궁', catPath: '고궁', overview: '조선의 궁' },
      ]),
    );
    writeFileSync(
      join(dir, 'queries.json'),
      JSON.stringify([
        { id: 'q1', region: 'test', query: '숲 속 정원 산책', relevant: ['b'] },
        { id: 'q2', region: 'test', query: '조선 왕의 궁', relevant: ['c'] },
        { id: 'q3', region: 'none', query: '없는 지역', relevant: ['x'] },
      ]),
    );
    const r = await runEval(dir);
    expect(r.queries).toBe(2);
    expect(r.mean.embedding.rr).toBe(1);
    expect(r.perQuery[0].top5.embedding[0]).toBe('비원 ✓');
    const md = reportMarkdown(r, '2026-11-26');
    expect(md).toContain('| 문장 임베딩 |');
    expect(md).toContain('### 숲 속 정원 산책');
    expect(readFileSync(join(dir, 'queries.json'), 'utf8')).toContain('q1');
  });
});
