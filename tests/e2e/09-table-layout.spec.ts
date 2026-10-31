import { appendFileSync, mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { LINEUPS, openFixture, simulateInsets, visibleRows, type FixtureName } from './fixtures.ts';
import { expect, openApp, patch, startMatch, tap, test, waitIdle } from './helpers.ts';

const FIXTURES = Object.keys(LINEUPS) as FixtureName[];
/**
 * What a real phone gives up at each size. The Android figure stands in for Chrome's toolbars in a tab,
 * since the height lost there is about the same as an inset of that size.
 */
const INSETS: Record<string, { top: number; bottom: number }> = {
  se: { top: 20, bottom: 0 },
  ref: { top: 47, bottom: 34 },
  max: { top: 62, bottom: 34 },
  android: { top: 0, bottom: 104 },
};

/** The fewest rows each fixture must show without scrolling, at each viewport. */
const REQUIRED: Record<string, Record<FixtureName, number>> = {
  se: { worst: 2, two: 2, duel: 2 },
  ref: { worst: 3, two: 3, duel: 2 },
  android: { worst: 3, two: 3, duel: 2 },
  max: { worst: 4, two: 3, duel: 2 },
};

const scrollLaid = (page: Page, where: 'top' | 'middle' | 'bottom') => page.evaluate((w) => {
  const l = document.querySelector('.laid')!;
  const most = l.scrollHeight - l.clientHeight;
  l.scrollTop = w === 'top' ? 0 : w === 'middle' ? most / 2 : most;
}, where);

const names = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__TC__.events.map((e: { name: string }) => e.name));

for (const name of FIXTURES) {
  test(`${name} fixture: rows, clipping and fades`, async ({ page }, info) => {
    const p = info.project.name;
    await openApp(page);
    await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
    await openFixture(page, name);
    await page.waitForTimeout(250);

    const rows = await visibleRows(page);
    mkdirSync('test-results', { recursive: true });
    appendFileSync('test-results/rows.log', `${name} ${p} plain ${rows}\n`);
    expect(rows).toBeGreaterThanOrEqual(REQUIRED[p][name]);
    mkdirSync('qa-screenshots/cr01/table', { recursive: true });
    await page.screenshot({ path: `qa-screenshots/cr01/table/${name}-${p}-after.png` });

    // The hit glow still finds Marigold's run, and nothing else.
    await expect(page.locator('.group.can-hit')).toHaveCount(1);
    await expect(page.locator('.group.can-hit')).toHaveAttribute('data-group-id', '103');

    for (const where of ['top', 'middle', 'bottom'] as const) {
      await scrollLaid(page, where);
      await page.waitForTimeout(80);
      const state = await page.evaluate(() => {
        const laid = document.querySelector<HTMLElement>('.laid')!;
        const area = laid.getBoundingClientRect();
        const labels = [...document.querySelectorAll('.pile-label')];
        return {
          clear: labels.every((l) => l.getBoundingClientRect().bottom <= area.top),
          onTop: labels.every((l) => {
            const r = l.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !!hit && !hit.closest('.laid');
          }),
          clipped: getComputedStyle(laid).overflowY !== 'visible',
          above: laid.scrollTop > 1,
          below: laid.scrollTop + laid.clientHeight < laid.scrollHeight - 1,
          fadeTop: laid.classList.contains('fade-top'),
          fadeBottom: laid.classList.contains('fade-bottom'),
          mask: getComputedStyle(laid).webkitMaskImage || getComputedStyle(laid).maskImage,
        };
      });
      expect(state.clear, `pile labels clear at ${where}`).toBe(true);
      expect(state.onTop, `nothing over the pile labels at ${where}`).toBe(true);
      expect(state.clipped).toBe(true);
      expect(state.fadeTop).toBe(state.above);
      expect(state.fadeBottom).toBe(state.below);
      expect(state.mask === 'none' || !state.mask).toBe(!state.above && !state.below);
    }

    // The table fills the height: nothing empty sits between the panel and the hand.
    const gaps = await page.evaluate(() => {
      const bottom = (s: string) => document.querySelector(s)!.getBoundingClientRect().bottom;
      const top = (s: string) => document.querySelector(s)!.getBoundingClientRect().top;
      return { clothToPanel: top('.panel') - bottom('.cloth'), panelToHand: top('.hand') - bottom('.panel') };
    });
    expect(gaps.clothToPanel).toBeLessThan(16);
    expect(gaps.panelToHand).toBeLessThan(16);
  });

  test(`${name} fixture with simulated safe areas: reports rows`, async ({ page }, info) => {
    const insets = INSETS[info.project.name];
    await simulateInsets(page, insets.top, insets.bottom);
    await openApp(page);
    await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
    await openFixture(page, name);
    await page.waitForTimeout(250);
    const rows = await visibleRows(page);
    appendFileSync('test-results/rows.log', `${name} ${info.project.name} insets ${rows}\n`);
    console.log(`[rows ${name} ${info.project.name}] with insets ${rows}`);
    expect(rows).toBeGreaterThanOrEqual(1);
  });
}

