// Change Request 04: whole matches through the real UI with the auto-player, on the new Moonlit list and on the
// retired one for matches saved before the update. One size only (playwright.config.ts), like the trials' matches.
import type { Page } from '@playwright/test';
import { GLADE_STOPS } from '../../src/content.ts';
import { openApp, patch, tap, test, waitIdle } from './helpers.ts';
import { NEW_LIST, RETIRED, expect, fixture, openWithFixture } from './swap-fixtures.ts';

const FAST = 0.02;

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);

/** Lets the auto-player play the human's side until the match is over and its end screen is up. */
async function playToEnd(page: Page): Promise<{ game: any; save: any }> {
  await page.evaluate(() => (window as any).__TC__.autoplay(true));
  await page.waitForFunction(() => !(window as any).__TC__.autoRunning(), null, { timeout: 380_000, polling: 250 });
  const end = await page.evaluate(() => { const t = (window as any).__TC__; return { game: t.state(), save: t.getSave() }; });
  expect(end.game.stage).toBe('matchOver');
  return end;
}

/** Rematch after a win, Try Again after a loss: either way the next match is on the new list. */
async function playAgainOnNewList(page: Page, boss: boolean): Promise<void> {
  const again = (await page.locator('[data-testid="rematch"]').count()) ? 'rematch' : 'try-again';
  await page.locator(`[data-testid="${again}"]`).click();
  if (boss) await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 30_000 });
  // The test hooks lose the table on a Rematch (the old table's teardown runs after the new one starts), so read the
  // new match from the save and the screen.
  await page.waitForFunction(() => { const m = (window as any).__TC__.getSave().match; return m && m.game.round === 1 && m.game.stage !== 'matchOver'; }, null, { timeout: 30_000 });
  const next = await page.evaluate(() => (window as any).__TC__.getSave().match.game);
  expect(next.variant).toBe('moonlit');
  for (const p of next.players) expect(p.phase).toBe(NEW_LIST[0]);
  // The finished match's table leaves once its exit has played.
  await expect(page.locator('[data-screen="table"]')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('[data-testid="medallion"]')).toHaveAttribute('aria-label', 'Phase 1');
  await expect(page.locator('[data-testid="slot-0"]')).toHaveAttribute('aria-label', 'Set of 3');
  await expect(page.locator('[data-testid="phase-panel"]')).toContainText('2 Sets of 3 + Pair');
}

/** Map 1 finished, the reveal seen, and the Glade at a given point. */
async function gladeSave(page: Page, winOrder: string[]): Promise<void> {
  await page.evaluate((order) => {
    const t = (window as any).__TC__;
    const s = t.getSave();
    s.match = null;
    s.tutorial.done = true;
    s.backupPrompted = true;
    s.campaign.won = [true, true, true, true, true];
    s.campaign.stars = [3, 3, 3, 3, 3];
    s.glade = { ...s.glade, winOrder: order, stars: Object.fromEntries((order as string[]).map((id) => [id, 1])), revealSeen: true, lastMap: 'glade' };
    t.loadSave(s);
  }, winOrder);
}

test('swap match: a Map 2 stop plays all ten phases of the new list', async ({ page }) => {
  test.setTimeout(400_000);
  await openApp(page);
  await page.evaluate((s) => (window as any).__TC__.setTestScale(s), FAST);
  await gladeSave(page, ['g1', 'a1']);
  await page.waitForSelector('[data-map="glade"]');
  await page.waitForFunction(() => !document.querySelector('.stop-cta') || !!document.querySelector('.stop-cta[data-side]'));
  await tap(page, '[data-testid="glade-a2"] .stop-btn');
  await expect(page.locator('[data-testid="match-intro"]')).toBeVisible();
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-screen="table"]');
  await waitIdle(page);
  const start = await page.evaluate(() => (window as any).__TC__.state());
  expect(start.variant).toBe('moonlit');
  expect(start.rules?.fog).toBe(true);
  for (const p of start.players) expect(p.phase).toBe(NEW_LIST[0]);
  await expect(page.locator('[data-testid="medallion"]')).toHaveAttribute('aria-label', 'Phase 1');
  const { game } = await playToEnd(page);
  expect(sorted(game.players[game.winners[0]].completed)).toEqual(NEW_LIST);
  for (const p of game.players) for (const c of p.completed) expect(NEW_LIST).toContain(c);
});

