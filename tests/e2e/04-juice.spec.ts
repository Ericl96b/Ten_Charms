import { drag, expect, openApp, patch, shotPath, startMatch, tap, test, waitIdle } from './helpers.ts';
import type { Page } from '@playwright/test';

const BASE = `
  const n = (id, num, suit) => ({ id, kind: 'num', num, suit: suit || 'rose' });
  const me = game.players[0];
  me.phase = 1; me.completed = []; me.laidDown = false; me.pendingSkip = false;
  game.groups = []; game.current = 0; game.stage = 'play';
  game.discardPile = [n(950, 12, 'moss')];
  match.ui.slots = [[],[]];
`;

async function moment(page: Page, name: string, project: string, afterMs: number): Promise<void> {
  await page.waitForTimeout(afterMs);
  await page.screenshot({ path: shotPath(name, project) });
}

test('lay-down moment, slots, sparkles, hit, wild trail, and going out', async ({ page }, info) => {
  const p = info.project.name;
  await openApp(page);
  await startMatch(page, { lineup: ['pip', 'marigold'], seed: '55'.repeat(16), botSeed: '56'.repeat(16) });
  await patch(page, BASE + `
    me.hand = [n(1,3),n(2,3,'moss'),n(3,3,'honey'),n(4,9),n(5,9,'moss'),{id:6,kind:'wild'},n(7,3,'moonstone'),{id:8,kind:'wild'},n(9,1)];
    me.hand = me.hand.slice(0, 9);
    game.players[1].phase = 1; game.players[2].phase = 1;
  `);
  await page.waitForTimeout(500);
  await page.screenshot({ path: shotPath('hand-hints', p) });

  // The Wild leaves a sparkle trail when dragged, and it lands in a slot.
  await tap(page, '.hc[data-id="4"]');
  await tap(page, '.hc[data-id="5"]');
  // The trail is random per pointer move, so pin the odds to keep this drag from ever missing it.
  await page.evaluate(() => { (window as any).__random = Math.random; Math.random = () => 0.1; });
  await drag(page, '.hc[data-id="6"]', '[data-testid="slot-1"]');
  await page.evaluate(() => { Math.random = (window as any).__random; });
  await expect(page.locator('[data-testid="slot-1"]')).toContainText('Ready');
  // Suggest fills what's left.
  await tap(page, '.hc[data-id="1"]');
  await tap(page, '.hc[data-id="2"]');
  await tap(page, '.hc[data-id="3"]');
  await tap(page, '[data-testid="slot-0"]');
  await page.waitForTimeout(350);
  await page.screenshot({ path: shotPath('lay-ready', p) });

  await tap(page, '[data-testid="primary"]');
  await moment(page, 'lay-down-burst', p, 560);
  await moment(page, 'lay-down-banner', p, 300);
  await waitIdle(page);
  await expect(page.locator('[data-testid="charm-toast"]')).toHaveCount(1);
  await page.screenshot({ path: shotPath('charm-toast', p) });

  // Sort cycles, and hitting.
  await tap(page, '[data-testid="sort"]');
  await tap(page, '[data-testid="sort"]');
  await tap(page, '[data-testid="sort"]');
  await page.waitForTimeout(350);
  await tap(page, '.hc[data-id="7"]');
  await page.waitForTimeout(250);
  await page.screenshot({ path: shotPath('hit-glow', p) });
  await tap(page, '.group.can-hit');
  await waitIdle(page);

  // Wild on a group, then out by discarding the last card.
  await tap(page, '.hc[data-id="8"]');
  await tap(page, '.group.can-hit');
  await waitIdle(page);
  await tap(page, '.hc[data-id="9"]');
  await tap(page, '[data-testid="discard-btn"]');
  await moment(page, 'going-out', p, 420);
  await page.waitForSelector('[data-testid="tally"]', { timeout: 20_000 });
  await moment(page, 'round-tally', p, 500);
  await page.waitForSelector('[data-testid="round-end"]', { timeout: 30_000 });
  await moment(page, 'round-end', p, 500);
  await tap(page, '[data-testid="review-hands"]');
  await expect(page.locator('[data-testid="seed"]')).toHaveText(/^[0-9a-f]{32}$/);
  await moment(page, 'review-hands', p, 400);
  await page.locator('.backdrop').click({ position: { x: 5, y: 5 }, force: true });
  await page.waitForTimeout(350);
  await tap(page, '[data-testid="next-round"]');
  await page.waitForTimeout(350);
  await page.screenshot({ path: shotPath('deal', p) });
  await waitIdle(page);
  // Left alone on her turn, the hand starts to breathe.
  await page.waitForFunction(() => (window as any).__TC__.events.some((e: { name: string }) => e.name === 'ambient.handBreathing'), null, { timeout: 15_000 });
});