test('slim chips: badges, skipped color, sizes and text that never wraps', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await openFixture(page, 'worst');
  const chip = (seat: number) => page.locator(`[data-testid="chip-${seat}"]`);
  // Briar has laid down and has a pending skip: the skip wins.
  await expect(chip(1).locator('.chip-badge')).toHaveAttribute('data-key', 'skipped');
  await expect(chip(1)).toHaveClass(/skipped/);
  await expect(chip(2).locator('.chip-badge')).toHaveAttribute('data-key', 'laid');
  await expect(chip(3).locator('.chip-badge')).toHaveAttribute('data-key', 'laid');
  await expect(chip(2).locator('.chip-info')).toHaveText('Ph 5 · 1 card');
  await expect(chip(1).locator('.chip-info')).toHaveText('Ph 9 · 2 cards');
  // Skipped but not laid down, and neither.
  await patch(page, `game.players[1].laidDown = false; game.players[2].pendingSkip = false; game.players[2].laidDown = false;`);
  await expect(chip(1).locator('.chip-badge')).toHaveAttribute('data-key', 'skipped');
  await expect(chip(2).locator('.chip-badge')).toHaveAttribute('data-key', 'none');
  await expect(chip(2).locator('.chip-badge')).toBeHidden();

  // The widest text a chip can hold stays on one line, inside the chip.
  await patch(page, `
    for (const seat of [1, 2, 3]) {
      game.players[seat].phase = 10;
      game.players[seat].hand = Array.from({ length: 11 }, (_, i) => ({ id: 2000 + seat * 20 + i, kind: 'num', num: 1, suit: 'rose' }));
    }
    game.current = 2; game.stage = 'draw';
  `);
  const fit = await page.locator('.chip').evaluateAll((els) => els.map((el) => {
    const info = el.querySelector('.chip-info') as HTMLElement;
    const text = el.querySelector('.chip-text') as HTMLElement;
    const r = el.getBoundingClientRect();
    return { height: r.height / parseFloat(getComputedStyle(document.documentElement).fontSize), lines: info.getBoundingClientRect().height / parseFloat(getComputedStyle(info).lineHeight), fits: info.scrollWidth <= text.clientWidth + 0.5, text: info.textContent };
  }));
  for (const c of fit) {
    expect(c.height).toBeLessThanOrEqual(4.3);
    expect(Math.round(c.lines)).toBe(1);
    expect(c.fits, `"${c.text}" fits`).toBe(true);
  }
});