test('swap match: a Free Play Moonlit Phases match plays all ten phases of the new list', async ({ page }) => {
  test.setTimeout(400_000);
  await openApp(page);
  await page.evaluate((s) => (window as any).__TC__.setTestScale(s), FAST);
  await gladeSave(page, ['g1']);
  await tap(page, '[data-testid="nav-free"]');
  await page.waitForSelector('[data-screen="free"]');
  await tap(page, '[data-testid="fp-variant-moonlit"]');
  await tap(page, '[data-testid="fp-begin"]');
  await page.waitForSelector('[data-screen="table"]');
  await waitIdle(page);
  const start = await page.evaluate(() => (window as any).__TC__.state());
  expect(start.variant).toBe('moonlit');
  expect(start.rules?.fog).toBeFalsy();
  for (const p of start.players) expect(p.phase).toBe(NEW_LIST[0]);
  const { game, save } = await playToEnd(page);
  expect(sorted(game.players[game.winners[0]].completed)).toEqual(NEW_LIST);
  if (game.winners.includes(0)) expect(save.charms).toContain('moonlit-mastery');
});

// A match saved on the retired list, at a Map 2 stop and at the boss. She is moved to that list's last phase so the
// match ends in her win, and the stars it earns are checked against the unchanged thresholds.
for (const [name, stop] of [['glade-a2-fogged', 'a2'], ['glade-g3-boss', 'g3']] as const) {
  test(`swap match: a ${name} match saved before the update ends on the retired list, with the same star limits`, async ({ page }) => {
    test.setTimeout(400_000);
    await openWithFixture(page, name);
    await page.evaluate((s) => (window as any).__TC__.setTestScale(s), FAST);
    const before = fixture(name);
    await patch(page, `const me = game.players[0]; me.completed = ${JSON.stringify(RETIRED.slice(0, -1))}; me.phase = ${RETIRED[9]};`);
    const { game, save } = await playToEnd(page);
    for (const p of game.players) {
      for (const c of p.completed) expect(RETIRED).toContain(c);
      if (p.phase !== null) expect(RETIRED).toContain(p.phase);
    }
    expect(game.winners).toEqual([0]);
    expect(sorted(game.players[0].completed)).toEqual(RETIRED);
    const def = GLADE_STOPS.find((s) => s.id === stop)!;
    const want = game.round <= def.stars.three ? 3 : game.round <= def.stars.two ? 2 : 1;
    await expect(page.locator('[data-testid="stars"]')).toHaveAttribute('aria-label', `${want} of 3 stars`);
    expect(save.glade.stars[stop]).toBe(Math.max(before.glade.stars[stop] ?? 0, want));
    expect(save.charms).toContain('moonlit-mastery');
    expect(save.match).toBeNull();
    await playAgainOnNewList(page, stop === 'g3');
  });
}

test('swap match: a Free Play Moonlit Phases match saved before the update plays to the end on the retired list', async ({ page }) => {
  test.setTimeout(400_000);
  await openWithFixture(page, 'free-moonlit');
  await page.evaluate((s) => (window as any).__TC__.setTestScale(s), FAST);
  const { game, save } = await playToEnd(page);
  expect(sorted(game.players[game.winners[0]].completed)).toEqual(RETIRED);
  for (const p of game.players) for (const c of p.completed) expect(RETIRED).toContain(c);
  if (game.winners.includes(0)) expect(save.charms).toContain('moonlit-mastery');
  await playAgainOnNewList(page, false);
});

test('swap match: a Moonlit Trial A match saved before the update plays to the end on its list', async ({ page }) => {
  test.setTimeout(400_000);
  await openWithFixture(page, 'free-trialA');
  await page.evaluate((s) => (window as any).__TC__.setTestScale(s), FAST);
  const { game } = await playToEnd(page);
  expect(game.variant).toBe('moonlit');
  expect(sorted(game.players[game.winners[0]].completed)).toEqual(NEW_LIST);
  await playAgainOnNewList(page, false);
});
