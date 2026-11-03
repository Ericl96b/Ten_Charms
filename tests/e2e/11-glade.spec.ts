// The Moonlit Glade: the map, the fork, the fog, the Thorned Crown, and getting through to the boss.
import type { Page } from '@playwright/test';
import { expect, openApp, patch, prepare, saveEventLog, startMatch, tap, test, waitIdle } from './helpers.ts';

type Rect = { left: number; top: number; right: number; bottom: number; name: string };
const overlap = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const MOONLIT = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** Map 1 complete, the reveal seen, and the Glade at a given point. */
async function gladeSave(page: Page, winOrder: string[], extra: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(([order, more]) => {
    const t = (window as any).__TC__;
    const s = t.getSave();
    s.match = null;
    s.tutorial.done = true;
    s.backupPrompted = true;
    s.campaign.won = [true, true, true, true, true];
    s.campaign.stars = [3, 3, 3, 3, 3];
    s.glade = { ...s.glade, winOrder: order, stars: Object.fromEntries((order as string[]).map((id) => [id, 1])), revealSeen: true, lastMap: 'glade', ...(more as object) };
    t.loadSave(s);
  }, [winOrder, extra] as const);
  await page.waitForSelector('[data-map="glade"]');
  // The Play button is placed on the next frame, once the map has its size.
  await page.waitForFunction(() => !document.querySelector('.stop-cta') || !!document.querySelector('.stop-cta[data-side]'));
}

const stopState = (page: Page, id: string) => page.locator(`[data-testid="glade-${id}"]`).getAttribute('data-state');

/** One discard from winning the match, on a chosen round, on the last Moonlit phase. */
async function winFromTable(page: Page, round: number): Promise<void> {
  // Idle and her turn: a boss intro can report idle before the table has even started. Lunaria's wisps skip her
  // whenever they can, so a round can even end before her first turn; then the next one starts.
  const deadline = Date.now() + 90_000;
  for (;;) {
    const where = await page.evaluate(() => {
      const t = (window as any).__TC__;
      const s = t.state();
      if (!s || document.querySelector('[data-testid="boss-intro"]') || !t.idle()) return 'busy';
      if (s.stage === 'roundOver') return 'roundOver';
      return s.current === 0 && (s.stage === 'draw' || s.stage === 'play') ? 'ready' : 'busy';
    });
    if (where === 'ready') break;
    if (where === 'roundOver' && await page.locator('[data-testid="next-round"]').count()) await page.locator('[data-testid="next-round"]').click();
    if (Date.now() > deadline) throw new Error('Her turn never came');
    await page.waitForTimeout(150);
  }
  await patch(page, `
    const me = game.players[0];
    me.completed = ${JSON.stringify(MOONLIT.slice(0, -1))}; me.phase = 20; me.laidDown = true;
    me.hand = [{ id: 900, kind: 'num', num: 2, suit: 'rose' }];
    game.round = ${round}; game.current = 0; game.stage = 'play';
  `);
  await tap(page, '.hc[data-id="900"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForSelector('[data-testid="victory"]', { timeout: 30_000 });
}

async function finishVictory(page: Page): Promise<{ unlocks: number; charms: number }> {
  let unlocks = 0, charms = 0;
  for (let i = 0; i < 80; i++) {
    if (await page.locator('[data-testid="continue"]').count()) break;
    if (await page.locator('[data-testid="reveal"]').count()) { await page.locator('[data-testid="reveal"]').click({ force: true }); unlocks++; }
    else if (await page.locator('[data-testid="reveal-charm"]').count()) { await page.locator('[data-testid="reveal-charm"]').click({ force: true }); charms++; }
    else await page.waitForTimeout(100);
  }
  await page.locator('[data-testid="continue"]').click();
  await page.waitForSelector('[data-screen="journey"]');
  return { unlocks, charms };
}

async function playGlade(page: Page, id: string, round: number): Promise<{ unlocks: number; charms: number }> {
  await tap(page, `[data-testid="glade-${id}"] .stop-btn`);
  await expect(page.locator('[data-testid="match-intro"]')).toBeVisible();
  await tap(page, '[data-testid="begin"]');
  if (id === 'g3') await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 20_000 });
  await page.waitForSelector('[data-screen="table"]');
  await winFromTable(page, round);
  return finishVictory(page);
}

