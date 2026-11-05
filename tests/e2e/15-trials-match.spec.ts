// One full match per trial of the Moonlit Trials, through the real UI with the auto-player (Change Request 03, Part B).
// It runs at one size only (playwright.config.ts): the picker and reload tests in 14-trials.spec.ts cover every size.
import type { Page } from '@playwright/test';
import { expect, openApp, tap, test, waitIdle } from './helpers.ts';

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

for (const trial of TRIALS) {
  test(`trials: ${trial.label} plays a full match through the real UI`, async ({ page }) => {
    test.setTimeout(400_000);
    await openApp(page);
    await page.evaluate((s) => (window as any).__TC__.setTestScale(s), FAST);
    await everyVariant(page);
    await tap(page, `[data-testid="fp-variant-${trial.id}"]`);
    await expect(page.locator(`[data-testid="fp-variant-${trial.id}"]`)).toHaveClass(/\bon\b/);
    await tap(page, '[data-testid="fp-begin"]');
    await page.waitForSelector('[data-screen="table"]');
    await waitIdle(page);
    const start = await page.evaluate(() => (window as any).__TC__.state());
    expect(start.variant).toBe(trial.id);
    expect(start.rules?.fog).toBeFalsy();
    expect(start.players.map((p: { phase: number }) => p.phase)).toEqual(start.players.map(() => trial.first));
    // The Phase Panel labels the trial's own first phase, shown as Phase 1.
    for (const [i, label] of trial.slots.entries()) await expect(page.locator(`[data-testid="slot-${i}"]`)).toContainText(label);
    await expect(page.locator('[data-testid="medallion"]')).toHaveAttribute('aria-label', 'Phase 1');

    await page.evaluate(() => (window as any).__TC__.autoplay(true));
    await page.waitForFunction(() => !(window as any).__TC__.autoRunning(), null, { timeout: 380_000 });
    const end = await page.evaluate(() => { const t = (window as any).__TC__; return { game: t.state(), save: t.getSave() }; });
    expect(end.game.stage).toBe('matchOver');
    const winner = end.game.players[end.game.winners[0]];
    const ids = Array.from({ length: 10 }, (_, i) => trial.first + i);
    expect([...winner.completed].sort((a: number, b: number) => a - b)).toEqual(ids);
    expect(end.save.stats.played).toBe(1);
    expect(end.save.match).toBeNull();
    if (end.game.winners.includes(0)) expect(end.save.charms).toContain('moonlit-mastery');
  });
}

