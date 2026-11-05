import { expect, openApp, patch, prepare, shotPath, tap, test, waitIdle } from './helpers.ts';
import type { Page } from '@playwright/test';

/** Puts her one discard from winning the match, on a chosen round. */
const winningPosition = (round: number) => `
  const me = game.players[0];
  me.completed = [1,2,3,4,5,6,7,8,9]; me.phase = 10; me.laidDown = true;
  me.hand = [{ id: 900, kind: 'num', num: 2, suit: 'rose' }];
  game.round = ${round}; game.current = 0; game.stage = 'play';
`;

async function winFromTable(page: Page, round: number): Promise<void> {
  await page.waitForFunction(() => (window as any).__TC__.idle(), null, { timeout: 60_000 });
  await patch(page, winningPosition(round));
  await tap(page, '.hc[data-id="900"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForSelector('[data-testid="victory"]', { timeout: 30_000 });
}

/** Taps through every reveal. Returns how many of each there were. */
async function finishVictory(page: Page): Promise<{ unlocks: number; charms: number }> {
  let unlocks = 0, charms = 0;
  for (let i = 0; i < 60; i++) {
    if (await page.locator('[data-testid="continue"]').count()) break;
    if (await page.locator('[data-testid="reveal"]').count()) { await page.locator('[data-testid="reveal"]').click({ force: true }); unlocks++; }
    else if (await page.locator('[data-testid="reveal-charm"]').count()) { await page.locator('[data-testid="reveal-charm"]').click({ force: true }); charms++; }
    else await page.waitForTimeout(100);
  }
  await page.locator('[data-testid="continue"]').click();
  await page.waitForSelector('[data-screen="journey"]');
  return { unlocks, charms };
}

async function playStop(page: Page, stop: number, round: number): Promise<{ unlocks: number; charms: number }> {
  await tap(page, `[data-testid="stop-${stop}"] .stop-btn`);
  await tap(page, '[data-testid="begin"]');
  if (stop === 5) {
    await expect(page.locator('[data-testid="boss-intro"]')).toHaveCount(1);
    await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 20_000 });
  }
  await page.waitForSelector('[data-screen="table"]');
  await page.evaluate(() => (window as any).__TC__.getSave());
  const coach = page.locator('[data-testid="coach-skip"]');
  await waitIdleOrCoach(page);
  if (await coach.count()) await coach.click();
  await winFromTable(page, round);
  return finishVictory(page);
}

async function waitIdleOrCoach(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__TC__.idle() || !!document.querySelector('[data-testid="coach-skip"]'), null, { timeout: 60_000 });
}

test('7. the whole campaign: stars, unlocks, Charms, Free Play, variants and the boss intro', async ({ page }) => {
  test.setTimeout(170_000);
  await openApp(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));

  const save = () => page.evaluate(() => (window as any).__TC__.getSave());

  // Before any win, Free Play is locked and later stops are closed.
  await expect(page.locator('[data-testid="nav-free"]')).toContainText('Beat Pip to unlock');
  await tap(page, '[data-testid="stop-2"] .stop-btn');
  await expect(page.locator('[data-testid="tooltip"]')).toBeVisible();

  const r1 = await playStop(page, 1, 12);
  expect(r1.unlocks).toBe(2);
  let s = await save();
  expect(s.campaign.stars[0]).toBe(3);
  expect(s.stats.won).toBe(1);
  await expect(page.locator('[data-testid="total-stars"]')).toContainText('3 / 15');
  await expect(page.locator('[data-testid="nav-free"]')).not.toContainText('Beat Pip');

  await tap(page, '[data-testid="nav-collection"]');
  await expect(page.locator('[data-testid="item-clover-meadow"]')).toHaveAttribute('data-unlocked', '1');
  await expect(page.locator('[data-testid="item-honeycomb"]')).toHaveAttribute('data-unlocked', '0');
  await expect(page.locator('[data-testid="item-honeycomb"]')).toContainText('Win Stop 3');
  await tap(page, '[data-testid="item-clover-meadow"]');
  await tap(page, '[data-testid="equip"]');
  await expect(page.locator('[data-testid="item-clover-meadow"] .tick')).toHaveCount(1);
  expect((await save()).equipped.back).toBe('clover-meadow');
  await tap(page, '[data-testid="nav-journey"]');

  await playStop(page, 2, 14);
  s = await save();
  expect(s.campaign.stars[1]).toBe(2);
  await playStop(page, 3, 15);
  s = await save();
  expect(s.campaign.stars[2]).toBe(1);
  await playStop(page, 4, 12);

  // Free Play offers only what has been reached, and no unlockable variants yet. The Moonlit Trials are always open.
  await tap(page, '[data-testid="nav-free"]');
  await expect(page.locator('[data-testid="fp-bot-hoot"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="fp-variant-sprint"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="fp-variant-moonlit"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="fp-variant-trial"]')).toHaveCount(3);
  await tap(page, '[data-testid="nav-journey"]');

  const r5 = await playStop(page, 5, 12);
  expect(r5.unlocks).toBeGreaterThanOrEqual(5);
  s = await save();
  expect(s.campaign.won).toEqual([true, true, true, true, true]);
  expect(s.charms).toContain('garden-champion');
  const names = await page.evaluate(() => (window as any).__TC__.events.map((e: { name: string }) => e.name));
  for (const n of ['boss.intro', 'boss.victory', 'victory.star', 'victory.unlock', 'music.boss']) expect(names).toContain(n);

  // The gentle backup suggestion appears once.
  await expect(page.getByText('Want to back up your garden?')).toBeVisible();
  await tap(page, '[data-testid="confirm-cancel"]');
  await page.waitForTimeout(200);

  await tap(page, '[data-testid="nav-free"]');
  await expect(page.locator('[data-testid="fp-variant-sprint"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="fp-variant-choose"]')).toHaveCount(1);
});