test('glade: the reveal plays once, then the map switcher remembers the map', async ({ page }, info) => {
  // A reload starts a fresh event log, so keep what each page fired before reloading.
  const keepLog = () => saveEventLog(page, info.project.name, info.workerIndex);
  // A save from before the update, with Nightshade beaten.
  await page.addInitScript(() => {
    if (!localStorage.getItem('ten-charms.save')) {
      localStorage.setItem('ten-charms.save', JSON.stringify({ schema: 1, install: { dismissedAt: Date.now() }, campaign: { won: [true, true, true, true, true], stars: [3, 3, 2, 3, 1], bestRounds: [9, 10, 12, 11, 13] }, tutorial: { done: true, seen: [] }, backupPrompted: true }));
    }
  });
  await page.goto('/');
  await page.waitForFunction(() => '__TC__' in window);
  await expect(page.locator('[data-testid="reveal-banner"]')).toHaveText('A path appears beyond the garden…', { timeout: 15_000 });
  await page.waitForSelector('[data-map="glade"]', { timeout: 15_000 });
  const s = await page.evaluate(() => (window as any).__TC__.getSave());
  expect(s.glade.revealSeen).toBe(true);
  expect(s.campaign.stars).toEqual([3, 3, 2, 3, 1]);
  const names = await page.evaluate(() => (window as any).__TC__.events.map((e: { name: string }) => e.name));
  expect(names).toContain('glade.reveal');

  // It never replays, and the app reopens to the map last viewed.
  await keepLog();
  await page.reload();
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await expect(page.locator('[data-map="glade"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="reveal-banner"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="total-stars"]')).toContainText('0 / 21');
  await tap(page, '[data-testid="map-garden"]');
  await page.waitForSelector('[data-map="garden"]');
  await expect(page.locator('[data-testid="total-stars"]')).toContainText('12 / 15');
  await expect(page.locator('[data-testid="map-garden"]')).toContainText('12/15');
  await expect(page.locator('[data-testid="map-glade"]')).toContainText('0/21');
  await keepLog();
  await page.reload();
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await expect(page.locator('[data-map="garden"]')).toHaveCount(1);
  const events = await page.evaluate(() => (window as any).__TC__.events.map((e: { name: string }) => e.name));
  expect(events).not.toContain('glade.reveal');
});

test('glade: before Nightshade falls, the switcher shows the Glade locked', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('[data-testid="map-glade"]')).toContainText('Beat Nightshade to unlock.');
  await tap(page, '[data-testid="map-glade"]');
  await expect(page.locator('[data-testid="tooltip"]')).toContainText('Beat Nightshade to unlock.');
  await expect(page.locator('[data-map="garden"]')).toHaveCount(1);
});

test('glade: the Play button follows the open-stop rules in every case', async ({ page }) => {
  await openApp(page);
  const ROWS: [string[], string | null, string[]][] = [
    [[], 'g1', []],
    [['g1'], 'a1', ['b1']],
    [['g1', 'b1'], 'b2', ['a1']],
    [['g1', 'b1', 'a1'], 'a2', ['b2']],
    [['g1', 'a1', 'b1'], 'b2', ['a2']],
    [['g1', 'a1', 'a2'], 'g2', ['b1']],
    [['g1', 'a1', 'a2', 'g2', 'g3'], 'b1', []],
  ];
  for (const [won, play, open] of ROWS) {
    await gladeSave(page, won);
    await expect(page.locator('[data-testid="play"]')).toHaveCount(1);
    expect(await stopState(page, play!)).toBe('current');
    for (const id of open) expect(await stopState(page, id), `${won.join(',')}: ${id}`).toBe('open');
    for (const id of won) expect(await stopState(page, id)).toBe('won');
    const others = ['g1', 'a1', 'a2', 'b1', 'b2', 'g2', 'g3'].filter((id) => id !== play && !open.includes(id) && !won.includes(id));
    for (const id of others) expect(await stopState(page, id)).toBe('locked');
    // Every stop she can play opens its Match Intro, won or open.
    for (const id of [...open, ...won].slice(0, 2)) {
      await tap(page, `[data-testid="glade-${id}"] .stop-btn`);
      await expect(page.locator('[data-testid="match-intro"]')).toBeVisible();
      await page.locator('.backdrop').last().click({ position: { x: 5, y: 5 }, force: true });
      await page.waitForTimeout(300);
    }
  }
  // All seven won: no Play button, as on the Rose Garden.
  await gladeSave(page, ['g1', 'a1', 'a2', 'b1', 'b2', 'g2', 'g3']);
  await expect(page.locator('[data-testid="play"]')).toHaveCount(0);
});