test('being skipped, skipping, bots laying down, hitting, going out, and the discard history', async ({ page }, info) => {
  const p = info.project.name;
  await openApp(page);
  await startMatch(page, { lineup: ['briar', 'pip'], seed: '66'.repeat(16), botSeed: '67'.repeat(16) });
  // Briar plays a Skip as soon as it can, and targets the leader: her.
  await patch(page, BASE + `
    me.completed = [1,2]; me.phase = 3; match.ui.slots = [[],[]];
    me.hand = [n(1,1),n(2,2),n(3,4),n(4,7)];
    game.players[1].hand = [{id:20,kind:'skip'},n(21,1),n(22,3),n(23,5)];
    game.players[1].phase = 1;
    game.players[2].hand = [n(31,8),n(32,8),n(33,8),n(34,9),n(35,9),n(36,9),n(37,2),n(38,6)];
    game.players[2].phase = 1;
  `);
  await tap(page, '.hc[data-id="1"]');
  await tap(page, '[data-testid="discard-btn"]');
  await moment(page, 'skipped-her', p, 1500);

  // Pip lays down from a ready hand during that same lap.
  await page.waitForFunction(() => (window as any).__TC__.state().players[2].laidDown, null, { timeout: 30_000 });
  await moment(page, 'bot-lay-down', p, 300);
  await page.waitForFunction(() => { const s = (window as any).__TC__.state(); return s.current === 0 && s.stage === 'draw'; }, null, { timeout: 30_000 });
  await waitIdle(page);

  // A long press on the discard pile opens the history.
  const box = await page.locator('[data-testid="discard-pile"]').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(520);
  await page.mouse.up();
  await expect(page.locator('[data-testid="history"]')).toBeVisible();
  await moment(page, 'discard-history', p, 350);
  await page.locator('.backdrop').click({ position: { x: 5, y: 5 }, force: true });
  await page.waitForTimeout(350);

  // She skips a bot with the target picker; one target is already skipped and greyed out.
  await patch(page, `
    const n = (id, num) => ({ id, kind: 'num', num, suit: 'rose' });
    const me = game.players[0];
    me.hand = [{id:40,kind:'skip'}, n(41,1), n(42,2)];
    game.players[2].pendingSkip = true;
    game.stage = 'play'; game.current = 0;
  `);
  await tap(page, '.hc[data-id="40"]');
  await tap(page, '[data-testid="discard-btn"]');
  await expect(page.locator('[data-testid="target-2"]')).toHaveClass(/off/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shotPath('target-picker', p) });
  await tap(page, '[data-testid="target-1"]');
  await moment(page, 'skipped-bot', p, 300);
  await waitIdle(page);
  await page.waitForFunction(() => { const s = (window as any).__TC__.state(); return s.current === 0 && s.stage === 'draw'; }, null, { timeout: 30_000 });

  // A bot hits and goes out.
  await patch(page, `
    const n = (id, num) => ({ id, kind: 'num', num, suit: 'rose' });
    game.players[1].pendingSkip = false; game.players[2].pendingSkip = false;
    game.players[0].hand = [n(51,1), n(52,2), n(53,3)];
    game.players[1].laidDown = true;
    game.players[1].hand = [n(54,5)];
    game.groups = [{ id: 88, owner: 1, type: 'set', num: 5, cards: [1,2,3].map((v) => ({ card: n(60 + v, 5), num: 5 })) }];
    game.drawPile.unshift(n(55,5));
    game.stage = 'play'; game.current = 0;
  `);
  await tap(page, '.hc[data-id="51"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForSelector('[data-testid="out-stamp"]', { timeout: 30_000 });
  await page.screenshot({ path: shotPath('bot-out', p) });
  await page.waitForSelector('[data-testid="round-end"]', { timeout: 30_000 });
});

test('choose your phase and sprint play through their own flows', async ({ page }) => {
  test.setTimeout(170_000);
  await openApp(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.02));
  await startMatch(page, { lineup: ['pip'], variant: 'choose', seed: '71'.repeat(16), botSeed: '72'.repeat(16) });
  await expect(page.locator('[data-testid="phase-choices"]')).toBeVisible();
  await tap(page, '[data-testid="choose-8"]');
  await page.waitForFunction(() => { const s = (window as any).__TC__.state(); return s.stage !== 'choose'; }, null, { timeout: 15_000 });
  await waitIdle(page);
  await expect(page.locator('[data-testid="requirement"]')).toHaveText('7 of one Color');
  await page.evaluate(() => (window as any).__TC__.autoplay(true));
  await page.waitForFunction(() => !(window as any).__TC__.autoRunning(), null, { timeout: 90_000 });
  expect(await page.evaluate(() => (window as any).__TC__.getSave().stats.played)).toBe(1);
});