test('all 15 stars bring Starlight and Bouquet', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  await page.evaluate(() => {
    const t = (window as any).__TC__;
    t.setTestScale(0.05);
    const s = t.getSave();
    s.campaign.won = [true, true, true, true, false];
    s.campaign.stars = [3, 3, 3, 3, 0];
    s.tutorial.done = true;
    t.loadSave(s);
  });
  await playStop(page, 5, 11);
  const s = await page.evaluate(() => (window as any).__TC__.getSave());
  expect(s.charms).toContain('bouquet');
  await tap(page, '[data-testid="confirm-cancel"]');
  await page.waitForTimeout(200);
  await tap(page, '[data-testid="nav-collection"]');
  await expect(page.locator('[data-testid="item-starlight"]')).toHaveAttribute('data-unlocked', '1');
  await tap(page, '[data-testid="tab-charms"]');
  await expect(page.locator('[data-charm="bouquet"]')).toHaveAttribute('data-earned', '1');
  await expect(page.locator('[data-testid="charm-grid"] .charm-item')).toHaveCount(10);
});

test('a loss shows the gentle screen and opens nothing; forfeit counts as a loss', async ({ page }, info) => {
  test.setTimeout(120_000);
  await openApp(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await tap(page, '[data-testid="stop-1"] .stop-btn');
  await tap(page, '[data-testid="begin"]');
  await waitIdleOrCoach(page);
  await tap(page, '[data-testid="coach-skip"]');
  await waitIdle(page);
  // Pip is one card from winning, and she has to discard to hand over the turn.
  await patch(page, `
    const n = (id, num) => ({ id, kind: 'num', num, suit: 'rose' });
    const pip = game.players[1];
    pip.completed = [1,2,3,4,5,6,7,8,9]; pip.phase = 10; pip.laidDown = true; pip.hand = [n(905, 5)];
    game.groups = [{ id: 77, owner: 1, type: 'set', num: 5, cards: [1,2,3,4,5].map((v) => ({ card: n(910 + v, 5), num: 5 })) }];
    game.drawPile.unshift(n(906, 5));
    game.players[0].hand = [n(907, 1), n(908, 2), n(909, 3)];
    game.current = 0; game.stage = 'play';
  `);
  await tap(page, '.hc[data-id="907"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForSelector('[data-testid="loss"]', { timeout: 30_000 });
  await expect(page.getByText('So close!')).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: shotPath('loss', info.project.name) });
  let s = await page.evaluate(() => (window as any).__TC__.getSave());
  expect(s.campaign.won[0]).toBe(false);
  expect(s.stats.perBot.pip.losses).toBe(1);
  await tap(page, '[data-testid="back-map"]');
  await expect(page.locator('[data-testid="nav-free"]')).toContainText('Beat Pip');

  await tap(page, '[data-testid="stop-1"] .stop-btn');
  await tap(page, '[data-testid="begin"]');
  await waitIdle(page);
  await tap(page, '[data-testid="menu"]');
  await tap(page, '[data-testid="forfeit"]');
  await tap(page, '[data-testid="confirm-ok"]');
  await page.waitForSelector('[data-screen="journey"]');
  s = await page.evaluate(() => (window as any).__TC__.getSave());
  expect(s.stats.played).toBe(2);
  expect(s.match).toBe(null);
});

