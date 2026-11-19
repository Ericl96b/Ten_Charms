// Short clips of the Tower's moments, for the person reviewing the feel (TOWER_SPEC.md §15.7). One size is enough.
// They go to private/qa-screenshots/tower, beside the rest of the QA material.
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers.ts';

const DIR = 'private/qa-screenshots/tower';
test.use({ video: { mode: 'on', size: { width: 440, height: 956 } } });

async function save(page: Page, name: string): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  const video = page.video()!;
  await page.close();
  await video.saveAs(`${DIR}/recording-${name}.webm`);
}

const DONE = {
  campaign: { won: [true, true, true, true, true], stars: [3, 3, 3, 3, 3], bestRounds: [9, 9, 9, 9, 9] },
  glade: { winOrder: ['g1', 'a1', 'b1', 'a2', 'b2', 'g2', 'g3'], stars: { g1: 3, a1: 3, b1: 3, a2: 3, b2: 3, g2: 3, g3: 3 }, bestRounds: {}, fogLifted: true, revealSeen: true, liftScenePending: false, lastMap: 'crossroads' },
};

async function launch(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((s) => {
    if (!localStorage.getItem('ten-charms.save')) localStorage.setItem('ten-charms.save', JSON.stringify(s));
  }, { schema: 2, install: { dismissedAt: Date.now() }, tutorial: { done: true, seen: [] }, backupPrompted: true, ...DONE, tower: { revealSeen: true }, ...extra });
  await page.goto('/');
  await page.waitForFunction(() => '__TC__' in window);
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
}

const tc = (page: Page, fn: string) => page.evaluate(`(() => { const t = window.__TC__; return ${fn}; })()`);

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'max', 'recorded at the largest iPhone size only');
});

test('recording: tower: the Crossroads reveal', async ({ page }) => {
  await launch(page, { glade: { ...DONE.glade, lastMap: 'glade' }, tower: { revealSeen: false } });
  await expect(page.locator('[data-testid="xr-reveal-banner"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForSelector('[data-map="crossroads"]', { timeout: 15_000 });
  await page.waitForTimeout(2200);
  await save(page, 'reveal');
});

test('recording: tower: the deal', async ({ page }) => {
  await launch(page);
  await tc(page, 't.towerSet({ floor: 37, hearts: 1, best: 142, seed: "ab".repeat(16) })');
  await tc(page, 't.towerHome()');
  await page.waitForSelector('[data-screen="tower"].ready');
  await page.waitForTimeout(1200);
  await page.locator('[data-testid="tower-play"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.ph-card.up').length === 3, null, { timeout: 10_000 });
  await page.waitForTimeout(1200);
  await save(page, 'deal');
});

test('recording: tower: the ascent', async ({ page }) => {
  await launch(page);
  await tc(page, 't.towerSet({ floor: 36, hearts: 2 })');
  await page.waitForTimeout(500);
  await tc(page, 't.climbScene(36, 37)');
  await page.waitForTimeout(800);
  await save(page, 'ascent');
});

test('recording: tower: the tier change', async ({ page }) => {
  await launch(page);
  await tc(page, 't.towerSet({ floor: 40, hearts: 2 })');
  await page.waitForTimeout(500);
  await tc(page, 't.climbScene(40, 41)');
  await page.waitForTimeout(800);
  await save(page, 'tier-change');
});

test('recording: tower: a heart cracks, and a heart refills', async ({ page }) => {
  await launch(page);
  await tc(page, 't.setTestScale(0.3)');
  for (const [floor, hearts, won] of [[14, 3, false], [20, 2, true]] as const) {
    await tc(page, `(() => { const s = t.getSave(); s.match = null; t.loadSave(s); t.towerSet({ floor: ${floor}, hearts: ${hearts}, seed: "${floor}".padEnd(32, "e") }); return t.towerHome(); })()`);
    await page.waitForSelector('[data-screen="tower"].ready');
    await page.locator('[data-testid="tower-play"]').click();
    await page.waitForSelector('[data-testid="begin-floor"]');
    await page.locator('[data-testid="begin-floor"]').click();
    await page.waitForSelector('[data-screen="table"]');
    await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 20_000 });
    await page.waitForFunction(() => (window as any).__TC__.idle(), null, { timeout: 60_000 });
    await tc(page, 't.setTestScale(1)');
    await tc(page, `t.forceFloor(${won})`);
    await page.waitForSelector('[data-testid="floor-result"]');
    await page.waitForTimeout(2200);
    await tc(page, 't.setTestScale(0.3)');
  }
  await save(page, 'hearts');
});

test('recording: tower: the run-over sequence', async ({ page }) => {
  await launch(page);
  await tc(page, 't.runOver({ floor: 43, oldBest: 38, newBest: true, run: { floorsCleared: 42, phasesCompleted: 131, guardiansBeaten: 4 } })');
  await page.waitForSelector('[data-screen="runover"].burst', { timeout: 15_000 });
  await page.waitForTimeout(2500);
  await save(page, 'run-over');
});
