// Screenshots of every new Tower screen and state at the four test sizes, for the handoff (TOWER_SPEC.md §15.7).
// Ambient motion and fog are held still, so the same state always looks the same. Saved to private/qa-screenshots/tower.
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { openApp, test } from './helpers.ts';
import { towerAt, towerSave } from './tower-helpers.ts';

const DIR = 'private/qa-screenshots/tower';
const tc = (page: Page, fn: string) => page.evaluate(`(() => { const t = window.__TC__; return ${fn}; })()`);

async function shot(page: Page, project: string, name: string): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await tc(page, 't.freezeAmbient(1200)');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/${name}-${project}.png` });
}

const reset = (page: Page) => tc(page, '(() => { const s = t.getSave(); s.match = null; t.loadSave(s); })()');

test('tower: capture: the Crossroads, Tower home in every state and sky, and the floor intro', async ({ page }, info) => {
  test.setTimeout(240_000);
  const p = info.project.name;
  await openApp(page);
  await towerSave(page, { place: 'crossroads', tower: { best: 142 } });
  await page.waitForSelector('[data-map="crossroads"].ready');
  await shot(page, p, 'crossroads');
  await towerSave(page, { lunaria: false });
  await page.waitForSelector('[data-map="garden"]');
  await shot(page, p, 'switcher-locked');
  await towerSave(page, { place: 'crossroads', tower: { best: 142 } });
  await page.waitForSelector('[data-map="crossroads"]');
  await tc(page, 't.setTestScale(0.05)');
  await towerAt(page, { climb: false, best: 0 });
  await shot(page, p, 'home-no-climb');
  await towerAt(page, { floor: 37, hearts: 1, best: 142 });
  await shot(page, p, 'home-between');
  await towerAt(page, { floor: 40, hearts: 2, best: 142 });
  await shot(page, p, 'home-guardian-next');
  for (const [floor, sky] of [[3, 'rose-dawn'], [13, 'peach-noon'], [23, 'lavender-dusk'], [33, 'starlit-pink-night'], [43, 'aurora']] as const) {
    await towerAt(page, { floor, hearts: 3, best: 60 });
    await shot(page, p, `sky-${sky}`);
  }
  await towerAt(page, { floor: 37, hearts: 1, best: 142, draw: { phases: [21, 35, 6], lineup: ['hoot', 'mallow', 'fennel'], guardian: null } });
  await page.locator('[data-testid="tower-play"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.ph-card.up').length === 3, null, { timeout: 10_000 });
  await shot(page, p, 'intro');
  await page.locator('[data-testid="begin-floor"]').click();
  await page.waitForSelector('[data-screen="table"]');
  await page.waitForFunction(() => (window as any).__TC__.idle(), null, { timeout: 60_000 });
  await shot(page, p, 'table-fogged');
  await tc(page, 't.towerHome()');
  await page.waitForSelector('[data-screen="tower"].ready');
  await shot(page, p, 'home-in-progress');
});

test('tower: capture: the Guardians, every floor result, and the run-over screen', async ({ page }, info) => {
  test.setTimeout(240_000);
  const p = info.project.name;
  await openApp(page);
  await towerSave(page, { place: 'crossroads', tower: { best: 142 } });
  await page.waitForSelector('[data-map="crossroads"]');
  for (const floor of [10, 20]) {
    await reset(page);
    await tc(page, 't.setTestScale(1)');
    await towerAt(page, { floor, hearts: 2, seed: `${floor}`.padEnd(32, 'b') });
    await page.locator('[data-testid="tower-play"]').click();
    await page.waitForSelector('[data-testid="begin-floor"]');
    await page.waitForTimeout(1800);
    await page.locator('[data-testid="begin-floor"]').click();
    await page.waitForSelector('[data-testid="guardian-kicker"]');
    await page.waitForTimeout(3300);
    await page.screenshot({ path: `${DIR}/guardian-intro-${floor === 10 ? 'nightshade' : 'lunaria'}-${p}.png` });
    await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 20_000 });
  }
  await tc(page, 't.setTestScale(0.05)');
  const rows: [string, number, number, boolean][] = [['won', 5, 3, true], ['guardian-heart-back', 10, 2, true], ['guardian-full', 20, 3, true], ['lost', 14, 3, false], ['lost-last-heart', 14, 1, false]];
  for (const [name, floor, hearts, won] of rows) {
    await reset(page);
    await towerAt(page, { floor, hearts, seed: `${floor}${hearts}`.padEnd(32, 'c') });
    await page.locator('[data-testid="tower-play"]').click();
    await page.waitForSelector('[data-testid="begin-floor"]');
    await page.locator('[data-testid="begin-floor"]').click();
    await page.waitForSelector('[data-screen="table"]');
    await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 20_000 });
    await page.waitForFunction(() => (window as any).__TC__.idle(), null, { timeout: 60_000 });
    await tc(page, `t.forceFloor(${won})`);
    await page.waitForSelector('[data-testid="floor-result"]');
    await page.waitForTimeout(400);
    await shot(page, p, `result-${name}`);
  }
  await tc(page, 't.runOver({ floor: 143, oldBest: 142, newBest: true, run: { floorsCleared: 142, phasesCompleted: 428, guardiansBeaten: 14 } })');
  await page.waitForSelector('[data-screen="runover"].burst', { timeout: 10_000 });
  await page.waitForTimeout(400);
  await shot(page, p, 'runover-new-best');
  await tc(page, 't.runOver({ floor: 21, oldBest: 60, newBest: false, run: { floorsCleared: 20, phasesCompleted: 66, guardiansBeaten: 2 } })');
  await page.waitForFunction(() => document.querySelector('[data-testid="runover-floor"]')?.textContent === 'Floor 21');
  await page.waitForTimeout(400);
  await shot(page, p, 'runover');
});
