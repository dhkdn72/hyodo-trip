// npm run eval:recommend — eval/ 의 데이터·정답으로 취향 추천 방식을 비교하고 eval/results.md 를 씁니다.
// API 키는 필요 없고, 처음 실행 때만 임베딩 모델을 내려받습니다.
import { runEval, writeReport } from '../src/evalRecommend.ts';

const r = await runEval();
const file = writeReport(r);
console.table(
  Object.fromEntries(
    Object.entries(r.mean).map(([m, x]) => [m, { 'P@5': +x.p5.toFixed(3), 'R@10': +x.r10.toFixed(3), 'nDCG@10': +x.ndcg10.toFixed(3), MRR: +x.rr.toFixed(3) }]),
  ),
);
console.log(`질의 ${r.queries}개 · 결과: ${file}`);