test('glade: the Play button and reward chip stay on screen and clear of everything, for every stop', async ({ page }) => {
  await openApp(page);
  const CURRENT: Record<string, string[]> = {
    g1: [], a1: ['g1'], a2: ['g1', 'a1'], b1: ['g1', 'a1', 'a2', 'g2', 'g3'], b2: ['g1', 'b1'], g2: ['g1', 'a1', 'a2'], g3: ['g1', 'a1', 'a2', 'g2'],
  };
  for (const [id, won] of Object.entries(CURRENT)) {
    await gladeSave(page, won);
    await page.waitForTimeout(200);
    expect(await stopState(page, id)).toBe('current');
    const m = await page.evaluate(() => {
      const rect = (el: Element, name: string) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, name }; };
      const others: { left: number; top: number; right: number; bottom: number; name: string }[] = [];
      document.querySelectorAll('.gstop').forEach((stop) => {
        stop.querySelectorAll('.stop-medal, .stars, .name-plate, .boss-plate, .mist-wings').forEach((el) => others.push(rect(el, `${stop.getAttribute('data-testid')} ${el.className}`)));
      });
      document.querySelectorAll('.signpost .board').forEach((el) => others.push(rect(el, 'signpost')));
      others.push(rect(document.querySelector('.map-top')!, 'top bar'), rect(document.querySelector('.bottom-nav')!, 'bottom nav'));
      return { play: rect(document.querySelector('[data-testid="play"]')!, 'play'), chip: rect(document.querySelector('[data-testid="reward-chip"]')!, 'chip'), others, width: innerWidth, height: innerHeight };
    });
    for (const r of [m.play, m.chip]) {
      expect(r.left, `${id} ${r.name} left`).toBeGreaterThanOrEqual(0);
      expect(r.right, `${id} ${r.name} right`).toBeLessThanOrEqual(m.width);
      expect(r.top, `${id} ${r.name} top`).toBeGreaterThanOrEqual(0);
      expect(r.bottom, `${id} ${r.name} bottom`).toBeLessThanOrEqual(m.height);
      for (const o of m.others) expect(overlap(r, o), `${id}: ${r.name} overlaps ${o.name}`).toBe(false);
    }
  }
});

test('glade: the whole map fits on one screen on big phones, and the signpost clears every stop', async ({ page }, info) => {
  await openApp(page);
  for (const state of [{}, { fogLifted: true }]) {
    await gladeSave(page, ['g1', 'a1'], state);
    const fit = await page.evaluate(() => { const s = document.querySelector('.map-scroll')!; return { scroll: s.scrollHeight, client: s.clientHeight }; });
    if (['max', 'android'].includes(info.project.name)) expect(fit.scroll, 'the map fits without scrolling').toBeLessThanOrEqual(fit.client + 1);
    await expect(page.locator('[data-testid="signpost"]')).toHaveCount(1);
    await expect(page.locator('.signpost .board')).toHaveText(['Lantern Lane', 'Lily Pond']);
    const clash = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.signpost .board, .signpost .post')].map((el) => el.getBoundingClientRect());
      const parts = [...document.querySelectorAll('.gstop .stop-medal, .gstop .stars, .gstop .name-plate, .gstop .boss-plate, [data-testid="play"], [data-testid="reward-chip"]')];
      const hit: string[] = [];
      for (const p of parts) {
        const r = p.getBoundingClientRect();
        for (const b of boxes) if (b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) hit.push(p.className);
      }
      return hit;
    });
    expect(clash).toEqual([]);
    expect(await page.locator('.signpost').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  }
});