test('tapping jumps a celebration to its end, and tapping the boss intro skips it', async ({ page }) => {
  await openApp(page);
  await startMatch(page, { lineup: ['pip'], seed: 'c1'.repeat(16), botSeed: 'c2'.repeat(16) });
  await patch(page, BASE + `
    me.hand = [n(1,3),n(2,3,'moss'),n(3,3,'honey'),n(4,9),n(5,9,'moss'),n(6,9,'honey'),n(9,1),n(10,1)];
    game.players[1].phase = 1;
  `);
  await tap(page, '[data-testid="suggest"]');
  await page.waitForTimeout(400);
  await tap(page, '[data-testid="primary"]');
  const start = Date.now();
  await page.waitForTimeout(80);
  await tap(page, '[data-testid="cloth"]');
  await waitIdle(page);
  expect(Date.now() - start).toBeLessThan(1500);
  expect(await page.evaluate(() => (window as any).__TC__.state().players[0].laidDown)).toBe(true);

  await page.evaluate(() => {
    const t = (window as any).__TC__;
    const s = t.getSave();
    s.match = null;
    s.campaign.won = [true, true, true, true, false];
    s.tutorial.done = true;
    t.loadSave(s);
  });
  await tap(page, '[data-testid="stop-5"] .stop-btn');
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-testid="boss-intro"]');
  const t0 = Date.now();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="boss-intro"]').click({ force: true });
  await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 5000 });
  expect(Date.now() - t0).toBeLessThan(2500);
  const names = await page.evaluate(() => (window as any).__TC__.events.map((e: { name: string }) => e.name));
  expect(names).toContain('music.boss');
});

test('crowded table: five opponents fit and play', async ({ page }, info) => {
  await openApp(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await startMatch(page, { lineup: ['pip', 'marigold', 'briar', 'hoot', 'nightshade'], seed: '81'.repeat(16), botSeed: '82'.repeat(16) });
  await expect(page.locator('.chip')).toHaveCount(5);
  await page.waitForTimeout(300);
  await page.screenshot({ path: shotPath('five-opponents', info.project.name) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('10. reduced motion removes shake, parallax and ambient petals', async ({ page }) => {
  await openApp(page);
  await tap(page, '[data-testid="settings"]');
  await page.waitForTimeout(400);
  await page.locator('[data-testid="reduced-motion"] [data-value="true"]').click();
  await page.locator('[data-testid="settings-back"]').click();
  await page.waitForSelector('[data-testid="settings-screen"]', { state: 'detached' });
  await page.evaluate(() => { (window as any).__TC__.events.length = 0; });
  await startMatch(page, { lineup: ['briar', 'pip'], seed: '91'.repeat(16), botSeed: '92'.repeat(16) });
  await patch(page, BASE + `
    me.completed = [1,2]; me.phase = 3;
    me.hand = [n(1,1),n(2,2),n(3,4),n(4,7)];
    game.players[1].hand = [{id:20,kind:'skip'},n(21,1),n(22,3),n(23,5)];
    game.players[1].phase = 1; game.players[2].phase = 1;
  `);
  await tap(page, '.hc[data-id="1"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForTimeout(2500);
  await waitIdle(page);
  const names = await page.evaluate(() => (window as any).__TC__.events.map((e: { name: string }) => e.name));
  expect(names).toContain('skip.onHer');
  expect(names).not.toContain('skip.shake');
  expect(names).not.toContain('ambient.petals');
  expect(await page.locator('.petal').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.classList.contains('reduced'))).toBe(true);
});

/**
 * Watches the main thread for any task over the limit, during real-speed set pieces.
 * Each message posts the next directly: a timer between them would add its own 46 ms gap on Windows WebKit.
 */
async function startProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __probe: boolean };
    w.__gaps = [];
    w.__probe = true;
    const ch = new MessageChannel();
    let last = performance.now();
    ch.port1.onmessage = () => {
      const now = performance.now();
      w.__gaps.push(now - last);
      last = now;
      if (w.__probe) ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
  });
}

async function stopProbe(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __probe: boolean };
    w.__probe = false;
    return w.__gaps.reduce((most, gap) => Math.max(most, gap), 0);
  });
}

