// Change Request 04 §6: how long a parity group can grow on a fogged Glade table before a card is cut off.
// Report only: the sizes it finds never fail the test, only a failure to measure does. scripts/parity-report.mjs
// joins every size's results into test-results/parity-groups.md, and the gate fails if any are missing.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, openApp, patch, startMatch, test, waitIdle } from './helpers.ts';

export const PARITY_DIR = 'test-results/parity-groups';
const SIZES = Array.from({ length: 13 }, (_, i) => 8 + i);

type Case = { key: string; label: string; owner: number; type: 'odds' | 'evens'; phase: number };
type Measure = { n: number; cards: number; inside: boolean; tops: number; sideScroll: boolean; crownInside: boolean | null };

/** Map 1 finished and the Glade still fogged, with the boss reachable. */
async function foggedGlade(page: Page): Promise<void> {
  await page.evaluate(() => {
    const t = (window as any).__TC__;
    const s = t.getSave();
    s.match = null;
    s.tutorial.done = true;
    s.backupPrompted = true;
    s.campaign.won = [true, true, true, true, true];
    s.campaign.stars = [3, 3, 3, 3, 3];
    s.glade = { ...s.glade, winOrder: ['g1', 'a1', 'a2', 'g2'], stars: { g1: 1, a1: 1, a2: 1, g2: 1 }, revealSeen: true, lastMap: 'glade', fogLifted: false };
    t.loadSave(s);
  });
}

/** Lays one parity group of n real cards in front of its owner, and measures it against the laid-down area. */
async function measure(page: Page, c: Case, n: number): Promise<Measure> {
  const nums = c.type === 'odds' ? [1, 3, 5, 7, 9, 11] : [2, 4, 6, 8, 10, 12];
  const suits = ['rose', 'moss', 'moonstone', 'honey'];
  const cards = Array.from({ length: n }, (_, i) => ({ card: { id: 5000 + i, kind: 'num', num: nums[i % 6], suit: suits[Math.floor(i / 6) % 4] } }));
  await patch(page, `
    const p = game.players[${c.owner}];
    p.laidDown = true; p.phase = ${c.phase};
    game.groups = [{ id: 990, owner: ${c.owner}, type: '${c.type}', cards: ${JSON.stringify(cards)} }];
  `);
  await waitIdle(page);
  // Let any card that moved finish settling into place.
  await page.waitForFunction(() => [...document.querySelectorAll('.laid .card')].every((e) => e.getAnimations().every((a) => a.effect?.getTiming().iterations === Infinity)));
  return page.evaluate((owner) => {
    const laid = document.querySelector('.laid') as HTMLElement;
    const group = document.querySelector(`.laid-row[data-seat="${owner}"] .group`) as HTMLElement;
    const area = laid.getBoundingClientRect();
    const cardEls = [...group.querySelectorAll('.card')] as HTMLElement[];
    const rects = cardEls.map((e) => e.getBoundingClientRect());
    const inside = rects.every((r) => r.left >= area.left - 0.5 && r.right <= area.right + 0.5);
    let sideScroll = false;
    for (let el: HTMLElement | null = group; el && el !== laid.parentElement; el = el.parentElement) {
      const ox = getComputedStyle(el).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) sideScroll = true;
    }
    const thorns = group.querySelector('.thorns') as HTMLElement | null;
    const t = thorns?.getBoundingClientRect();
    return {
      n: 0, cards: cardEls.length, inside, sideScroll,
      tops: new Set(rects.map((r) => Math.round(r.top))).size,
      crownInside: t ? t.left >= area.left - 0.5 && t.right <= area.right + 0.5 : null,
    };
  }, c.owner);
}

test('glade parity: how long a parity group can grow before a card is cut off', async ({ page }, info) => {
  test.setTimeout(170_000);
  await openApp(page);
  await foggedGlade(page);
  const results: Record<string, unknown> = {};

  const cases: [Case, Record<string, unknown>][] = [
    [{ key: 'humanOdds', label: 'Odds, laid down by the human', owner: 0, type: 'odds', phase: 22 }, { lineup: ['velvet', 'mallow', 'briar'], mode: { kind: 'glade', stop: 'a2' } }],
    [{ key: 'humanEvens', label: 'Evens, laid down by the human', owner: 0, type: 'evens', phase: 23 }, { lineup: ['velvet', 'mallow', 'briar'], mode: { kind: 'glade', stop: 'a2' } }],
    [{ key: 'lunariaOdds', label: 'Odds, laid down by Lunaria at the boss', owner: 2, type: 'odds', phase: 22 }, { lineup: ['puff', 'lunaria', 'haze'], mode: { kind: 'glade', stop: 'g3' } }],
  ];
  for (const [c, start] of cases) {
    await startMatch(page, { seed: 'b7'.repeat(16), botSeed: 'b8'.repeat(16), variant: 'moonlit', cloth: 'mistveil', ...start });
    if (c.owner === 2) await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 30_000 });
    await waitIdle(page);
    const state = await page.evaluate(() => (window as any).__TC__.state());
    expect(state.rules?.fog, 'a fogged table').toBe(true);
    if (c.owner === 2) expect(state.rules?.crownSeat, 'Lunaria wears the crown').toBe(2);

    const rows: Measure[] = [];
    for (const n of SIZES) {
      const m = { ...(await measure(page, c, n)), n };
      // The measurement itself must be sound: every card laid down is on the table.
      expect(m.cards, `${c.key} at ${n}`).toBe(n);
      rows.push(m);
    }
    if (c.owner === 2) expect(rows.every((r) => r.crownInside !== null), 'the crown border is drawn').toBe(true);
    const fits = rows.filter((r) => r.inside && r.tops === 1 && !r.sideScroll);
    let largest: number | null = null;
    for (const r of rows) { if (r.inside && !r.sideScroll) largest = r.n; else break; }
    const firstOver = rows.find((r) => !(r.inside && !r.sideScroll));
    const how = !firstOver ? null : firstOver.sideScroll ? 'scrolls sideways' : !firstOver.inside ? 'clipped' : 'wraps';
    results[c.key] = {
      label: c.label,
      largestFullyShown: largest,
      largerGroup: how,
      wrapsFrom: rows.find((r) => r.tops > 1)?.n ?? null,
      oneRowUpTo: fits.length ? Math.max(...fits.map((r) => r.n)) : null,
      ...(c.owner === 2 ? { crownBorderFitsUpTo: rows.filter((r) => r.crownInside).map((r) => r.n).pop() ?? null } : {}),
      sizes: rows,
    };
    await page.evaluate(() => (window as any).__TC__.loadSave((window as any).__TC__.getSave()));
  }

  const viewport = page.viewportSize();
  const out = { project: info.project.name, viewport, measuredAt: 'fogged Glade table', cases: results };
  mkdirSync(PARITY_DIR, { recursive: true });
  writeFileSync(`${PARITY_DIR}/${info.project.name}.json`, JSON.stringify(out, null, 2) + '\n');
  await info.attach('parity-groups', { body: JSON.stringify(out, null, 2), contentType: 'application/json' });
  expect(Object.keys(results)).toEqual(['humanOdds', 'humanEvens', 'lunariaOdds']);
});
