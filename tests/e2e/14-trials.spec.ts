// The Moonlit Trials in Free Play (Change Request 03, Part B): the picker and a trial match surviving a reload.
// One full match per trial is in 15-trials-match.spec.ts.
import type { Page } from '@playwright/test';
import { expect, openApp, shotPath, tap, test, waitIdle } from './helpers.ts';

const FAST = 0.02;
const TRIALS = [
  { id: 'trialA', label: 'Moonlit Trial A', first: 21, last: 30, slots: ['Set of 3', 'Set of 3', 'Pair'] },
  { id: 'trialB', label: 'Moonlit Trial B', first: 31, last: 40, slots: ['7 Evens'] },
  { id: 'trialC', label: 'Moonlit Trial C', first: 41, last: 50, slots: ['7 Evens'] },
] as const;

/** A save with every Free Play variant open: the Rose Garden finished and the Glade's first stop won. */
async function everyVariant(page: Page, gladeWon: string[] = ['g1']): Promise<void> {
  await page.evaluate((won) => {
    const t = (window as any).__TC__;
    const s = t.getSave();
    s.match = null;
    s.tutorial.done = true;
    s.backupPrompted = true;
    s.campaign.won = [true, true, true, true, true];
    s.campaign.stars = [3, 3, 3, 3, 3];
    s.glade = { ...s.glade, winOrder: won, stars: Object.fromEntries((won as string[]).map((id) => [id, 1])), revealSeen: true, lastMap: 'garden' };
    t.loadSave(s);
  }, gladeWon);
  await tap(page, '[data-testid="nav-free"]');
  await page.waitForSelector('[data-screen="free"]');
}

test('trials: the picker shows every variant, with no scrolling, clipping or overlap', async ({ page }, info) => {
  await openApp(page);
  // The trials are always open, even before the Moonlit Phases.
  await everyVariant(page, []);
  const early = await page.locator('[data-testid^="fp-variant-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice('fp-variant-'.length)));
  expect(early).toEqual(['standard', 'sprint', 'choose', 'trialA', 'trialB', 'trialC']);

  await tap(page, '[data-testid="nav-journey"]');
  await everyVariant(page);
  const ids = ['standard', 'sprint', 'choose', 'moonlit', 'trialA', 'trialB', 'trialC'];
  await expect(page.locator('[data-testid^="fp-variant-"]')).toHaveCount(ids.length);
  for (const t of TRIALS) await expect(page.locator(`[data-testid="fp-variant-${t.id}"]`)).toHaveText(t.label);
  const order = await page.locator('[data-testid^="fp-variant-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice('fp-variant-'.length)));
  expect(order).toEqual(ids);

  const layout = await page.evaluate(() => {
    const seg = document.querySelector('[data-testid="fp-variant-standard"]')!.parentElement!;
    const box = seg.getBoundingClientRect();
    const buttons = [...seg.querySelectorAll('button')].map((b) => ({ r: b.getBoundingClientRect(), clipped: b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1 }));
    const scroller = seg.closest('.page-scroll')!;
    return {
      pageWide: document.documentElement.scrollWidth > window.innerWidth || scroller.scrollWidth > scroller.clientWidth + 1,
      segWide: seg.scrollWidth > seg.clientWidth + 1,
      inside: buttons.every(({ r }) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5),
      onScreen: buttons.every(({ r }) => r.left >= 0 && r.right <= window.innerWidth),
      clipped: buttons.filter((b) => b.clipped).length,
      overlaps: buttons.some((a, i) => buttons.some((b, j) => j > i && a.r.left < b.r.right - 0.5 && b.r.left < a.r.right - 0.5 && a.r.top < b.r.bottom - 0.5 && b.r.top < a.r.bottom - 0.5)),
    };
  });
  expect(layout).toEqual({ pageWide: false, segWide: false, inside: true, onScreen: true, clipped: 0, overlaps: false });
  await page.locator('[data-testid="fp-variant-standard"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: shotPath('free-play-trials', info.project.name) });
});

test('trials: a trial match in progress survives a reload exactly', async ({ page }) => {
  await openApp(page);
  await page.evaluate((s) => (window as any).__TC__.setTestScale(s), FAST);
  await everyVariant(page);
  await tap(page, '[data-testid="fp-variant-trialB"]');
  await tap(page, '[data-testid="fp-begin"]');
  await page.waitForSelector('[data-screen="table"]');
  await waitIdle(page);
  // Play a few turns so the match has some history, then stop on the human's turn.
  await page.evaluate(() => (window as any).__TC__.autoplay(true));
  await page.waitForFunction(() => { const s = (window as any).__TC__.state(); return s && s.players[0].turns >= 3; }, null, { timeout: 60_000 });
  await page.evaluate(() => (window as any).__TC__.autoplay(false));
  await waitIdle(page);
  const before = await page.evaluate(() => { const t = (window as any).__TC__; return { game: t.state(), ui: t.ui() }; });
  expect(before.game.variant).toBe('trialB');
  await page.reload();
  await page.waitForFunction(() => '__TC__' in window, null, { timeout: 15_000 });
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await page.waitForSelector('[data-screen="table"]', { timeout: 15_000 });
  await page.waitForFunction(() => (window as any).__TC__.state() !== null, null, { timeout: 15_000 });
  const after = await page.evaluate(() => { const t = (window as any).__TC__; return { game: t.state(), ui: t.ui() }; });
  expect(after).toEqual(before);
});