/** Lets the clouds be hit-tested, so a point that lands on a cloud is caught rather than passed through. */
async function cloudsSolid(page: Page): Promise<void> {
  await page.addStyleTag({ content: '.fog, .fog .cloud { pointer-events: auto !important; }' });
}

async function topmostCheck(page: Page, selectors: string[]): Promise<string[]> {
  return page.evaluate((sels) => {
    const bad: string[] = [];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (r.width === 0) continue;
        // On a map that scrolls, only what is in view counts; the rest is behind the bars, as it should be.
        const view = (el.closest('.map-scroll') ?? document.documentElement).getBoundingClientRect();
        if (y < view.top || y > view.bottom || y > innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest('.fog')) { bad.push(`${sel} covered by a cloud`); continue; }
        // A card in the fan is mostly covered by its neighbor by design.
        if (el.matches('.hc') && hit?.closest('.hand')) continue;
        if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) bad.push(`${sel} under ${String(hit?.className)}`);
      }
    }
    return bad;
  }, selectors);
}

test('glade: fog layering — no cloud ever covers a stop, card, pile, chip, button or the Phase Panel', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await gladeSave(page, ['g1', 'a1', 'a2', 'g2']);
  await expect(page.locator('.fog .cloud').first()).toBeAttached();
  // A cloud sits over every part of the screen at some moment; check several moments.
  for (let i = 0; i < 3; i++) {
    await cloudsSolid(page);
    expect(await topmostCheck(page, ['.gstop .stop-btn', '[data-testid="play"]', '[data-testid="reward-chip"]', '.map-top button', '.nav-item'])).toEqual([]);
    await page.waitForTimeout(700);
  }
  // Taps reach what is under the clouds.
  await tap(page, '[data-testid="glade-a1"] .stop-btn');
  await expect(page.locator('[data-testid="match-intro"]')).toBeVisible();
  await page.locator('.backdrop').last().click({ position: { x: 5, y: 5 }, force: true });
  await page.waitForTimeout(300);

  for (const [lineup, stop] of [[['velvet', 'mallow', 'briar'], 'a2'], [['puff', 'lunaria', 'haze'], 'g3']] as const) {
    await page.evaluate(() => { const t = (window as any).__TC__; const s = t.getSave(); s.match = null; t.loadSave(s); });
    await startMatch(page, { lineup, seed: 'ce'.repeat(16), botSeed: 'cf'.repeat(16), variant: 'moonlit', mode: { kind: 'glade', stop }, cloth: stop === 'g3' ? 'mistveil' : 'blush-gingham' });
    await expect(page.locator('.table-screen.fogged .fog .cloud').first()).toBeAttached();
    await patch(page, `
      const n = (id, num, suit) => ({ card: { id, kind: 'num', num, suit } });
      game.players[2].laidDown = true;
      game.groups = [{ id: 701, owner: 2, type: 'evens', cards: [n(801, 2, 'rose'), n(802, 4, 'moss'), n(803, 6, 'honey'), n(804, 8, 'rose')] }];
    `);
    for (let i = 0; i < 3; i++) {
      await cloudsSolid(page);
      expect(await topmostCheck(page, ['.hc', '.pile', '.chip', '[data-testid="phase-panel"]', '.group', '[data-testid="primary"]', '[data-testid="discard-btn"]', '[data-testid="menu"]', '[data-testid="review"]', '[data-testid="sort"]'])).toEqual([]);
      await page.waitForTimeout(700);
    }
    await tap(page, '[data-testid="menu"]');
    await expect(page.locator('[data-testid="resume"]')).toBeVisible();
    await tap(page, '[data-testid="resume"]');
    await page.waitForTimeout(300);
  }
});

