// The gate: the full suite, with nothing left out. Required before every commit that completes a change.
// Usage: node scripts/gate.mjs [--no-cache]. TC_WORKERS sets the workers for the parallel stage.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DEFAULT_WORKERS } from '../tests/e2e/stages.ts';
import { clearLogs } from '../tests/e2e/global-setup.ts';

const OUT = 'test-results/gate';
const PLAYWRIGHT = 'node_modules/@playwright/test/cli.js';
const STAGES = ['parallel', 'serial', 'alone', 'last'];
const noCache = process.argv.includes('--no-cache');
const results = [];

function step(name, args, env = {}) {
  const start = Date.now();
  const res = spawnSync(process.execPath, args, { env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 28 });
  const seconds = (Date.now() - start) / 1000;
  writeFileSync(`${OUT}/${name}.log`, `${res.stdout ?? ''}\n${res.stderr ?? ''}`);
  results.push({ name, seconds, ok: res.status === 0 });
  console.log(`${res.status === 0 ? 'ok    ' : 'FAILED'} ${name} (${seconds.toFixed(0)} s)`);
  return res.status === 0;
}

if (!existsSync('qa-screenshots/cr01/baseline')) {
  console.error('No image baseline on this machine. Capture one with: npm run visual:baseline');
  process.exit(2);
}

const started = Date.now();
rmSync(OUT, { recursive: true, force: true });
// A leftover capture would hide a test that stopped capturing.
rmSync('qa-screenshots/cr01/current', { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
clearLogs();

const prepared = step('build', ['scripts/build.mjs'])
  && step('build-dev', ['scripts/build.mjs', '--dev'])
  && step('typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']);
if (!prepared) process.exit(1);

step('unit', ['--test', 'tests/unit/**/*.test.ts']);
step('simulation', ['scripts/simulate.ts', ...(noCache ? ['--no-cache'] : [])]);

console.log(`Parallel stage: ${process.env.TC_WORKERS ?? DEFAULT_WORKERS} workers`);
for (const stage of STAGES) {
  step(`browser-${stage}`, [PLAYWRIGHT, 'test', '--reporter=list,json', `--output=${OUT}/${stage}`], {
    TC_STAGE: stage,
    PLAYWRIGHT_JSON_OUTPUT_NAME: `${OUT}/${stage}.json`,
  });
}

// Each stage overwrites Playwright's record of what failed, so join them up for npm run test:failed.
const failedTests = STAGES.flatMap((stage) => {
  const file = `${OUT}/${stage}/.last-run.json`;
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).failedTests ?? [] : [];
});
mkdirSync('test-results/artifacts', { recursive: true });
writeFileSync('test-results/artifacts/.last-run.json', JSON.stringify({ status: failedTests.length ? 'failed' : 'passed', failedTests }));

const rows = readdirSync('test-results').filter((f) => /^rows-\d+\.log$/.test(f)).map((f) => readFileSync(`test-results/${f}`, 'utf8'));
writeFileSync('test-results/rows.log', rows.join(''));

step('images', ['scripts/compare-shots.mjs']);
step('inventory', ['scripts/test-inventory.ts', 'check', ...STAGES.map((stage) => `${OUT}/${stage}.json`)]);

const failed = results.filter((r) => !r.ok);
const summary = [
  ...results.map((r) => `${r.name} ${r.seconds.toFixed(0)} s ${r.ok ? 'ok' : 'FAILED'}`),
  `total ${((Date.now() - started) / 60000).toFixed(1)} min`,
  failed.length ? `GATE FAILED: ${failed.map((r) => r.name).join(', ')}` : 'GATE PASSED',
].join('\n');
writeFileSync(`${OUT}/summary.txt`, summary + '\n');
console.log(`\n${summary}`);
process.exit(failed.length ? 1 : 0);
