// Short clips of the Moonlit Glade's big moments, for the person reviewing the feel. One size is enough.
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, tap, test } from './helpers.ts';

test.use({ video: { mode: 'on', size: { width: 440, height: 956 } } });

async function save(page: Page, name: string): Promise<void> {
  mkdirSync('qa-screenshots/map2', { recursive: true });
  const video = page.video()!;
  await page.close();
  await video.saveAs(`qa-screenshots/map2/recording-${name}.webm`);
}

/** Opens the app on a save, as a real launch would, so the scenes that play on launch play here too. */
async function launch(page: Page, save: Record<string, unknown>): Promise<void> {
  await page.addInitScript((s) => {
    if (!localStorage.getItem('ten-charms.save')) localStorage.setItem('ten-charms.save', JSON.stringify(s));
  }, { install: { dismissedAt: Date.now() }, tutorial: { done: true, seen: [] }, backupPrompted: true, ...save });
  await page.goto('/');
  await page.waitForFunction(() => '__TC__' in window);
}

const MAP1_DONE = { campaign: { won: [true, true, true, true, true], stars: [3, 3, 3, 3, 3], bestRounds: [9, 9, 9, 9, 9] } };

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'max', 'recorded at the largest iPhone size only');
});

test('recording: the path appears beyond the garden', async ({ page }) => {
  await launch(page, { schema: 1, ...MAP1_DONE });
  await expect(page.locator('[data-testid="reveal-banner"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForSelector('[data-map="glade"]', { timeout: 15_000 });
  await page.waitForTimeout(2000);
  await save(page, 'reveal');
});

test("recording: Lunaria's entrance", async ({ page }) => {
  await launch(page, { schema: 2, ...MAP1_DONE, glade: { winOrder: ['g1', 'a1', 'a2', 'g2'], stars: {}, revealSeen: true, lastMap: 'glade' } });
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await tap(page, '[data-testid="glade-g3"] .stop-btn');
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 20_000 });
  await page.waitForTimeout(1500);
  await save(page, 'boss-intro');
});

test('recording: the fog lifts', async ({ page }) => {
  await launch(page, { schema: 2, ...MAP1_DONE, glade: { winOrder: ['g1', 'a1', 'a2', 'g2', 'g3'], stars: { g1: 3, a1: 2, a2: 2, g2: 1, g3: 1 }, revealSeen: true, lastMap: 'glade', fogLifted: true, liftScenePending: true } });
  await expect(page.locator('[data-testid="lift-banner"]')).toBeVisible({ timeout: 20_000 });
  await page.waitForSelector('.fog', { state: 'detached', timeout: 15_000 });
  await page.waitForTimeout(1500);
  await save(page, 'fog-lift');
});
