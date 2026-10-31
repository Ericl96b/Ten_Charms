// Captures every screen and major state, for scripts/compare-shots.mjs to compare with a saved baseline.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { LINEUPS, openFixture } from './fixtures.ts';
import { openApp, patch, prepare, startMatch, tap, test, waitIdle } from './helpers.ts';

const DIR = `qa-screenshots/cr01/${process.env.VISUAL_DIR ?? 'current'}`;

/** Tags name what a change is allowed to touch: settings-icon, map-current or table. */
async function shot(page: Page, project: string, name: string, tags: string[] = []): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(450);
  const file = `${DIR}/${name}-${project}`;
  await page.screenshot({ path: `${file}.png`, animations: 'disabled' });
  const icon = tags.includes('settings-icon') ? await page.locator('[data-testid="settings"]').boundingBox() : null;
  writeFileSync(`${file}.json`, JSON.stringify({ tags, icon, scale: 2 }));
}

/** Fixes the random choices, and hides the layers that drift or come and go by the clock. */
async function steady(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let seed = 0x5eed;
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.ambient, .bubble, .toast, .fx-layer, .petal, .splash-petal { visibility: hidden !important; }';
      document.head.append(style);
    });
  });
}

/** Goes back to the map, as real play does. Starting a match over a running table would lose it. */
const toMap = (page: Page) => page.evaluate(() => {
  const t = (window as any).__TC__;
  const save = t.getSave();
  save.match = null;
  t.loadSave(save);
});

const closeSheet = async (page: Page) => {
  await page.locator('.backdrop').last().click({ position: { x: 5, y: 5 }, force: true });
  await page.waitForTimeout(300);
};

const setProgress = (page: Page, won: boolean[], stars: number[]) => page.evaluate(([w, s]) => {
  const t = (window as any).__TC__;
  const save = t.getSave();
  save.match = null;
  save.campaign.won = w;
  save.campaign.stars = s;
  save.tutorial.done = true;
  t.loadSave(save);
}, [won, stars] as const);

test('capture: first launch and the Journey map', async ({ page }, info) => {
  const p = info.project.name;
  await steady(page);
  await page.goto('/');
  await page.waitForSelector('[data-testid="install-helper"]');
  await shot(page, p, 'install-helper');
  await page.locator('[data-testid="install-later"]').click();
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.02));

  await shot(page, p, 'map-stop1', ['settings-icon', 'map-current']);
  const won = [false, false, false, false, false];
  const stars = [0, 0, 0, 0, 0];
  const earned = [3, 2, 3, 2];
  for (let stop = 1; stop < 5; stop++) {
    won[stop - 1] = true;
    stars[stop - 1] = earned[stop - 1];
    await setProgress(page, won, stars);
    await shot(page, p, `map-stop${stop + 1}`, ['settings-icon', 'map-current']);
  }
  await setProgress(page, [true, true, true, true, true], [3, 3, 3, 3, 3]);
  await shot(page, p, 'map-all-won', ['settings-icon']);

  await setProgress(page, [true, true, false, false, false], [3, 2, 0, 0, 0]);
  await tap(page, '[data-testid="play"]');
  await shot(page, p, 'match-intro', ['map-current', 'settings-icon']);
  await closeSheet(page);
  await tap(page, '[data-testid="stop-1"] .stop-btn');
  await shot(page, p, 'match-intro-replay', ['map-current', 'settings-icon']);
  await closeSheet(page);
});

test('capture: menu screens', async ({ page }, info) => {
  const p = info.project.name;
  await steady(page);
  await openApp(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.02));
  await setProgress(page, [true, true, false, false, false], [3, 2, 0, 0, 0]);
  await tap(page, '[data-testid="nav-free"]');
  await shot(page, p, 'free-play');
  await tap(page, '[data-testid="nav-collection"]');
  await shot(page, p, 'collection-backs');
  await tap(page, '[data-testid="tab-cloth"]');
  await shot(page, p, 'collection-cloths');
  await tap(page, '[data-testid="tab-charms"]');
  await shot(page, p, 'collection-charms');
  await tap(page, '[data-testid="nav-stats"]');
  await shot(page, p, 'stats');
  await tap(page, '[data-testid="nav-journey"]');
  await page.waitForTimeout(300);
  await tap(page, '[data-testid="settings"]');
  await shot(page, p, 'settings');
  await tap(page, '[data-testid="backup"]');
  await page.waitForTimeout(300);
  const code = page.locator('[data-testid="export-code"]');
  await code.evaluate((el: HTMLTextAreaElement) => { el.value = 'TC1-test'; });
  await shot(page, p, 'backup');
  await closeSheet(page);
  await tap(page, '[data-testid="credits"]');
  await shot(page, p, 'credits');

  const v = page.viewportSize()!;
  await page.setViewportSize({ width: v.height, height: v.width });
  await shot(page, p, 'rotate-card');
  await page.setViewportSize(v);
});