test('glade: the clouds drift, and stand still but stay visible under Reduced Motion', async ({ page }) => {
  await openApp(page);
  await gladeSave(page, ['g1']);
  const positions = () => page.evaluate(() => [...document.querySelectorAll('.fog .cloud')].map((c) => Math.round(c.getBoundingClientRect().left)));
  const a = await positions();
  await page.waitForTimeout(2000);
  const b = await positions();
  expect(a.length).toBeGreaterThan(10);
  expect(b.filter((x, i) => x !== a[i]).length, 'clouds move over 2 s').toBeGreaterThan(a.length / 2);

  await page.evaluate(() => { const t = (window as any).__TC__; const s = t.getSave(); s.settings.reducedMotion = true; t.loadSave(s); });
  await page.reload();
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await page.waitForSelector('[data-map="glade"] ~ .fog .cloud, .fog .cloud');
  const c = await positions();
  await page.waitForTimeout(2000);
  const d = await positions();
  expect(c.length).toBeGreaterThan(10);
  expect(d).toEqual(c);
  const visible = await page.evaluate(() => [...document.querySelectorAll('.fog .cloud')].filter((el) => {
    const r = el.getBoundingClientRect();
    return Number(getComputedStyle(el).opacity) > 0.2 && r.right > 0 && r.left < innerWidth;
  }).length);
  expect(visible).toBeGreaterThan(4);
});

test('glade: no fog on the lifted map, after the lift, on Map 1, or in Free Play', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await gladeSave(page, ['g1', 'a1', 'a2', 'g2', 'g3'], { fogLifted: true });
  await expect(page.locator('.fog')).toHaveCount(0);
  await expect(page.locator('.glade-inner.lifted')).toHaveCount(1);
  const toMap = () => page.evaluate(() => { const t = (window as any).__TC__; const s = t.getSave(); s.match = null; t.loadSave(s); });
  const cases: Record<string, unknown>[] = [
    { lineup: ['puff', 'lunaria', 'haze'], variant: 'moonlit', mode: { kind: 'glade', stop: 'g3' }, cloth: 'mistveil' },
    { lineup: ['mallow', 'lumi', 'marigold'], variant: 'moonlit', mode: { kind: 'glade', stop: 'a1' } },
    { lineup: ['briar', 'marigold', 'pip'], mode: { kind: 'campaign', stop: 2 } },
    { lineup: ['lumi', 'sable'], variant: 'moonlit', mode: { kind: 'free' } },
  ];
  for (const c of cases) {
    await toMap();
    await startMatch(page, { seed: 'da'.repeat(16), botSeed: 'db'.repeat(16), ...c });
    await expect(page.locator('.table-screen')).toHaveCount(1);
    await expect(page.locator('.table-screen.fogged, .fog, [data-testid="fog-wisp"]')).toHaveCount(0);
    await expect(page.locator('.chip-count').first()).toHaveText(/\d+/);
  }
  // Fog never covers a Glade match in Free Play, even before it lifts.
  await toMap();
  await gladeSave(page, ['g1']);
  await startMatch(page, { seed: 'dc'.repeat(16), botSeed: 'dd'.repeat(16), lineup: ['lumi'], variant: 'moonlit', mode: { kind: 'free' } });
  await expect(page.locator('.fog')).toHaveCount(0);
});

test('glade: in the fog, every count is hidden, the picker shows no counts, and the intro shows the rule', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await gladeSave(page, ['g1']);
  await tap(page, '[data-testid="glade-a1"] .stop-btn');
  await expect(page.locator('[data-testid="rule-fog"]')).toHaveText('Moonlit Fog — card counts are hidden.');
  await expect(page.locator('[data-testid="rule-crown"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="star-targets"]')).toContainText('rounds or fewer');
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-screen="table"]');
  await waitIdle(page);
  await expect(page.locator('[data-testid="fog-wisp"]')).toHaveCount(3);
  await expect(page.locator('.chip-count')).toHaveCount(0);
  for (const chip of await page.locator('.chip-info').allTextContents()) expect(chip).toMatch(/^Ph \d+ · $/);
  await patch(page, `
    const me = game.players[0];
    me.hand = [{ id: 950, kind: 'skip' }, { id: 951, kind: 'num', num: 3, suit: 'rose' }];
    game.current = 0; game.stage = 'play';
  `);
  await tap(page, '.hc[data-id="950"]');
  await tap(page, '[data-testid="discard-btn"]');
  await expect(page.locator('[data-testid="target-picker"]')).toBeVisible();
  for (const row of await page.locator('[data-testid="target-picker"] .target small').allTextContents()) {
    expect(row).toMatch(/^Phase \d+( · already skipped)?$/);
    expect(row).not.toMatch(/card/);
  }
  // Phase labels show 1 to 10, never the Moonlit ids.
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/(Phase|Ph) (1[1-9]|20)\b/);
});

