import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import sharp from 'sharp';
// @ts-expect-error plain script module
import { buildPortraits } from '../../scripts/portraits.mjs';
// @ts-expect-error plain script module
import { removeCream } from '../../scripts/remove-cream.mjs';
import { LINES } from '../../src/content.ts';

const square = (color: string) => sharp({ create: { width: 64, height: 64, channels: 4, background: color } }).png().toBuffer();

describe('portrait pipeline', () => {
  test('correctly named files become web versions; a missing folder or a bad file breaks nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-portraits-'));
    try {
      const src = join(dir, 'in');
      const out = join(dir, 'out');
      assert.deepEqual(await buildPortraits(src, out), []);
      await sharp(await square('#c9b4e6')).toFile(join(dir, 'x.png'));
      const { mkdirSync } = await import('node:fs');
      mkdirSync(src);
      writeFileSync(join(src, 'pip-neutral.png'), await square('#c9b4e6'));
      writeFileSync(join(src, 'nightshade-intense.png'), await square('#3a1640'));
      writeFileSync(join(src, 'wrong-name.png'), await square('#000000'));
      writeFileSync(join(src, 'hoot-happy.png'), 'not an image');
      assert.deepEqual(await buildPortraits(src, out), ['nightshade-intense', 'pip-neutral']);
      for (const name of ['pip-neutral-256.webp', 'pip-neutral-512.webp', 'nightshade-intense-512.webp']) assert.ok(existsSync(join(out, name)), name);
      const meta = await sharp(join(out, 'pip-neutral-512.webp')).metadata();
      assert.equal(meta.width, 512);
    } finally {
      sharp.cache(false);
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Windows may hold the temp files a little longer */ }
    }
  });

  test('the cream remover clears the background but keeps cream inside the character', async () => {
    const base = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#FFF8F4' } })
      .composite([{ input: await sharp({ create: { width: 14, height: 14, channels: 3, background: '#5B2340' } }).png().toBuffer(), left: 8, top: 8 },
        { input: await sharp({ create: { width: 4, height: 4, channels: 3, background: '#FFF8F4' } }).png().toBuffer(), left: 13, top: 13 }])
      .png().toBuffer();
    const { data, info } = await sharp(await removeCream(base)).raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    assert.equal(alpha(1, 1), 0);
    assert.equal(alpha(10, 10), 255);
    assert.equal(alpha(15, 15), 255);
  });
});

describe('dialogue', () => {
  test('uses the exact lines, and the right number for each bot', () => {
    assert.equal(Object.keys(LINES.pip).length, 6);
    assert.equal(Object.keys(LINES.marigold).length, 6);
    assert.equal(Object.keys(LINES.briar).length, 6);
    assert.equal(Object.keys(LINES.hoot).length, 6);
    assert.equal(Object.keys(LINES.nightshade).length, 8);
    const spec = readFileSync('SPEC.md', 'utf8');
    for (const bot of Object.values(LINES)) for (const line of Object.values(bot)) assert.ok(spec.includes(`"${line}"`), line);
  });
});

function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('accessibility and size', () => {
  test('text and background pairs meet WCAG AA', () => {
    const pairs: [string, string][] = [
      ['#4A1D35', '#FCEFE9'], ['#6B3350', '#FFF8F4'], ['#6B3350', '#F6D2D8'], ['#5B2340', '#FFF8F4'], ['#FFFFFF', '#5B2340'], ['#FFFFFF', '#C7406E'],
      ['#2F5E39', '#E3F0DC'], ['#B8325C', '#FFFAF5'], ['#3C7449', '#FFFAF5'], ['#3B5BA0', '#FFFAF5'], ['#94600C', '#FFFAF5'], ['#5E430F', '#FBE2A0'],
      ['#6B4A0D', '#FFF8E8'], ['#5B2340', '#F6D27F'], ['#F5B8C8', '#3A1640'], ['#F6D27F', '#3A1640'], ['#F5DDE6', '#3A1640'], ['#FFF4F7', '#5B2340'],
      ['#A32C57', '#FDECEF'], ['#254B2E', '#E3F0DC'],
    ];
    for (const [fg, bg] of pairs) assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg}: ${contrast(fg, bg).toFixed(2)}`);
  });

  test('the production build stays inside the size budgets', () => {
    if (!existsSync('dist')) return;
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const files = walk('dist');
    const total = files.reduce((n, f) => n + statSync(f).size, 0);
    const core = files.filter((f) => !/[\\/](audio|portraits)[\\/]/.test(f)).reduce((n, f) => n + statSync(f).size, 0);
    assert.ok(total < 15 * 1024 * 1024);
    assert.ok(core < 3 * 1024 * 1024);
  });
});
