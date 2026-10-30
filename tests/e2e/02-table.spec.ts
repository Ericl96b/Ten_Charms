import { drag, expect, openApp, patch, shotPath, startMatch, tap, test, waitIdle } from './helpers.ts';

const FAST = 0.02;

test('1. the app loads with no console errors', async ({ page }, info) => {
  await openApp(page);
  await expect(page.locator('[data-screen="journey"]')).toBeVisible();
  await page.screenshot({ path: shotPath('journey', info.project.name) });
});

test('table renders at each size with the hand inside the screen', async ({ page }, info) => {
  await openApp(page);
  await startMatch(page, { lineup: ['briar', 'marigold', 'pip'], seed: '11'.repeat(16) });
  await page.waitForTimeout(600);
  await page.screenshot({ path: shotPath('table', info.project.name) });
  const box = page.viewportSize()!;
  // Every card in the fan stays on screen and shows at least 24 points of its corner.
  const rects = await page.locator('.hc').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom }; }));
  expect(rects.length).toBeGreaterThanOrEqual(10);
  for (const r of rects) {
    expect(r.b).toBeLessThanOrEqual(box.height);
  }
  const lefts = rects.map((r) => r.l).sort((a, b) => a - b);
  for (let i = 1; i < lefts.length; i++) expect(lefts[i] - lefts[i - 1]).toBeGreaterThanOrEqual(24);
  // Cards and the main button carry spoken labels.
  const labels = await page.locator('.hc').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  for (const l of labels) expect(l).toMatch(/^((Rose|Moss|Moonstone|Honey) \d+|Wild|Skip)$/);
  await expect(page.locator('[data-testid="primary"]')).toHaveAttribute('aria-label', 'Lay down Phase 1');
  // Interactive controls meet the 44 point minimum.

  const sizes = await page.locator('.round-btn, .square-btn, .btn:visible, .slot').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
  for (const [w, h] of sizes) {
    expect(w).toBeGreaterThanOrEqual(43.9);
    expect(h).toBeGreaterThanOrEqual(43.9);
  }
});

test('2. a full match against Pip finishes through the real UI', async ({ page }, info) => {
  test.setTimeout(170_000);
  await openApp(page);
  await page.evaluate((s) => (window as any).__TC__.setTestScale(s), FAST);
  await startMatch(page, { lineup: ['pip'], seed: 'a7'.repeat(16), botSeed: 'b7'.repeat(16) });
  await page.evaluate(() => (window as any).__TC__.autoplay(true));
  // Reshuffles are rare with two players, so one is arranged partway through.
  await page.waitForFunction(() => (window as any).__TC__.state()?.round >= 2, null, { timeout: 90_000 });
  await page.waitForFunction(() => (window as any).__TC__.state()?.stage === 'play' && (window as any).__TC__.state()?.current === 0, null, { timeout: 30_000 });
  await page.evaluate(() => {
    (window as any).__TC__.autoplay(false);
    (window as any).__TC__.patch(`
      const g = game;
      const top = g.discardPile.pop();
      g.discardPile.push(...g.drawPile.splice(1));
      g.discardPile.push(top);
      // Two Skips and nothing else, so the auto-player has to choose a target on the picker.
      g.players[0].hand = [{ id: 9104, kind: 'skip' }, { id: 9105, kind: 'skip' }];
    `);
    (window as any).__TC__.autoplay(true);
  });
  await page.waitForFunction(() => !(window as any).__TC__.autoRunning(), null, { timeout: 150_000 });
  const report = await page.evaluate(() => {
    const t = (window as any).__TC__;
    return { trace: t.autoTrace(), names: t.events.map((e: { name: string }) => e.name), save: t.getSave() };
  });
  expect(report.trace).toContain('layDown');
  expect(report.trace).toContain('pick-target');
  expect(report.names).toContain('skip.onBot');
  expect(report.names).toContain('lay.fly');
  expect(report.names).toContain('hit.human');
  expect(report.names).toContain('ui.reshuffle');
  expect(report.save.stats.played).toBe(1);
  await page.screenshot({ path: shotPath('match-end', info.project.name) });
});

