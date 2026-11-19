// Fails if Dev Mode's secret word shows up in any test report, log or capture record (Change Request 05 §1.1).
// The word is never printed: a hit names only the file.
// Usage: node scripts/word-scan.mjs [folders...]   (default: test-results and qa-screenshots/cr05)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MISSING, devWord } from './dev-word.ts';

const word = devWord();
if (!word) {
  console.error(MISSING);
  process.exit(1);
}
const needle = word.toLowerCase();
const folders = process.argv.slice(2).length ? process.argv.slice(2) : ['test-results', 'qa-screenshots/cr05'];
/** The simulation caches hold only numbers, and are large. */
const SKIP = new Set([join('test-results', 'sim-cache')]);
const TEXT = /\.(json|log|txt|md|html|xml|csv|js|ts|mjs)$/i;

function walk(dir) {
  if (SKIP.has(dir) || !existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let scanned = 0;
const hits = [];
for (const file of folders.flatMap(walk)) {
  if (file.toLowerCase().includes(needle)) { hits.push(`${file} (its name)`); continue; }
  if (!TEXT.test(file)) continue;
  scanned++;
  if (readFileSync(file).toString('latin1').toLowerCase().includes(needle)) hits.push(file);
}
if (hits.length) {
  console.error(`The secret word appears in ${hits.length} file(s):\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`The secret word appears in none of ${scanned} report files.`);