test('glade: the Thorned Crown blocks hits on her groups and shows at every table she plays', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await gladeSave(page, ['g1', 'a1', 'a2', 'g2']);
  await tap(page, '[data-testid="glade-g3"] .stop-btn');
  await expect(page.locator('[data-testid="rule-crown"]')).toHaveText("Thorned Crown — no one can add to Lunaria's groups.");
  await page.locator('.backdrop').last().click({ position: { x: 5, y: 5 }, force: true });
  await page.waitForTimeout(300);
  const setUp = `
    const n = (id, num, suit) => ({ card: { id, kind: 'num', num, suit } });
    for (const s of [0, 2]) { game.players[s].laidDown = true; }
    game.groups = [
      { id: 711, owner: 2, type: 'set', num: 7, cards: [n(811, 7, 'rose'), n(812, 7, 'moss'), n(813, 7, 'honey')] },
      { id: 712, owner: 0, type: 'set', num: 5, cards: [n(814, 5, 'rose'), n(815, 5, 'moss')] },
    ];
    game.players[0].hand = [{ id: 960, kind: 'num', num: 7, suit: 'moonstone' }, { id: 961, kind: 'num', num: 5, suit: 'honey' }, { id: 962, kind: 'num', num: 1, suit: 'rose' }];
    game.current = 0; game.stage = 'play';
  `;
  for (const [mode, lineup, crownSeat] of [
    [{ kind: 'glade', stop: 'g3' }, ['puff', 'lunaria', 'haze'], 2],
    [{ kind: 'free' }, ['briar', 'lunaria'], 2],
  ] as const) {
    await page.evaluate(() => { const t = (window as any).__TC__; const s = t.getSave(); s.match = null; t.loadSave(s); });
    await startMatch(page, { seed: 'ea'.repeat(16), botSeed: 'eb'.repeat(16), lineup, variant: 'moonlit', mode, cloth: 'mistveil' });
    await waitIdle(page);
    await patch(page, setUp);
    await expect(page.locator(`[data-testid="chip-${crownSeat}"] [data-testid="chip-crown"]`)).toHaveCount(1);
    await expect(page.locator(`.laid-row[data-seat="${crownSeat}"] [data-testid="label-crown"]`)).toHaveCount(1);
    await expect(page.locator('[data-group-id="711"] [data-testid="thorn-border"]')).toHaveCount(1);
    await expect(page.locator('[data-group-id="712"] [data-testid="thorn-border"]')).toHaveCount(0);
    // Selecting a card that would fit her Set: her group never glows.
    await tap(page, '.hc[data-id="960"]');
    await expect(page.locator('[data-group-id="711"]')).not.toHaveClass(/can-hit/);
    await expect(page.locator('[data-group-id="712"]')).not.toHaveClass(/can-hit/);
    await tap(page, '[data-group-id="711"]');
    await expect(page.locator('[data-testid="tooltip"]')).toHaveText("No one can add to Lunaria's groups.");
    const s = await page.evaluate(() => (window as any).__TC__.state());
    expect(s.groups.find((g: { id: number }) => g.id === 711).cards).toHaveLength(3);
    expect(s.players[0].hand).toHaveLength(3);
    const names = await page.evaluate(() => (window as any).__TC__.events.map((e: { name: string }) => e.name));
    expect(names).toContain('crown.thornBlock');
    expect(names).toContain('thornBlock');
  }
});

