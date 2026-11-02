// Timing breakdown from Playwright JSON reports, as the median across runs.
// Usage: node scripts/test-timing.ts <run1.json> [run2.json ...]
import { readFileSync } from 'node:fs';

type Spec = { title: string; tests: { projectName: string; results: { duration: number }[] }[] };
type Suite = { file?: string; specs?: Spec[]; suites?: Suite[] };
type Report = { suites: Suite[]; stats: { duration: number } };
type Row = { file: string; title: string; project: string; ms: number };

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const minutes = (ms: number): string => (ms / 60000).toFixed(1);

function rows(report: Report): Row[] {
  const out: Row[] = [];
  const walk = (suite: Suite, file: string): void => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests) out.push({ file, title: spec.title, project: t.projectName, ms: t.results.reduce((sum, r) => sum + r.duration, 0) });
    }
    for (const child of suite.suites ?? []) walk(child, file);
  };
  for (const top of report.suites) walk(top, top.file ?? '');
  return out;
}

const reports = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')) as Report);
const runs = reports.map(rows);

function grouped(name: (r: Row) => string): [string, number][] {
  const totals = new Map<string, number[]>();
  runs.forEach((run, i) => {
    for (const r of run) {
      const list = totals.get(name(r)) ?? runs.map(() => 0);
      list[i] += r.ms;
      totals.set(name(r), list);
    }
  });
  return [...totals].map(([k, v]): [string, number] => [k, median(v)]).sort((a, b) => b[1] - a[1]);
}

console.log(`Wall clock: ${reports.map((r) => minutes(r.stats.duration)).join(', ')} min; median ${minutes(median(reports.map((r) => r.stats.duration)))} min\n`);
console.log('| Project | Minutes |\n|---|---|');
for (const [k, v] of grouped((r) => r.project)) console.log(`| ${k} | ${minutes(v)} |`);
console.log('\n| File | Minutes |\n|---|---|');
for (const [k, v] of grouped((r) => r.file)) console.log(`| ${k} | ${minutes(v)} |`);
console.log('\n| Slowest tests | Project | Seconds |\n|---|---|---|');
for (const [k, v] of grouped((r) => `${r.title}\t${r.project}`).slice(0, 20)) {
  const [title, project] = k.split('\t');
  console.log(`| ${title} | ${project} | ${(v / 1000).toFixed(0)} |`);
}