test('chip arrangement at every opponent count', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.02));
  const lineups = [['pip'], ['pip', 'marigold'], ['pip', 'marigold', 'briar'], ['pip', 'marigold', 'briar', 'hoot'], ['pip', 'marigold', 'briar', 'hoot', 'nightshade']];
  for (const lineup of lineups) {
    await page.evaluate(() => { const t = (window as any).__TC__; const s = t.getSave(); s.match = null; t.loadSave(s); });
    await startMatch(page, { lineup, seed: '21'.repeat(16), botSeed: '22'.repeat(16) });
    const { rects, width } = await page.evaluate(() => ({
      width: window.innerWidth,
      rects: [...document.querySelectorAll('.chip')].map((c) => { const r = c.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, width: r.width }; }),
    }));
    for (const r of rects) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(width);
    }
    if (lineup.length === 1) {
      expect(rects[0].width / width).toBeCloseTo(0.6, 1);
      expect(Math.abs((rects[0].left + rects[0].right) / 2 - width / 2)).toBeLessThan(2);
    } else {
      const first = rects.slice(0, 3);
      expect(new Set(first.map((r) => Math.round(r.top))).size).toBe(1);
      for (const r of first) expect(Math.abs(r.width - first[0].width)).toBeLessThan(1);
    }
    if (lineup.length > 3) {
      const second = rects.slice(3);
      expect(second[0].top).toBeGreaterThan(rects[0].top);
      const mid = (second[0].left + second[second.length - 1].right) / 2;
      expect(Math.abs(mid - width / 2)).toBeLessThan(2);
      expect(Math.abs(second[0].width - rects[0].width)).toBeLessThan(1);
    }
  }
});

const READY = `
  const n = (id, num, suit) => ({ id, kind: 'num', num, suit: suit || 'rose' });
  const me = game.players[0];
  me.phase = 1; me.completed = []; me.laidDown = false; me.pendingSkip = false;
  me.hand = [n(1,3),n(2,3,'moss'),n(3,3,'honey'),n(4,9),n(5,9,'moss'),n(6,9,'honey'),n(9,1),n(10,1)];
  game.players[1].phase = 1; game.players[1].laidDown = false;
  game.groups = []; game.current = 0; game.stage = 'play';
  game.discardPile = [n(950, 12, 'moss')];
  match.ui.slots = [[],[]];
`;