test('8. backup: export, reset, import restores identical progress', async ({ page }) => {
  await openApp(page);
  const before = await page.evaluate(() => {
    const t = (window as any).__TC__;
    const s = t.getSave();
    s.campaign.won = [true, true, false, false, false];
    s.campaign.stars = [3, 2, 0, 0, 0];
    s.campaign.bestRounds = [11, 13, null, null, null];
    s.charms = ['first-bloom', 'rainbow'];
    s.stats.played = 42;
    s.stats.perBot.pip.wins = 9;
    s.settings.botSpeed = 'brisk';
    t.loadSave(s);
    return t.getSave();
  });
  await tap(page, '[data-testid="settings"]');
  await tap(page, '[data-testid="backup"]');
  const code = await page.locator('[data-testid="export-code"]').inputValue();
  expect(code.startsWith('TC1-')).toBe(true);
  await page.locator('.backdrop').last().click({ position: { x: 5, y: 5 }, force: true });
  await page.waitForTimeout(400);

  await tap(page, '[data-testid="reset"]');
  await tap(page, '[data-testid="confirm-ok"]');
  await page.locator('[data-testid="reset-input"]').fill('nope');
  await tap(page, '[data-testid="reset-confirm"]');
  await expect(page.locator('[data-testid="tooltip"]')).toHaveText('Type RESET to confirm.');
  await page.locator('[data-testid="reset-input"]').fill('RESET');
  await tap(page, '[data-testid="reset-confirm"]');
  await page.waitForSelector('[data-testid="settings-screen"]', { state: 'detached' });
  const wiped = await page.evaluate(() => (window as any).__TC__.getSave());
  expect(wiped.stats.played).toBe(0);
  expect(wiped.charms).toEqual([]);

  await tap(page, '[data-testid="settings"]');
  await tap(page, '[data-testid="backup"]');
  await page.locator('[data-testid="import-code"]').fill('garbage');
  await tap(page, '[data-testid="import"]');
  await expect(page.locator('[data-testid="tooltip"]')).toContainText("doesn't look right");
  await page.locator('[data-testid="import-code"]').fill(code);
  await tap(page, '[data-testid="import"]');
  await expect(page.getByText('5 stars, 2 Charms, 42 matches')).toBeVisible();
  await tap(page, '[data-testid="confirm-ok"]');
  await page.waitForSelector('[data-testid="settings-screen"]', { state: 'detached' });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => (window as any).__TC__.getSave());
  expect({ ...after, match: null }).toEqual({ ...before, match: null });
  await expect(page.locator('[data-testid="total-stars"]')).toContainText('5 / 15');
});

test('corrupt save data falls back to the backup, and never crashes', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const t = (window as any).__TC__;
    const s = t.getSave();
    s.stats.played = 7;
    t.loadSave(s);
    t.loadSave(t.getSave());
    localStorage.setItem('ten-charms.save', '{not json');
  });
  await page.reload();
  await page.waitForFunction(() => '__TC__' in window, null, { timeout: 15_000 });
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  expect(await page.evaluate(() => (window as any).__TC__.getSave().stats.played)).toBe(7);
  await page.evaluate(() => { localStorage.setItem('ten-charms.save', 'x'); localStorage.setItem('ten-charms.save.backup', 'y'); });
  await page.reload();
  await page.waitForFunction(() => '__TC__' in window, null, { timeout: 15_000 });
  await expect(page.locator('#app > *').first()).toBeAttached();
});

test('6. offline: after first load the production app loads and plays with no network', async ({ page, context }) => {
  await prepare(page);
  await page.goto('http://localhost:4175/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 });
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await tap(page, '[data-testid="play"]');
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-screen="table"]');
  await tap(page, '[data-testid="coach-skip"]');
  await expect(page.locator('[data-testid="ribbon"]')).toHaveText(/draw a card/, { timeout: 15_000 });
  await tap(page, '[data-testid="draw-pile"]');
  await expect(page.locator('[data-testid="ribbon"]')).toHaveText(/lay down or discard/);
  const count = await page.evaluate(() => document.fonts.size);
  expect(count).toBeGreaterThan(0);
  await context.setOffline(false);
});

