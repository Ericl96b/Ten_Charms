// Joins the long parity group measurement (Change Request 04 §6) from every test size into one table.
// Report only: the sizes never fail anything. It fails only when a size's results are missing, which means the
// measurement didn't run. Usage: node scripts/parity-report.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'test-results/parity-groups';
const PROJECTS = ['se', 'ref', 'max', 'android'];
const CASES = [['humanOdds', 'Human Odds'], ['humanEvens', 'Human Evens'], ['lunariaOdds', 'Lunaria Odds (crown)']];

const missing = PROJECTS.filter((p) => !existsSync(`${DIR}/${p}.json`));
if (missing.length) {
  console.error(`No parity group measurement for: ${missing.join(', ')}`);
  process.exit(1);
}

const cell = (c) => `${c.largestFullyShown ?? 'none from 8'}${c.largerGroup ? `, then ${c.largerGroup}` : ''}`;
const lines = [
  '# Long parity groups on a fogged Glade table',
  '',
  'Largest group, from 8 to 20 cards, with every card fully inside the laid-down area, and what a larger group does.',
  '',
  `| Viewport | ${CASES.map(([, label]) => label).join(' | ')} |`,
  `|---|${CASES.map(() => '---').join('|')}|`,
];
for (const p of PROJECTS) {
  const r = JSON.parse(readFileSync(`${DIR}/${p}.json`, 'utf8'));
  lines.push(`| ${p} (${r.viewport.width}×${r.viewport.height}) | ${CASES.map(([key]) => cell(r.cases[key])).join(' | ')} |`);
}
lines.push('', 'Crown border fully inside, Lunaria Odds:', '');
for (const p of PROJECTS) {
  const r = JSON.parse(readFileSync(`${DIR}/${p}.json`, 'utf8'));
  lines.push(`- ${p}: up to ${r.cases.lunariaOdds.crownBorderFitsUpTo ?? 'none from 8'} cards`);
}
writeFileSync('test-results/parity-groups.md', lines.join('\n') + '\n');
console.log(lines.join('\n'));