test('glade: the worst-case boss row fits on one row at 412 points', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await gladeSave(page, ['g1', 'a1', 'a2', 'g2']);
  await startMatch(page, { seed: 'fa'.repeat(16), botSeed: 'fb'.repeat(16), lineup: ['puff', 'lunaria', 'haze'], variant: 'moonlit', mode: { kind: 'glade', stop: 'g3' }, cloth: 'mistveil' });
  await waitIdle(page);
  await patch(page, `
    const n = (id, num, suit) => ({ card: { id, kind: 'num', num, suit } });
    const w = (id) => ({ card: { id, kind: 'wild' } });
    for (const s of [0, 1, 2, 3]) { game.players[s].laidDown = true; game.players[s].phase = 12; }
    game.round = 11;
    game.groups = [
      { id: 721, owner: 2, type: 'odds', cards: [n(821, 1, 'honey'), n(822, 3, 'rose'), n(823, 5, 'moss'), w(824), n(825, 9, 'moonstone'), n(826, 11, 'moss')] },
      { id: 722, owner: 2, type: 'evens', cards: [n(827, 2, 'honey'), n(828, 4, 'rose'), n(829, 8, 'moss'), n(830, 12, 'moonstone')] },
    ];
  `);
  const tops = await page.evaluate(() => [...document.querySelectorAll('.laid-row[data-seat="2"] .group')].map((g) => Math.round(g.getBoundingClientRect().top)));
  expect(tops).toHaveLength(2);
  if ((page.viewportSize()?.width ?? 0) >= 412) expect(tops[0]).toBe(tops[1]);
});

test('glade: both paths lead through the Old Stones to the boss, and the fog lifts for good', async ({ page }) => {
  test.setTimeout(170_000);
  await openApp(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await gladeSave(page, []);
  const save = () => page.evaluate(() => (window as any).__TC__.getSave());

  // G1 opens both lanes and Moonlit Phases in Free Play.
  const g1 = await playGlade(page, 'g1', 1);
  expect(g1.unlocks).toBe(2);
  expect(await stopState(page, 'a1')).toBe('current');
  expect(await stopState(page, 'b1')).toBe('open');
  let s = await save();
  expect(s.glade.stars.g1).toBe(3);
  expect(s.charms).toContain('fog-walker');
  expect(s.charms).toContain('moonlit-mastery');

  // Lily Pond first this time, then Lantern Lane.
  await playGlade(page, 'b1', 40);
  expect(await stopState(page, 'b2')).toBe('current');
  await playGlade(page, 'b2', 40);
  expect(await stopState(page, 'g2')).toBe('current');
  expect(await stopState(page, 'a1')).toBe('open');
  await playGlade(page, 'a1', 40);
  await playGlade(page, 'a2', 40);
  s = await save();
  expect(s.charms).toContain('both-paths');
  for (const item of ['lantern-glow', 'bunny-hop', 'lily-pad', 'firefly-meadow', 'trinket-quilt']) {
    await tap(page, '[data-testid="nav-collection"]');
    if (item.includes('meadow') || item.includes('quilt')) await tap(page, '[data-testid="tab-cloth"]');
    await expect(page.locator(`[data-testid="item-${item}"]`)).toHaveAttribute('data-unlocked', '1');
    await tap(page, '[data-testid="nav-journey"]');
  }

  await playGlade(page, 'g2', 40);
  s = await save();
  expect(s.glade.winOrder).toEqual(['g1', 'b1', 'b2', 'a1', 'a2', 'g2']);
  await expect(page.locator('.fog')).toHaveCount(1);

  // The boss: a win lifts the fog, the scene plays once, and replays stay clear.
  const boss = await playGlade(page, 'g3', 40);
  expect(boss.unlocks).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-testid="lift-banner"]')).toContainText('The fog has lifted!');
  await expect(page.locator('[data-testid="lift-banner"]')).toContainText('Card counts are now visible across the Glade.');
  await expect(page.locator('.fog')).toHaveCount(0, { timeout: 15_000 });
  s = await save();
  expect(s.glade.fogLifted).toBe(true);
  expect(s.glade.liftScenePending).toBe(false);
  expect(s.charms).toEqual(expect.arrayContaining(['dawnbringer', 'thornproof']));
  const names = await page.evaluate(() => (window as any).__TC__.events.map((e: { name: string }) => e.name));
  for (const n of ['lunaria.intro', 'lunaria.dissolve', 'fog.lift', 'fog.bloom', 'fogLift', 'music.lunaria', 'music.gladeLift']) expect(names).toContain(n);

  await tap(page, '[data-testid="glade-g3"] .stop-btn');
  await expect(page.locator('[data-testid="rule-fog"]')).toHaveCount(0);
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 20_000 });
  await waitIdle(page);
  await expect(page.locator('.fog, [data-testid="fog-wisp"]')).toHaveCount(0);
  await expect(page.locator('.chip-count').first()).toHaveText(/\d+/);
  await winFromTable(page, 40);
  await finishVictory(page);
  await expect(page.locator('[data-testid="lift-banner"]')).toHaveCount(0);

  // Free Play now has the Moonlit variant, the Glade's bots and Lunaria, and no wisps.
  await tap(page, '[data-testid="nav-free"]');
  await expect(page.locator('[data-testid="fp-variant-moonlit"]')).toHaveCount(1);
  for (const b of ['lumi', 'mallow', 'velvet', 'fennel', 'sable', 'mossback', 'lunaria']) await expect(page.locator(`[data-testid="fp-bot-${b}"]`)).toHaveCount(1);
  await expect(page.locator('[data-testid="fp-bot-puff"], [data-testid="fp-bot-haze"]')).toHaveCount(0);
});

