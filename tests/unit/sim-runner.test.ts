import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

function tempDir(): string {
  mkdirSync('test-results', { recursive: true });
  return mkdtempSync('test-results/sim-');
}

function simulate(dir: string, workers: number): string {
  const out = join(dir, `report-${workers}.md`);
  const res = spawnSync(process.execPath, ['scripts/simulate.ts', '60', '60', `--workers=${workers}`, `--out=${out}`, '--no-cache'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return readFileSync(out, 'utf8');
}

test('the simulation report is identical with 1 worker and with several', () => {
  const dir = tempDir();
  try {
    const one = simulate(dir, 1);
    assert.match(one, /Total: \d+ matches, 0 problems/);
    assert.equal(simulate(dir, 2), one);
    assert.equal(simulate(dir, 5), one);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a cached result is reused only until something that affects it changes', () => {
  // Works on a copy of the code, so the real bots and engine stay untouched.
  const dir = tempDir();
  try {
    cpSync('src', join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'scripts'));
    for (const f of ['simulate.ts', 'sim-worker.ts']) cpSync(join('scripts', f), join(dir, 'scripts', f));
    const out = join(dir, 'report.md');
    const run = (...extra: string[]): string => {
      const res = spawnSync(process.execPath, [join(dir, 'scripts/simulate.ts'), '4', '4', `--out=${out}`, `--cache-dir=${join(dir, 'cache')}`, '--workers=2', ...extra], { encoding: 'utf8' });
      assert.equal(res.status, 0, res.stderr);
      return res.stdout;
    };
    const edit = (file: string, from: RegExp, to: string): void => {
      const path = join(dir, file);
      const before = readFileSync(path, 'utf8');
      assert.match(before, from);
      writeFileSync(path, before.replace(from, to));
    };

    assert.doesNotMatch(run(), /Cache hit/);
    const first = readFileSync(out, 'utf8');
    rmSync(out);
    assert.match(run(), /Cache hit/);
    assert.equal(readFileSync(out, 'utf8'), first);

    // A bot profile constant.
    edit('src/bots/profiles.ts', /const HOOT_APPEAL = [\d.]+;/, 'const HOOT_APPEAL = 9.9;');
    assert.doesNotMatch(run(), /Cache hit/);
    assert.match(run(), /Cache hit/);

    // The rules engine.
    edit('src/engine/game.ts', /^/, '// changed\n');
    assert.doesNotMatch(run(), /Cache hit/);

    // The lineup, the seeds and the sample size.
    edit('scripts/simulate.ts', /\['marigold', 'pip', 60\]/, "['pip', 'marigold', 60]");
    assert.doesNotMatch(run(), /Cache hit/);
    edit('scripts/simulate.ts', /'600d'\.repeat\(8\)/, "'600e'.repeat(8)");
    assert.doesNotMatch(run(), /Cache hit/);
    const res = spawnSync(process.execPath, [join(dir, 'scripts/simulate.ts'), '8', '4', `--out=${out}`, `--cache-dir=${join(dir, 'cache')}`, '--workers=2'], { encoding: 'utf8' });
    assert.doesNotMatch(res.stdout, /Cache hit/);

    // Turning the cache off always runs.
    assert.doesNotMatch(run('--no-cache'), /Cache hit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a smoke run stays out of SIMULATION.md and says it is not final', () => {
  const dir = tempDir();
  const before = readFileSync('SIMULATION.md', 'utf8');
  try {
    const out = join(dir, 'smoke.md');
    const res = spawnSync(process.execPath, ['scripts/simulate.ts', '--smoke', `--out=${out}`, '--workers=2'], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(existsSync(out));
    assert.match(readFileSync(out, 'utf8'), /not final numbers/);
    assert.equal(readFileSync('SIMULATION.md', 'utf8'), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
