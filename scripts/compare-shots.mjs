// Compares qa-screenshots/cr01/current with the saved baseline. Any changed pixel outside what a change may touch fails.
// Usage: node scripts/compare-shots.mjs [allowed tags, comma separated] [other folder]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';

const ROOT = 'qa-screenshots/cr01';
const allowed = new Set((process.argv[2] ?? '').split(',').filter(Boolean));
const other = process.argv[3] ?? 'current';
/** Per-channel difference that counts as a change. Anti-aliasing can wobble by a few levels. */
const TOLERANCE = 8;

async function raw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

let failed = 0;
let compared = 0;
const baseNames = readdirSync(`${ROOT}/baseline`).filter((f) => f.endsWith('.png'));
for (const name of baseNames) {
  const a = `${ROOT}/baseline/${name}`;
  const b = `${ROOT}/${other}/${name}`;
  if (!existsSync(b)) { console.log(`MISSING  ${name}`); failed++; continue; }
  const meta = JSON.parse(readFileSync(a.replace(/\.png$/, '.json'), 'utf8'));
  if (meta.tags.some((t) => t !== 'settings-icon' && allowed.has(t))) { compared++; continue; }
  const box = allowed.has('settings-icon') && meta.icon ? {
    l: meta.icon.x * meta.scale, t: meta.icon.y * meta.scale,
    r: (meta.icon.x + meta.icon.width) * meta.scale, b: (meta.icon.y + meta.icon.height) * meta.scale,
  } : null;
  const [x, y] = await Promise.all([raw(a), raw(b)]);
  compared++;
  if (x.width !== y.width || x.height !== y.height) { console.log(`SIZE     ${name}`); failed++; continue; }
  let changed = 0, left = Infinity, top = Infinity, right = -1, bottom = -1;
  for (let py = 0; py < x.height; py++) {
    for (let px = 0; px < x.width; px++) {
      if (box && px >= box.l && px < box.r && py >= box.t && py < box.b) continue;
      const i = (py * x.width + px) * 4;
      if (Math.abs(x.data[i] - y.data[i]) > TOLERANCE || Math.abs(x.data[i + 1] - y.data[i + 1]) > TOLERANCE || Math.abs(x.data[i + 2] - y.data[i + 2]) > TOLERANCE) {
        changed++;
        if (px < left) left = px;
        if (px > right) right = px;
        if (py < top) top = py;
        if (py > bottom) bottom = py;
      }
    }
  }
  if (changed > 0) {
    console.log(`CHANGED  ${name}: ${changed} px, box ${left},${top} to ${right},${bottom}`);
    failed++;
  }
}
console.log(`${compared} screenshots compared, ${failed} with differences outside: ${[...allowed].join(', ') || 'nothing allowed'}`);
process.exit(failed ? 1 : 0);