test('capture: table states', async ({ page }, info) => {
  const p = info.project.name;
  await steady(page);
  await openApp(page, { tutorial: { done: true } });
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.02));

  const tags = ['table'];
  await startMatch(page, { lineup: ['briar', 'marigold', 'pip'], seed: '11'.repeat(16), botSeed: '12'.repeat(16) });
  await shot(page, p, 'table-3-opponents', tags);
  await tap(page, '[data-testid="menu"]');
  await shot(page, p, 'pause-menu', tags);
  await closeSheet(page);

  await toMap(page);
  await startMatch(page, { lineup: ['briar', 'marigold'], seed: '11'.repeat(16), botSeed: '12'.repeat(16) });
  await shot(page, p, 'table-2-opponents', tags);
  await toMap(page);
  await startMatch(page, { lineup: ['pip'], seed: '11'.repeat(16), botSeed: '12'.repeat(16) });
  await shot(page, p, 'table-duel', tags);
  await toMap(page);
  await startMatch(page, { lineup: ['pip', 'marigold', 'briar', 'hoot'], seed: '11'.repeat(16), botSeed: '12'.repeat(16) });
  await shot(page, p, 'table-4-opponents', tags);
  await toMap(page);
  await startMatch(page, { lineup: ['pip', 'marigold', 'briar', 'hoot', 'nightshade'], seed: '11'.repeat(16), botSeed: '12'.repeat(16) });
  await shot(page, p, 'table-5-opponents', tags);

  // A bot's turn, held still: the patch redraws without starting the bot.
  await toMap(page);
  await startMatch(page, { lineup: ['briar', 'marigold', 'pip'], seed: '13'.repeat(16), botSeed: '14'.repeat(16) });
  await patch(page, `game.current = 1; game.stage = 'draw';`);
  await shot(page, p, 'table-bot-thinking', tags);

  // Building her slots, before she has laid down.
  await toMap(page);
  await startMatch(page, { lineup: ['briar', 'pip'], seed: '15'.repeat(16), botSeed: '16'.repeat(16) });
  await patch(page, `
    const n = (id, num, suit) => ({ id, kind: 'num', num, suit: suit || 'rose' });
    const me = game.players[0];
    me.phase = 1; me.completed = []; me.laidDown = false;
    me.hand = [n(1,3),n(2,3,'moss'),n(3,3,'honey'),n(4,9),n(5,9,'moss'),n(6,1),n(7,2)];
    game.groups = []; game.current = 0; game.stage = 'play';
    game.discardPile = [n(950, 12, 'moss')];
    match.ui.slots = [[1,2,3],[]];
    match.ui.sort = 'number';
  `);
  await shot(page, p, 'table-slots', tags);

  for (const name of Object.keys(LINEUPS) as (keyof typeof LINEUPS)[]) {
    await toMap(page);
    await openFixture(page, name);
    await shot(page, p, `fixture-${name}-top`, tags);
    await page.evaluate(() => { const l = document.querySelector('.laid')!; l.scrollTop = (l.scrollHeight - l.clientHeight) / 2; });
    await shot(page, p, `fixture-${name}-middle`, tags);
    await page.evaluate(() => { const l = document.querySelector('.laid')!; l.scrollTop = l.scrollHeight; });
    await shot(page, p, `fixture-${name}-bottom`, tags);
  }
});

