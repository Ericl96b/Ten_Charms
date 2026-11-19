// The tower art against the approved references in private/mockups/tower/svg (TOWER_SPEC.md §0.6, §6): each piece is
// drawn by the game's own code and by the reference, in the same browser, and compared pixel by pixel. Skipped where
// private/ isn't on the machine, like the spec comparison test. Side-by-side images go to private/qa-screenshots/tower/art.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { crossroadsScene, cageArt, referenceStrip, svgDoc, wholeTower, type TowerKit } from '../../src/ui/tower/art.ts';
import { expect, test } from './helpers.ts';

const REF = 'private/mockups/tower/svg';
const OUT = 'private/qa-screenshots/tower/art';
/** The same per-channel tolerance the image comparison uses. */
const TOLERANCE = 8;
const MIN_MATCH = 0.97;

test('tower: the tower art matches the approved references', async ({ page }, info) => {
  test.skip(!existsSync(REF), 'private/ is not on this machine');
  const kit = JSON.parse(readFileSync('public/art/tower-kit.json', 'utf8')) as TowerKit;
  const strip = referenceStrip(kit);
  const whole = wholeTower(kit);
  const scene = crossroadsScene(kit);
  const cage = cageArt(kit);
  const pieces: [string, string, string, number, number][] = [
    ['floors 35 to 41', svgDoc(kit, '-136 -10 272 690', strip.svg, 300, 759), 'tower-floors-35-41', 300, 759],
    ['the whole tower', svgDoc(kit, whole.viewBox, whole.svg, 340, 1086), 'tower-whole', 340, 1086],
    ['the Crossroads', svgDoc(kit, scene.viewBox, scene.svg, 390, 730), 'crossroads-scene', 390, 730],
    ['the birdcage', svgDoc(kit, cage.viewBox, cage.svg, 300, 450), 'birdcage', 300, 450],
  ];
  mkdirSync(OUT, { recursive: true });
  for (const [name, mine, ref, w, h] of pieces) {
    const theirs = readFileSync(`${REF}/${ref}.svg`, 'utf8').replace(/<svg([^>]*?) width="[^"]+" height="[^"]+"/, `<svg$1 width="${w}" height="${h}"`);
    const shot = async (svg: string) => {
      await page.setViewportSize({ width: w, height: h });
      await page.setContent(`<html><body style="margin:0;background:#FFFFFF">${svg}</body></html>`);
      return page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
    };
    const a = await shot(mine);
    const b = await shot(theirs);
    writeFileSync(`${OUT}/${ref}-game-${info.project.name}.png`, a);
    writeFileSync(`${OUT}/${ref}-reference-${info.project.name}.png`, b);
    const [x, y] = await Promise.all([sharp(a).raw().toBuffer({ resolveWithObject: true }), sharp(b).raw().toBuffer({ resolveWithObject: true })]);
    expect(x.info.width).toBe(y.info.width);
    const ch = x.info.channels;
    let close = 0;
    const n = x.data.length / ch;
    for (let i = 0; i < x.data.length; i += ch) {
      if (Math.abs(x.data[i] - y.data[i]) <= TOLERANCE && Math.abs(x.data[i + 1] - y.data[i + 1]) <= TOLERANCE && Math.abs(x.data[i + 2] - y.data[i + 2]) <= TOLERANCE) close++;
    }
    console.log(`[art ${info.project.name}] ${name}: ${((100 * close) / n).toFixed(2)}% of pixels match`);
    expect(close / n, name).toBeGreaterThanOrEqual(MIN_MATCH);
  }
});