const watchPanel = (page: Page) => page.evaluate(() => {
  const w = window as any;
  w.__panelFrames = [];
  const look = () => {
    w.__panelFrames.push({ compact: !!document.querySelector('.laid-tag'), settled: w.__TC__.events.some((e: { name: string }) => e.name === 'lay.settle'), height: document.querySelector('.panel')!.getBoundingClientRect().height });
    if (w.__panelFrames.length < 2000 && !w.__panelStop) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
});

test('the panel is full before laying down, compacts only after the moment, and is full again next round', async ({ page }) => {
  await openApp(page);
  await startMatch(page, { lineup: ['pip'], seed: 'c5'.repeat(16), botSeed: 'c6'.repeat(16) });
  await patch(page, READY);
  const panel = page.locator('[data-testid="phase-panel"]');
  await expect(panel.locator('.slots')).toBeVisible();
  await expect(panel.locator('[data-testid="suggest"]')).toBeVisible();
  await expect(panel.locator('.laid-tag')).toHaveCount(0);
  await tap(page, '[data-testid="suggest"]');
  await page.waitForTimeout(400);
  const fullHeight = (await panel.boundingBox())!.height;

  await watchPanel(page);
  await tap(page, '[data-testid="primary"]');
  await waitIdle(page);
  const frames = await page.evaluate(() => { const w = window as any; w.__panelStop = true; return w.__panelFrames as { compact: boolean; settled: boolean; height: number }[]; });
  expect(frames.some((f) => !f.compact)).toBe(true);
  expect(frames.filter((f) => f.compact && !f.settled)).toEqual([]);
  // Full height holds for the whole moment.
  for (const f of frames.filter((x) => !x.settled)) expect(Math.abs(f.height - fullHeight)).toBeLessThan(1);

  const events = await names(page);
  expect(events.indexOf('lay.panelCompact')).toBeGreaterThan(events.indexOf('lay.settle'));
  await expect(panel.locator('[data-testid="laid-tag"]')).toHaveText('Laid down');
  await expect(panel.locator('.slots')).toHaveCount(0);
  await expect(panel.locator('[data-testid="suggest"]')).toHaveCount(0);
  await expect(panel.locator('.track i')).toHaveCount(10);
  await expect(panel.locator('.track i[data-p="1"]')).toHaveClass(/done/);
  const compact = (await panel.boundingBox())!;
  expect(compact.height).toBeLessThan(fullHeight);
  const medal = (await panel.locator('.medallion').boundingBox())!;
  const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  expect(medal.height).toBeCloseTo(rem * 4.4, 0);

  // Nothing leaves compact when the game reloads.
  await page.reload();
  await page.waitForSelector('[data-screen="table"]', { timeout: 20_000 });
  await expect(page.locator('[data-testid="phase-panel"] .laid-tag')).toHaveCount(1);
  await waitIdle(page);

  await patch(page, `
    const n = (id, num) => ({ id, kind: 'num', num, suit: 'rose' });
    game.players[0].hand = [n(9, 1)];
    game.current = 0; game.stage = 'play';
  `);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await tap(page, '.hc[data-id="9"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForSelector('[data-testid="round-end"]', { timeout: 30_000 });
  await tap(page, '[data-testid="next-round"]');
  await waitIdle(page);
  await expect(page.locator('[data-testid="phase-panel"] .slots')).toBeVisible();
  await expect(page.locator('[data-testid="phase-panel"] .laid-tag')).toHaveCount(0);
});

test('with Reduced motion the panel still compacts, by a fade', async ({ page }) => {
  await openApp(page, { settings: { reducedMotion: true } });
  await startMatch(page, { lineup: ['pip'], seed: 'c7'.repeat(16), botSeed: 'c8'.repeat(16) });
  await patch(page, READY);
  await tap(page, '[data-testid="suggest"]');
  await page.waitForTimeout(400);
  await tap(page, '[data-testid="primary"]');
  await waitIdle(page);
  await expect(page.locator('.laid-tag')).toHaveCount(1);
  expect(await names(page)).toContain('lay.panelCompact');
  await expect(page.locator('.panel')).not.toHaveClass(/collapsing/);
});

test('everything tied to a chip still lands on the right chip', async ({ page }) => {
  await openApp(page);
  await startMatch(page, { lineup: ['briar', 'pip', 'marigold'], seed: 'c9'.repeat(16), botSeed: 'ca'.repeat(16) });
  await page.evaluate(() => { Math.random = () => 0; });

  // The three dots appear inside the bot's chip during a real turn, and a bubble rises from its portrait.
  await patch(page, `
    const n = (id, num) => ({ id, kind: 'num', num, suit: 'rose' });
    const me = game.players[0];
    me.phase = 1; me.laidDown = true; me.completed = [];
    me.hand = [{ id: 40, kind: 'skip' }, n(41, 1), n(42, 2), n(43, 4)];
    game.groups = [{ id: 7, owner: 0, type: 'set', num: 9, cards: [1,2,3].map((v) => ({ card: n(60 + v, 9), num: 9 })) }];
    game.current = 0; game.stage = 'play';
    game.discardPile = [n(950, 12)];
  `);
  await tap(page, '.hc[data-id="40"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForSelector('[data-testid="target-picker"]');
  // The picker keeps seat order and marks who can't be skipped.
  const targets = await page.locator('.target').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(targets).toEqual(['target-1', 'target-2', 'target-3']);
  await tap(page, '[data-testid="target-2"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="chip-2"]')!.classList.contains('frost'), null, { timeout: 10_000, polling: 20 });
  expect(await page.locator('.chip.frost').count()).toBe(1);
  await expect(page.locator('[data-testid="chip-2"] .chip-badge')).toHaveAttribute('data-key', 'skipped');

  const dots = page.locator('.chip.thinking .dots');
  await dots.first().waitFor({ state: 'visible', timeout: 20_000 });
  const inside = await page.locator('.chip.thinking').first().evaluate((chip) => {
    const c = chip.getBoundingClientRect();
    const d = chip.querySelector('.dots')!.getBoundingClientRect();
    return d.left >= c.left && d.right <= c.right && d.top >= c.top && d.bottom <= c.bottom;
  });
  expect(inside).toBe(true);
  await page.waitForFunction(() => (window as any).__TC__.events.some((e: { name: string }) => e.name === 'ui.bubble' || e.name === 'ui.expression'), null, { timeout: 30_000 });
  await page.waitForFunction(() => { const s = (window as any).__TC__.state(); return s.current === 0 && s.stage === 'draw'; }, null, { timeout: 60_000 });
  await waitIdle(page);
  const seen = await names(page);
  for (const name of ['skip.onBot', 'skip.frost', 'ui.turnGlow', 'ui.botThinking', 'ui.deal', 'ui.bubble', 'ui.expression']) expect(seen, name).toContain(name);
});

test('a spoken line sits under its speaker, centered on the portrait where it can be', async ({ page }) => {
  await openApp(page);
  await startMatch(page, { lineup: ['briar', 'pip', 'marigold'], seed: 'cd'.repeat(16), botSeed: 'ce'.repeat(16) });
  await page.evaluate(() => { Math.random = () => 0; });
  await patch(page, `
    const n = (id, num) => ({ id, kind: 'num', num, suit: 'rose' });
    const me = game.players[0];
    me.phase = 1; me.laidDown = true; me.completed = [];
    me.hand = [{ id: 40, kind: 'skip' }, n(41, 1), n(42, 2), n(43, 4)];
    game.groups = [{ id: 7, owner: 0, type: 'set', num: 9, cards: [1,2,3].map((v) => ({ card: n(60 + v, 9), num: 9 })) }];
    game.current = 0; game.stage = 'play';
    game.discardPile = [n(950, 12)];
  `);
  await tap(page, '.hc[data-id="40"]');
  await tap(page, '[data-testid="discard-btn"]');
  await tap(page, '[data-testid="target-2"]');
  await page.waitForSelector('[data-testid="bubble"]', { timeout: 15_000 });
  const placed = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="bubble"]')!.getBoundingClientRect();
    const chip = document.querySelector('[data-testid="chip-2"]')!.getBoundingClientRect();
    const face = document.querySelector('[data-testid="chip-2"] .portrait')!.getBoundingClientRect();
    return { below: b.top >= chip.bottom, offset: Math.abs((b.left + b.right) / 2 - (face.left + face.right) / 2), left: b.left, right: b.right, width: window.innerWidth };
  });
  expect(placed.below).toBe(true);
  expect(placed.left).toBeGreaterThanOrEqual(0);
  expect(placed.right).toBeLessThanOrEqual(placed.width);
  expect(placed.offset).toBeLessThan(2);
});

test('Midnight Garden keeps its boss styling with slim chips', async ({ page }) => {
  await openApp(page, { tutorial: { done: true } });
  await page.evaluate(() => (window as any).__TC__.startMatch({ lineup: ['nightshade'], seed: 'cb'.repeat(16), botSeed: 'cc'.repeat(16), mode: { kind: 'campaign', stop: 4 } }));
  await page.waitForSelector('[data-testid="boss-intro"]');
  await page.locator('[data-testid="boss-intro"]').click({ force: true });
  await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 15_000 });
  await waitIdle(page);
  await expect(page.locator('[data-screen="table"]')).toHaveClass(/boss/);
  await expect(page.locator('.chip')).toHaveCount(1);
  const box = (await page.locator('.chip').boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(52);
});
