// The Tower: a whole climb through the real UI, and a floor in progress surviving a reload (TOWER_SPEC.md §3, §15.4–5).
import type { Page } from '@playwright/test';
import { expect, openApp, tap, test } from './helpers.ts';
import { tableView, waitForResumedTable } from './swap-fixtures.ts';

/** What the table shows, with the hand in its order on screen, left to right. */
async function shownView(page: Page): Promise<Record<string, unknown>> {
  const view = await tableView(page);
  view.hand = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.hc[data-id]')]
    .map((e) => ({ id: e.getAttribute('data-id'), x: Math.round(e.getBoundingClientRect().left) }))
    .sort((a, b) => a.x - b.x).map((c) => c.id));
  return view;
}
import { beginFloor, forceFloor, openIntro, towerSave } from './tower-helpers.ts';

const save = (page: Page) => page.evaluate(() => (window as any).__TC__.getSave());

/** Plays her turns with the auto-player until the floor ends on its own, then reads the result. */
async function autoFloor(page: Page): Promise<boolean> {
  await page.evaluate(() => (window as any).__TC__.autoplay(true));
  await page.waitForSelector('[data-testid="floor-result"]', { timeout: 150_000 });
  return (await page.locator('[data-testid="floor-result"]').getAttribute('class'))!.includes('won');
}

test('tower flow: a full climb, from floor 1 to running out of hearts and starting again', async ({ page }) => {
  test.setTimeout(400_000);
  await openApp(page);
  await towerSave(page, { place: 'crossroads' });
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await page.waitForSelector('[data-map="crossroads"]');
  await tap(page, '[data-testid="tower-enter"]');
  await page.waitForSelector('[data-screen="tower"].ready');
  await tap(page, '[data-testid="tower-play"]');
  await page.waitForSelector('[data-testid="floor-intro"]');
  let s = await save(page);
  const statsBefore = s.stats;
  expect(s.tower.climb.floor).toBe(1);
  expect(s.tower.climb.hearts).toBe(3);
  const first = s.tower.climb.attempt;
  await page.waitForFunction(() => document.querySelectorAll('.ph-card.up').length === 3);
  // Floor 1, lost: a heart goes, the floor stays, and the retry draws afresh.
  await beginFloor(page);
  await forceFloor(page, false);
  await tap(page, '[data-testid="try-again"]');
  await page.waitForSelector('[data-testid="floor-intro"]');
  s = await save(page);
  expect(s.tower.climb).toMatchObject({ floor: 1, hearts: 2 });
  expect(s.tower.climb.attempt).not.toEqual(first);
  // The retry, played through for real by the auto-player.
  await page.waitForFunction(() => document.querySelectorAll('.ph-card.up').length === 3);
  await beginFloor(page);
  const won = await autoFloor(page);
  s = await save(page);
  expect(s.tower.climb.floor).toBe(won ? 2 : 1);
  expect(s.tower.climb.hearts).toBe(won ? 2 : 1);
  expect(s.tower.climb.run.phasesCompleted).toBeGreaterThan(0);
  // A Tower floor counts toward none of the existing stats.
  expect(s.stats).toEqual(statsBefore);

  // On to floor 10's Guardian, below full hearts: the win gives one back, and the tier changes.
  await page.evaluate(() => { const t = (window as any).__TC__; t.towerSet({ floor: 10, hearts: 2 }); const x = t.getSave(); x.match = null; t.loadSave(x); t.towerHome(); });
  await page.waitForSelector('[data-screen="tower"].ready');
  await openIntro(page);
  await beginFloor(page);
  await forceFloor(page, true);
  await expect(page.locator('[data-testid="result-header"]')).toHaveText('Guardian defeated!');
  await tap(page, '[data-testid="climb"]');
  await page.waitForSelector('[data-testid="floor-intro"]', { timeout: 20_000 });
  s = await save(page);
  expect(s.tower.climb).toMatchObject({ floor: 11, hearts: 3 });
  expect(s.tower.climb.run.guardiansBeaten).toBe(1);
  await expect(page.locator('[data-testid="intro-kicker"]')).toHaveText('TIER 2 · PEACH NOON');
  await expect(page.locator('[data-screen="tower"]')).toHaveAttribute('data-tier', '2');

  // Floor 11, three losses: out of hearts, the run-over screen, then a new climb.
  for (let h = 3; h >= 1; h--) {
    await page.waitForFunction(() => document.querySelectorAll('.ph-card.up').length === 3);
    await beginFloor(page);
    await forceFloor(page, false);
    if (h > 1) await tap(page, '[data-testid="try-again"]');
    if (h > 1) await page.waitForSelector('[data-testid="floor-intro"]');
  }
  await tap(page, '[data-testid="see-climb"]');
  await page.waitForSelector('[data-screen="runover"]');
  await expect(page.locator('[data-testid="runover-floor"]')).toHaveText('Floor 11');
  s = await save(page);
  expect(s.tower.climb).toBeNull();
  expect(s.tower.best).toBe(11);
  expect(s.tower.history[0]).toMatchObject({ floor: 11, newBest: true });
  expect(s.tower.totals.climbs).toBe(1);
  // No stars in the Tower, ever.
  expect(s.campaign.stars).toEqual([3, 3, 3, 3, 3]);
  await tap(page, '[data-testid="new-climb"]');
  await page.waitForSelector('[data-testid="floor-intro"]');
  s = await save(page);
  expect(s.tower.climb).toMatchObject({ floor: 1, hearts: 3, run: { floorsCleared: 0, phasesCompleted: 0, guardiansBeaten: 0 } });
});

test('tower flow: the draw survives a reload, and a floor in progress reloads exactly', async ({ page }) => {
  await openApp(page);
  await towerSave(page, { place: 'crossroads' });
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await page.evaluate(() => { const t = (window as any).__TC__; t.towerSet({ floor: 33, hearts: 2 }); t.towerHome(); });
  await page.waitForSelector('[data-screen="tower"].ready');
  await openIntro(page);
  const drawn = (await save(page)).tower.climb.attempt;
  const labels = await page.locator('.ph-label').allTextContents();
  await page.reload();
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await page.evaluate(() => (window as any).__TC__.towerHome());
  await page.waitForSelector('[data-screen="tower"].ready');
  await openIntro(page);
  expect((await save(page)).tower.climb.attempt).toEqual(drawn);
  expect(await page.locator('.ph-label').allTextContents()).toEqual(labels);

  // Into the floor, a few moves in, then a reload mid-floor: it resumes exactly where it was.
  await beginFloor(page);
  await page.evaluate(() => (window as any).__TC__.autoplay(true));
  await page.waitForFunction(() => { const s = (window as any).__TC__.state(); return s && (s.round > 1 || s.history.length > 8); }, null, { timeout: 60_000 });
  await page.evaluate(() => (window as any).__TC__.autoplay(false));
  await page.waitForFunction(() => (window as any).__TC__.idle() && !document.querySelector('[data-testid="floor-result"]'), null, { timeout: 60_000 });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => { const t = (window as any).__TC__; return { game: t.state(), ui: t.ui() }; });
  const view = await shownView(page);
  await page.reload();
  await waitForResumedTable(page);
  const after = await page.evaluate(() => { const t = (window as any).__TC__; return { game: t.state(), ui: t.ui() }; });
  expect(after).toEqual(before);
  expect(await shownView(page)).toEqual(view);
  expect(after.game.phases).toEqual(drawn.phases);
  // Phases are numbered 1 to 3 on a floor.
  await expect(page.locator('[data-testid="medallion"] span')).toHaveText(/^[123]$/);
});