test('9. landscape shows the rotate card', async ({ page }) => {
  await openApp(page);
  const card = page.locator('[data-testid="rotate-card"]');
  await expect(card).toBeHidden();
  const v = page.viewportSize()!;
  await page.setViewportSize({ width: v.height, height: v.width });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Please turn your phone upright');
  await page.setViewportSize(v);
  await expect(card).toBeHidden();
});

test('install helper shows in a browser tab, and stays away for a week after Maybe later', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="install-helper"]')).toBeVisible();
  await page.locator('[data-testid="install-later"]').click();
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await page.reload();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="install-helper"]')).toHaveCount(0);
});

test('tutorial shows tips and can be dismissed; How to Play has the fair play promise', async ({ page }, info) => {
  await openApp(page);
  await tap(page, '[data-testid="play"]');
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-testid="coach"]', { timeout: 30_000 });
  await expect(page.locator('[data-testid="coach"]')).toContainText('two Sets of 3');
  await page.screenshot({ path: shotPath('tutorial', info.project.name) });
  await tap(page, '[data-testid="coach-next"]');
  // This deal is random. If a bot goes first and she holds a Skip, the Skip tip comes before the drawing tip.
  await expect(page.locator('[data-testid="coach"]')).toContainText(/Start your turn by drawing|Skips make someone miss a turn/);
  if ((await page.locator('[data-testid="coach"]').textContent())!.includes('Skips make')) await tap(page, '[data-testid="coach-next"]');
  await expect(page.locator('[data-testid="coach"]')).toContainText('Start your turn by drawing');
  await tap(page, '[data-testid="coach-skip"]');
  await expect(page.locator('[data-testid="coach"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__TC__.getSave().tutorial.done)).toBe(true);
  await tap(page, '[data-testid="menu"]');
  await page.getByRole('button', { name: 'How to Play' }).click();
  await expect(page.locator('[data-testid="fair-play"]')).toContainText("can't see your cards");
  await page.waitForTimeout(400);
  await page.screenshot({ path: shotPath('how-to-play', info.project.name) });
  await page.locator('[data-testid="replay-tutorial"]').click();
  expect(await page.evaluate(() => (window as any).__TC__.getSave().tutorial.done)).toBe(false);
});

test('screens: every menu screen renders, at every size', async ({ page }, info) => {
  await openApp(page);
  await page.evaluate(() => {
    const t = (window as any).__TC__;
    const s = t.getSave();
    s.campaign.won = [true, true, false, false, false];
    s.campaign.stars = [3, 2, 0, 0, 0];
    s.charms = ['first-bloom'];
    s.stats.played = 5; s.stats.won = 2;
    t.loadSave(s);
  });
  const p = info.project.name;
  await page.waitForTimeout(200);
  await page.screenshot({ path: shotPath('map-progress', p) });
  await tap(page, '[data-testid="play"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: shotPath('match-intro', p) });
  await page.locator('.backdrop').click({ position: { x: 5, y: 5 }, force: true });
  await page.waitForTimeout(400);
  await tap(page, '[data-testid="nav-free"]');
  await page.waitForTimeout(350);
  await page.screenshot({ path: shotPath('free-play', p) });
  await tap(page, '[data-testid="nav-collection"]');
  await page.waitForTimeout(350);
  await page.screenshot({ path: shotPath('collection-backs', p) });
  await tap(page, '[data-testid="tab-cloth"]');
  await page.screenshot({ path: shotPath('collection-cloths', p) });
  await tap(page, '[data-testid="tab-charms"]');
  await page.screenshot({ path: shotPath('collection-charms', p) });
  await tap(page, '[data-testid="nav-stats"]');
  await page.waitForTimeout(350);
  await page.screenshot({ path: shotPath('stats', p) });
  await tap(page, '[data-testid="nav-journey"]');
  await page.waitForTimeout(350);
  await tap(page, '[data-testid="settings"]');
  await page.waitForTimeout(450);
  await page.screenshot({ path: shotPath('settings', p) });
  await tap(page, '[data-testid="credits"]');
  await expect(page.locator('[data-testid="credits-list"]')).toContainText('CC0');
  await page.waitForTimeout(400);
  await page.screenshot({ path: shotPath('credits', p) });
  // Text on every screen stays at or above the 11 point minimum.
  const small = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>('#app *').forEach((el) => {
      if (el.childNodes.length === 1 && el.firstChild?.nodeType === 3 && el.textContent!.trim() && el.getClientRects().length) {
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 10.95) out.push(`${el.className}:${size}`);
      }
    });
    return out;
  });
  expect(small).toEqual([]);
});