test('capture: sheets, round end and match end', async ({ page }, info) => {
  const p = info.project.name;
  await steady(page);
  await openApp(page, { tutorial: { done: true } });
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.02));
  const position = `
    const n = (id, num, suit) => ({ id, kind: 'num', num, suit: suit || 'rose' });
    const me = game.players[0];
    me.phase = 1; me.completed = []; me.laidDown = true; me.pendingSkip = false; me.score = 20;
    me.hand = [{ id: 40, kind: 'skip' }, n(41, 1), n(42, 2)];
    game.players[1].phase = 1; game.players[2].phase = 2; game.players[2].completed = [1];
    game.players[1].hand = [n(43, 5), n(44, 6)]; game.players[2].hand = [n(45, 7)];
    game.players[2].pendingSkip = true;
    game.groups = [{ id: 7, owner: 0, type: 'set', num: 9, cards: [1,2,3].map((v) => ({ card: n(60 + v, 9), num: 9 })) }];
    game.current = 0; game.stage = 'play';
    game.discardPile = [n(950, 12, 'moss')];
  `;
  await startMatch(page, { lineup: ['briar', 'pip'], seed: '17'.repeat(16), botSeed: '18'.repeat(16) });
  await patch(page, position);
  await tap(page, '.hc[data-id="40"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForSelector('[data-testid="target-picker"]');
  await shot(page, p, 'target-picker', ['table']);
  await closeSheet(page);

  // She goes out: the round tally passes, then Round End and its review.
  await patch(page, `game.players[0].hand = [{ id: 41, kind: 'num', num: 1, suit: 'rose' }];`);
  await tap(page, '.hc[data-id="41"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForSelector('[data-testid="round-end"]', { timeout: 30_000 });
  await shot(page, p, 'round-end');
  await tap(page, '[data-testid="review-hands"]');
  await page.waitForTimeout(300);
  await page.locator('[data-testid="seed"]').evaluate((el) => { el.textContent = 'seed'; });
  await shot(page, p, 'review-hands');
  await closeSheet(page);

  await tap(page, '[data-testid="next-round"]');
  await waitIdle(page);
  await patch(page, `
    const me = game.players[0];
    me.completed = [1,2,3,4,5,6,7,8,9]; me.phase = 10; me.laidDown = true;
    me.hand = [{ id: 900, kind: 'num', num: 2, suit: 'rose' }];
    game.round = 12; game.current = 0; game.stage = 'play';
  `);
  await tap(page, '.hc[data-id="900"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForSelector('[data-testid="victory"]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="continue"]', { timeout: 30_000 }).catch(() => {});
  // The table shows through this overlay, so its changes show here too.
  await shot(page, p, 'victory', ['table']);
});

test('capture: loss, boss table and tutorial', async ({ page }, info) => {
  const p = info.project.name;
  await steady(page);
  await prepare(page);
  await page.goto('/');
  await page.waitForFunction(() => '__TC__' in window);
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.02));
  await page.evaluate(() => (window as any).__TC__.startMatch({ lineup: ['pip'], seed: '19'.repeat(16), botSeed: '1a'.repeat(16), mode: { kind: 'campaign', stop: 0 } }));
  await page.waitForSelector('[data-testid="coach"]', { timeout: 30_000 });
  await waitIdle(page);
  await page.waitForTimeout(800);
  await shot(page, p, 'tutorial', ['table']);
  await tap(page, '[data-testid="coach-skip"]');
  await waitIdle(page);

  await tap(page, '[data-testid="menu"]');
  await page.getByRole('button', { name: 'How to Play' }).click();
  await shot(page, p, 'how-to-play');
  await page.locator('[data-testid="howto"] .round-btn').first().click();
  await page.waitForTimeout(300);
  await tap(page, '[data-testid="menu"]').catch(() => {});
  await closeSheet(page).catch(() => {});

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
  await page.waitForSelector('[data-testid="back-map"]', { timeout: 30_000 });
  await shot(page, p, 'loss');
  await tap(page, '[data-testid="back-map"]');
  await page.waitForTimeout(300);

  await setProgress(page, [true, true, true, true, false], [3, 3, 3, 3, 0]);
  await tap(page, '[data-testid="stop-5"] .stop-btn');
  await page.waitForTimeout(300);
  await shot(page, p, 'boss-match-intro', ['map-current', 'settings-icon']);
  await closeSheet(page);
  await page.evaluate(() => (window as any).__TC__.startMatch({ lineup: ['nightshade'], seed: '1b'.repeat(16), botSeed: '1c'.repeat(16), mode: { kind: 'campaign', stop: 4 } }));
  await page.waitForSelector('[data-testid="boss-intro"]');
  await page.locator('[data-testid="boss-intro"]').click({ force: true });
  await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 15_000 });
  await waitIdle(page);
  await shot(page, p, 'boss-table', ['table']);
});