test('12. performance: no main-thread task over 50 ms in the lay-down and victory sequences', async ({ page }, info) => {
  await openApp(page);
  await startMatch(page, { lineup: ['pip'], seed: 'a1'.repeat(16), botSeed: 'a2'.repeat(16), mode: { kind: 'campaign', stop: 0 } });
  await page.evaluate(() => { const t = (window as any).__TC__; const s = t.getSave(); s.tutorial.done = true; (window as any).__noop = s; });
  await page.locator('[data-testid="coach-skip"]').click().catch(() => {});
  await waitIdle(page);
  await patch(page, BASE + `
    me.hand = [n(1,3),n(2,3,'moss'),n(3,3,'honey'),n(4,9),n(5,9,'moss'),n(6,9,'honey'),n(9,1),n(10,1)];
    game.players[1].phase = 1;
  `);
  await tap(page, '[data-testid="suggest"]');
  await page.waitForTimeout(400);
  // First, prove the probe can see a slow task at all.
  await startProbe(page);
  await page.evaluate(() => { const end = performance.now() + 120; while (performance.now() < end); });
  await page.waitForTimeout(100);
  expect(await stopProbe(page)).toBeGreaterThan(100);

  await startProbe(page);
  await tap(page, '[data-testid="primary"]');
  await page.waitForTimeout(1700);
  const lay = await stopProbe(page);
  await waitIdle(page);

  await patch(page, `
    const me = game.players[0];
    me.completed = [1,2,3,4,5,6,7,8,9]; me.phase = 10; me.laidDown = true;
    me.hand = [{ id: 900, kind: 'num', num: 2, suit: 'rose' }];
    game.round = 12; game.current = 0; game.stage = 'play';
  `);
  await tap(page, '.hc[data-id="900"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForSelector('[data-testid="round-end"], [data-testid="victory"]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="victory"]', { timeout: 30_000 });
  await startProbe(page);
  await page.waitForTimeout(1500);
  const win = await stopProbe(page);
  await page.screenshot({ path: shotPath('victory-stars', info.project.name) });
  console.log(`[perf ${info.project.name}] lay-down longest task ${lay.toFixed(1)} ms, victory ${win.toFixed(1)} ms`);
  expect(lay).toBeLessThanOrEqual(50);
  expect(win).toBeLessThanOrEqual(50);
  const reveal = page.locator('[data-testid="reveal"]');
  await reveal.first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: shotPath('unlock-reveal', info.project.name) });
});

test('boss presentation: intro, lilac candle, moths, tension, and the return to daylight', async ({ page }, info) => {
  test.setTimeout(120_000);
  const p = info.project.name;
  await openApp(page);
  await page.evaluate(() => {
    const t = (window as any).__TC__;
    const s = t.getSave();
    s.campaign.won = [true, true, true, true, false];
    s.campaign.stars = [3, 3, 3, 3, 0];
    s.tutorial.done = true;
    t.loadSave(s);
  });
  await page.screenshot({ path: shotPath('map-boss-open', p) });
  await tap(page, '[data-testid="stop-5"] .stop-btn');
  await page.waitForTimeout(450);
  await page.screenshot({ path: shotPath('boss-match-intro', p) });
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-testid="boss-intro"]');
  await moment(page, 'boss-intro-moths', p, 1200);
  await moment(page, 'boss-intro-title', p, 1800);
  await expect(page.locator('[data-testid="boss-line"]')).toHaveText("So, you've charmed my little garden friends. Now charm me.");
  await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 15_000 });
  await waitIdle(page);
  await expect(page.locator('[data-screen="table"]')).toHaveClass(/boss/);
  await expect(page.locator('[data-screen="table"]')).toHaveAttribute('data-cloth', 'midnight-garden');
  const flame = await page.locator('.fl-o').evaluate((e) => getComputedStyle(e).fill);
  expect(flame.replace(/\s/g, '')).toContain('180,138,224');
  await moment(page, 'boss-table', p, 500);
  await patch(page, `
    const me = game.players[0];
    me.completed = [1,2,3,4,5,6,7,8,9]; me.phase = 10; me.laidDown = true;
    me.hand = [{ id: 900, kind: 'num', num: 2, suit: 'rose' }];
    game.round = 12; game.current = 0; game.stage = 'play';
    game.players[1].phase = 9; game.players[1].completed = [1,2,3,4,5,6,7,8];
  `);
  await tap(page, '.hc[data-id="900"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForSelector('[data-testid="boss-banner"]', { timeout: 30_000 });
  await moment(page, 'boss-defeated', p, 300);
  await expect(page.locator('[data-screen="table"]')).toHaveAttribute('data-cloth', 'blush-gingham');
  await page.waitForSelector('[data-testid="victory"]', { timeout: 15_000 });
});
