// Quick ladder check while tuning: node scripts/ladder.ts [matches]
import { headToHead } from '../src/sim/driver.ts';

const n = Number(process.argv[2] ?? 400);
const t0 = Date.now();
for (const [a, b, goal] of [['marigold', 'pip', 60], ['briar', 'marigold', 55], ['hoot', 'briar', 55], ['nightshade', 'hoot', 60]] as const) {
  const r = headToHead(a, b, n, 7);
  console.log(`${a} vs ${b}: ${(r.rate * 100).toFixed(1)}% (goal ${goal}%), ${r.rounds.toFixed(1)} rounds`);
}
console.log(`${Date.now() - t0} ms`);
