// Change Request 04: matches saved before Moonlit Trial A's list became the Moonlit Phases, and the Free Play picker.
// Each saved match was recorded on the game from before the change (tests/fixtures/pre-cr04). Full matches are in
// 16-glade-swap-match.spec.ts.
import type { Page } from '@playwright/test';
import { PHASES, groupLabel } from '../../src/engine/phases.ts';
import { openApp, tap, test } from './helpers.ts';
import { OLD_LIST_FIXTURES, RETIRED, TRIAL_FIXTURES, expect, expectedGame, fixture, gameAndUi, openWithFixture, tableView, waitForResumedTable } from './swap-fixtures.ts';

const shown = (phase: number) => (phase > 10 ? ((phase - 11) % 10) + 1 : phase);

for (const name of [...OLD_LIST_FIXTURES, ...TRIAL_FIXTURES]) {
  test(`glade swap: a ${name} match saved before the update resumes exactly, and again after a reload`, async ({ page }) => {
    await openWithFixture(page, name);
    const first = await gameAndUi(page);
    expect(first.game).toEqual(expectedGame(name));
    expect(first.ui).toEqual(fixture(name).match.ui);
    const me = first.game.players[0];
    const view = await tableView(page);
    expect(view.medallion).toBe(`Phase ${shown(me.phase)}`);
    if ((OLD_LIST_FIXTURES as readonly string[]).includes(name)) {
      // Still on the list it began on: every phase in it is a retired one, with that list's labels.
      for (const p of first.game.players) {
        expect(RETIRED).toContain(p.phase);
        for (const c of p.completed) expect(RETIRED).toContain(c);
      }
      if (!me.laidDown) {
        const labels = await page.locator('[data-testid^="slot-"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
        expect(labels).toEqual(PHASES[me.phase].map(groupLabel));
      }
    }
    if (name.startsWith('glade-')) expect(view.fogged).toBe(true);

    await page.reload();
    await waitForResumedTable(page);
    expect(await gameAndUi(page)).toEqual(first);
    expect(await tableView(page)).toEqual(view);
  });
}

/** A save with the Rose Garden finished, and the Glade's first stop won or not. */
async function freePlay(page: Page, gladeWon: string[]): Promise<void> {
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

const options = (page: Page) => page.locator('[data-testid^="fp-variant-"]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-testid')!.slice('fp-variant-'.length), (e as HTMLElement).innerText.trim()]));

test('glade swap: the Free Play picker offers exactly the right variants, in order, with no Trial A', async ({ page }) => {
  await openApp(page);
  await freePlay(page, ['g1']);
  expect(await options(page)).toEqual([
    ['standard', 'Standard'], ['sprint', 'Sprint'], ['choose', 'Choose Your Phase'],
    ['moonlit', 'Moonlit Phases'], ['trialB', 'Moonlit Trial B'], ['trialC', 'Moonlit Trial C'],
  ]);
  await tap(page, '[data-testid="nav-journey"]');
  await freePlay(page, []);
  expect(await options(page)).toEqual([
    ['standard', 'Standard'], ['sprint', 'Sprint'], ['choose', 'Choose Your Phase'], ['trialB', 'Moonlit Trial B'], ['trialC', 'Moonlit Trial C'],
  ]);
});