test('glade: Sunrise Garden, the Glade Charms heading, How to Play and Stats', async ({ page }) => {
  await openApp(page);
  await gladeSave(page, ['g1', 'a1', 'a2', 'b1', 'b2', 'g2', 'g3'], { fogLifted: true, stars: { g1: 3, a1: 3, a2: 3, b1: 3, b2: 3, g2: 3, g3: 3 } });
  await expect(page.locator('[data-testid="total-stars"]')).toContainText('21 / 21');
  await tap(page, '[data-testid="nav-collection"]');
  await tap(page, '[data-testid="tab-cloth"]');
  await expect(page.locator('[data-testid="item-sunrise-garden"]')).toHaveAttribute('data-unlocked', '1');
  await tap(page, '[data-testid="tab-charms"]');
  await expect(page.locator('.glade-sec')).toHaveText('Moonlit Glade');
  await expect(page.locator('[data-testid="charm-grid-glade"] .charm-item')).toHaveCount(5);
  await expect(page.locator('[data-testid="charm-grid"] .charm-item')).toHaveCount(10);
  await tap(page, '[data-testid="nav-stats"]');
  for (const b of ['lumi', 'mallow', 'velvet', 'fennel', 'sable', 'mossback', 'lunaria']) await expect(page.locator(`.bot-stat[data-bot="${b}"]`)).toHaveCount(1);
  await expect(page.locator('.bot-stat[data-bot="puff"]')).toHaveCount(0);
  await tap(page, '[data-testid="nav-journey"]');
  await tap(page, '[data-testid="glade-g1"] .stop-btn');
  await page.locator('.backdrop').last().click({ position: { x: 5, y: 5 }, force: true });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const t = (window as any).__TC__; t.startMatch({ lineup: ['lumi'], variant: 'moonlit', mode: { kind: 'free' } }); });
  await page.waitForSelector('[data-screen="table"]');
  await tap(page, '[data-testid="menu"]');
  await page.getByText('How to Play').click();
  await expect(page.locator('[data-testid="moonlit-phases"]')).toBeVisible();
  await expect(page.locator('[data-testid="moonlit-phases"] li')).toHaveCount(10);
});

test('glade: new rewards on the table, and the Moonlight Waltz', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await gladeSave(page, ['g1', 'a1', 'b1', 'b2', 'g2']);
  await page.evaluate(() => { const t = (window as any).__TC__; const s = t.getSave(); s.equipped = { back: 'bunny-hop', cloth: 'trinket-quilt', music: 'moonlight-waltz' }; t.loadSave(s); });
  await tap(page, '[data-testid="glade-a2"] .stop-btn');
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-screen="table"]');
  await expect(page.locator('.table-screen')).toHaveAttribute('data-back', 'bunny-hop');
  await expect(page.locator('.table-screen')).toHaveAttribute('data-cloth', 'trinket-quilt');
  await expect(page.locator('.pile.draw .b-bunny-hop').first()).toBeAttached();
  const names = await page.evaluate(() => (window as any).__TC__.events.map((e: { name: string }) => e.name));
  expect(names).toContain('music.moonwaltz');
});

void prepare;
