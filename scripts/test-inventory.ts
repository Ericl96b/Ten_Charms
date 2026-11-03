// The coverage guarantee: every browser test that must exist, and every test that may be skipped.
// Usage: node scripts/test-inventory.ts check [report.json ...]
//        node scripts/test-inventory.ts write <report.json> [more reports from the same run]
// With reports, also checks that each test really ran, with no new skips, failures or retries.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MAP2_FILES, timingOf } from '../tests/e2e/stages.ts';

/** `timing` says whether a Map 2 test runs on a fast clock or in real time; every Map 2 test must have one. */
export type Row = { file: string; title: string; project: string; skipped: boolean; timing?: 'real' | 'fast' };
export type Ran = { file: string; title: string; project: string; status: string; attempts: number };

type Suite = {
  title?: string;
  file?: string;
  specs?: { title: string; tests: { projectName: string; status?: string; results?: unknown[] }[] }[];
  suites?: Suite[];
};
export type Report = { suites?: Suite[] };

const INVENTORY = 'tests/inventory.json';

/** Flattens a Playwright JSON report. Titles include their describe blocks, because a spec's own title can repeat. */
export function flatten(report: Report): Ran[] {
  const out: Ran[] = [];
  const walk = (suite: Suite, file: string, path: string[]): void => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests) {
        out.push({ file, title: [...path, spec.title].join(' › '), project: t.projectName, status: t.status ?? 'listed', attempts: t.results?.length ?? 0 });
      }
    }
    for (const child of suite.suites ?? []) walk(child, file, [...path, child.title ?? '']);
  };
  for (const top of report.suites ?? []) walk(top, top.file ?? top.title ?? '', []);
  return out;
}

const key = (r: { file: string; title: string; project: string }): string => `${r.project} | ${r.file} | ${r.title}`;

/** Finds tests that went missing, and Map 2 tests with no timing class. New tests are fine. */
export function compareList(inventory: Row[], listed: Ran[]): string[] {
  const seen = new Set(listed.map(key));
  return [
    ...inventory.filter((r) => !seen.has(key(r))).map((r) => `removed: ${key(r)}`),
    ...inventory.filter((r) => MAP2_FILES.test(r.file) && !r.timing).map((r) => `no timing class: ${key(r)}`),
  ];
}

/** Finds any inventory test that didn't run as it should, across the reports of all the stages of one run. */
export function compareRun(inventory: Row[], ran: Ran[]): string[] {
  const problems: string[] = [];
  const known = new Map(inventory.map((r) => [key(r), r]));
  const counts = new Map<string, number>();
  for (const r of ran) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  for (const r of inventory) {
    const times = counts.get(key(r)) ?? 0;
    if (times !== 1) problems.push(`ran ${times} times: ${key(r)}`);
  }
  for (const r of ran) {
    const wanted = known.get(key(r));
    if (r.status === 'skipped') {
      if (!wanted?.skipped) problems.push(`newly skipped: ${key(r)}`);
      continue;
    }
    if (wanted?.skipped) problems.push(`should have been skipped: ${key(r)}`);
    if (r.status !== 'expected') problems.push(`${r.status}: ${key(r)}`);
    if (r.attempts > 1) problems.push(`needed a retry: ${key(r)}`);
  }
  return problems;
}

function listTests(): Ran[] {
  const res = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--list', '--reporter=json'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (res.status !== 0) throw new Error(`Listing the tests failed:\n${res.stderr}`);
  return flatten(JSON.parse(res.stdout) as Report);
}

const readReport = (file: string): Report => JSON.parse(readFileSync(file, 'utf8')) as Report;

function main(): void {
  const [command, ...files] = process.argv.slice(2);
  if (command === 'write') {
    const rows: Row[] = files.flatMap((f) => flatten(readReport(f)))
      .map((r): Row => ({ file: r.file, title: r.title, project: r.project, skipped: r.status === 'skipped', ...(MAP2_FILES.test(r.file) ? { timing: timingOf(r.title) } : {}) }))
      .sort((a, b) => key(a).localeCompare(key(b)));
    writeFileSync(INVENTORY, JSON.stringify(rows, null, 1) + '\n');
    console.log(`Wrote ${rows.length} tests, ${rows.filter((r) => r.skipped).length} skipped`);
    return;
  }
  if (command !== 'check') throw new Error('Usage: test-inventory.ts check [reports] | write <report>');
  const inventory = JSON.parse(readFileSync(INVENTORY, 'utf8')) as Row[];
  const problems = [...compareList(inventory, listTests())];
  if (files.length > 0) problems.push(...compareRun(inventory, files.flatMap((f) => flatten(readReport(f)))));
  for (const p of problems) console.log(p);
  console.log(`${inventory.length} tests in the inventory, ${problems.length} problems`);
  process.exit(problems.length > 0 ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