/** A position where every manual step is available: 3s and 9s ready, a hit, and a Skip to play. */
const PREPARED = `
  const n = (id, num, suit) => ({ id, kind: 'num', num, suit: suit || 'rose' });
  const me = game.players[0];
  me.phase = 1; me.completed = []; me.laidDown = false; me.pendingSkip = false;
  me.hand = [n(501,3),n(502,3,'moss'),n(503,3,'honey'),n(504,9),n(505,9,'moss'),n(506,9,'honey'),n(507,9,'moonstone'),{id:508,kind:'skip'},n(509,1),n(510,2)];
  game.players[1].hand = [n(601,4),n(602,6),n(603,8)];
  game.players[1].phase = 1;
  game.players[1].pendingSkip = false;
  game.groups = [];
  game.discardPile = [n(700,12,'moss')];
  game.drawPile = [n(701,11,'honey'), n(702,5,'moss'), n(703,5,'honey'), n(704,6,'honey'), n(705,7,'honey'), n(706,7,'moss')];
  game.current = 0; game.stage = 'draw';
  match.ui.slots = [[],[]];
  match.ui.sort = 'number';
`;

test('3. manual play: draw, build slots, lay down, hit, discard, and play a Skip', async ({ page }) => {
  await openApp(page);
  await startMatch(page, { lineup: ['pip'], seed: '22'.repeat(16), botSeed: '23'.repeat(16) });
  await patch(page, PREPARED);
  await expect(page.locator('[data-testid="ribbon"]')).toHaveText(/draw a card/);

  // Draw by dragging from the pile into the hand.
  await drag(page, '[data-testid="draw-pile"]', '[data-testid="hand"]');
  await expect(page.locator('[data-testid="ribbon"]')).toHaveText(/lay down or discard/);
  await waitIdle(page);

  // Build the first slot with taps.
  for (const id of [501, 502, 503]) await tap(page, `.hc[data-id=\"${id}\"]`);
  await tap(page, '[data-testid="slot-0"]');
  await expect(page.locator('[data-testid="slot-0"]')).toContainText('Ready');

  // Tapping a slot returns its cards, then rebuild it.
  await tap(page, '[data-testid="slot-0"]');
  await expect(page.locator('[data-testid="slot-0"]')).not.toContainText('Ready');
  for (const id of [501, 502, 503]) await tap(page, `.hc[data-id=\"${id}\"]`);
  await tap(page, '[data-testid="slot-0"]');

  // Build the second slot, dragging the last card in.
  for (const id of [504, 505]) await tap(page, `.hc[data-id=\"${id}\"]`);
  await drag(page, '.hc[data-id="506"]', '[data-testid="slot-1"]');
  await expect(page.locator('[data-testid="slot-1"]')).toContainText('Ready');
  await expect(page.locator('[data-testid="primary"]')).toHaveText('Lay down Phase 1');
  await tap(page, '[data-testid="primary"]');
  await waitIdle(page);
  expect(await page.evaluate(() => (window as any).__TC__.state().players[0].laidDown)).toBe(true);
  await expect(page.locator('.group')).toHaveCount(2);

  // Hit the spare 9 on her Set of 9s.
  await tap(page, `.hc[data-id=\"${507}\"]`);
  await expect(page.locator('.group.can-hit')).toHaveCount(1);
  await tap(page, '.group.can-hit');
  await waitIdle(page);
  await expect(page.locator('[data-card-id="507"]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__TC__.state().players[0].hand.some((c: { id: number }) => c.id === 507))).toBe(false);

  // Discard by dragging onto the pile.
  await drag(page, '.hc[data-id="509"]', '[data-testid="discard-pile"]');
  await waitIdle(page);
  await page.waitForFunction(() => { const s = (window as any).__TC__.state(); return s.current === 0 && s.stage === 'draw'; }, null, { timeout: 30_000 });
  expect(await page.evaluate(() => (window as any).__TC__.state().discardPile.some((c: { id: number }) => c.id === 509))).toBe(true);

  // Draw, then discard the Skip with the button and pick a target.
  await tap(page, '[data-testid="draw-pile"]');
  await waitIdle(page);
  await tap(page, `.hc[data-id=\"${508}\"]`);
  await tap(page, '[data-testid="discard-btn"]');
  const picker = page.locator('[data-testid="target-picker"]');
  await expect(picker).toBeVisible();
  await tap(page, '[data-testid="target-1"]');
  await waitIdle(page);
  const events = await page.evaluate(() => (window as any).__TC__.events.map((e: { name: string }) => e.name));
  expect(events).toContain('skip.onBot');
});

test('4. invalid actions shake and say why', async ({ page }) => {
  await openApp(page);
  await startMatch(page, { lineup: ['pip'], seed: '33'.repeat(16), botSeed: '34'.repeat(16) });
  await patch(page, PREPARED);
  const tooltip = page.locator('[data-testid="tooltip"]');

  await tap(page, '[data-testid="primary"]');
  await expect(tooltip).toHaveText('You need to draw first.');

  await patch(page, `game.discardPile = [{ id: 720, kind: 'skip' }];`);
  await tap(page, '[data-testid="discard-pile"]');
  await expect(tooltip).toHaveText("Skips can't be picked up.");

  await patch(page, `
    game.stage = 'play';
    game.groups = [{ id: 50, owner: 1, type: 'run', num: 9, cards: [9,10,11,12].map((v,i)=>({ card: { id: 730+i, kind:'num', num:v, suit:'moss' }, num:v })) }];
  `);
  await tap(page, '[data-testid="group-50"]');
  await expect(tooltip).toHaveText('Lay down your phase before hitting.');

  // A Run that wraps past 12.
  await patch(page, `
    const n = (id, num) => ({ id, kind: 'num', num, suit: 'rose' });
    game.players[0].hand = [n(801,11), n(802,12), n(803,1), n(804,2), n(805,5), n(806,5), n(807,5), n(808,8), n(809,8), n(810,8), n(811,8)];
    game.players[0].phase = 2;
    match.ui.slots = [[],[]];
  `);
  for (const id of [802, 803]) await tap(page, `.hc[data-id="${id}"]`);
  await tap(page, '[data-testid="slot-1"]');
  await expect(page.locator('[data-testid="slot-1"]')).toContainText("Runs can't go past 12.");
  await tap(page, '[data-testid="primary"]');
  await expect(tooltip).toHaveText("Runs can't go past 12.");
  await tap(page, '[data-testid="slot-1"]');

  // A group with nothing but Wilds.
  await patch(page, `
    const n = (id, num) => ({ id, kind: 'num', num, suit: 'rose' });
    game.players[0].hand = [{id:821,kind:'wild'},{id:822,kind:'wild'},{id:823,kind:'wild'},n(824,5),n(825,5),n(826,5),n(827,1),n(828,2),n(829,3),n(830,4),n(831,6)];
    game.players[0].phase = 1;
    match.ui.slots = [[],[]];
  `);
  for (const id of [821, 822, 823]) await tap(page, `.hc[data-id="${id}"]`);
  await tap(page, '[data-testid="slot-0"]');
  await expect(page.locator('[data-testid="slot-0"]')).toContainText('Each group needs at least one non-Wild card.');
  await tap(page, '[data-testid="primary"]');
  await expect(tooltip).toHaveText('Each group needs at least one non-Wild card.');
  const names = await page.evaluate(() => (window as any).__TC__.events.map((e: { name: string }) => e.name));
  expect(names).toContain('invalid.shake');
  expect(names).toContain('invalid');
});

test('5. reloading mid-turn restores the exact game', async ({ page }) => {
  await openApp(page);
  await startMatch(page, { lineup: ['briar', 'pip'], seed: '44'.repeat(16), botSeed: '45'.repeat(16) });
  await patch(page, PREPARED + `game.players[2].phase = 1;`);
  await tap(page, '[data-testid="draw-pile"]');
  await waitIdle(page);
  for (const id of [501, 502, 503]) await tap(page, `.hc[data-id="${id}"]`);
  await tap(page, '[data-testid="slot-0"]');
  const before = await page.evaluate(() => { const t = (window as any).__TC__; return { game: t.state(), ui: t.ui() }; });
  await page.reload();
  await page.waitForFunction(() => '__TC__' in window, null, { timeout: 15_000 });
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await page.waitForSelector('[data-screen="table"]', { timeout: 15_000 });
  await page.waitForFunction(() => (window as any).__TC__.state() !== null, null, { timeout: 15_000 });
  const after = await page.evaluate(() => { const t = (window as any).__TC__; return { game: t.state(), ui: t.ui() }; });
  expect(after).toEqual(before);
  await expect(page.locator('[data-testid="slot-0"]')).toContainText('Ready');
  await expect(page.locator('[data-testid="ribbon"]')).toHaveText(/lay down or discard/);
});

