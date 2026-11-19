// The Tower: Tower home, the floor intro, floor results, the run-over screen, Stats and How to Play (TOWER_SPEC.md §7, §11).
import type { Page } from '@playwright/test';
import { expect, openApp, tap, test } from './helpers.ts';
import { beginFloor, forceFloor, openIntro, settled, towerAt, towerSave } from './tower-helpers.ts';

const text = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const speedUp = (page: Page) => page.evaluate(() => (window as any).__TC__.setTestScale(0.05));

async function ready(page: Page): Promise<void> {
  await openApp(page);
  await towerSave(page, { place: 'crossroads' });
  await page.waitForSelector('[data-map="crossroads"]');
}

test('tower flow: every Tower home panel state, with its exact text', async ({ page }) => {
  await ready(page);
  await speedUp(page);
  // No climb.
  await towerAt(page, { climb: false });
  await expect(text(page, 'tower-floor')).toHaveText('Floor 1');
  await expect(text(page, 'tower-tier')).toHaveText('Tier 1 · Rose Dawn');
  await expect(text(page, 'tower-status')).toHaveText('A fresh climb · 3 hearts');
  await expect(text(page, 'tower-play')).toHaveText('Begin a climb');
  await expect(text(page, 'end-climb')).toHaveCount(0);
  await expect(text(page, 'floor-chip')).toHaveCount(0);
  await expect(text(page, 'plaque-1')).toHaveClass(/current/);
  await expect(text(page, 'hearts')).toHaveAttribute('data-hearts', '3');
  // Between floors.
  await towerAt(page, { floor: 7, hearts: 2 });
  await expect(text(page, 'tower-status')).toHaveText('Ready for Floor 7');
  await expect(text(page, 'tower-play')).toHaveText('Play');
  await expect(text(page, 'end-climb')).toHaveText('End this climb');
  await expect(text(page, 'hearts')).toHaveAttribute('data-hearts', '2');
  // Between floors, Guardian next: Nightshade on odd tiers, Lunaria on even.
  await towerAt(page, { floor: 10, hearts: 2 });
  await expect(text(page, 'tower-status')).toHaveText('Guardian: Nightshade and the Thorned Crown. Win to get a heart back.');
  await expect(text(page, 'floor-chip')).toHaveText('Guardian');
  await towerAt(page, { floor: 40, hearts: 2 });
  await expect(text(page, 'tower-tier')).toHaveText('Tier 4 · Starlit Pink Night');
  await expect(text(page, 'tower-status')).toHaveText('Guardian: Lady Lunaria and the Thorned Crown. Win to get a heart back.');
  await expect(text(page, 'tower-play')).toHaveText('Play');
  // A floor in progress.
  await towerAt(page, { floor: 12, hearts: 3, seed: 'c1'.repeat(16) });
  await openIntro(page);
  await beginFloor(page);
  await page.evaluate(() => (window as any).__TC__.towerHome());
  await page.waitForSelector('[data-screen="tower"].ready');
  await settled(page);
  await expect(text(page, 'tower-status')).toHaveText('Floor in progress · Phase 1 of 3');
  await expect(text(page, 'tower-play')).toHaveText('Resume');
  await tap(page, '[data-testid="tower-play"]');
  await page.waitForSelector('[data-screen="table"]');
});

test('tower flow: the best-floor marker, above the view, in the view, and with no best', async ({ page }) => {
  await ready(page);
  await speedUp(page);
  await towerAt(page, { floor: 37, hearts: 1, best: 142 });
  await expect(text(page, 'best-marker')).toHaveText('Best · Floor 142');
  await expect(text(page, 'best-flag')).toHaveCount(0);
  await expect(text(page, 'floor-chip')).toHaveText('Best 142');
  await towerAt(page, { floor: 37, hearts: 1, best: 39 });
  await expect(text(page, 'best-marker')).toHaveCount(0);
  await expect(page.locator('[data-testid="plaque-39"] [data-testid="best-flag"]')).toHaveCount(1);
  await towerAt(page, { floor: 4, hearts: 3, best: 0 });
  await expect(text(page, 'best-marker')).toHaveCount(0);
  await expect(text(page, 'best-flag')).toHaveCount(0);
  await expect(text(page, 'floor-chip')).toHaveCount(0);
});

test('tower flow: the current floor glows, and the lift hangs beside its window', async ({ page }) => {
  await ready(page);
  await speedUp(page);
  await towerAt(page, { floor: 23, hearts: 3 });
  const glow = await text(page, 'current-glow').boundingBox();
  const cage = await text(page, 'cage').boundingBox();
  const plaque = await text(page, 'plaque-23').boundingBox();
  expect(glow && cage && plaque).toBeTruthy();
  // The window, its glow, the cage and the gold plaque all sit at the current floor's height.
  const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
  expect(Math.abs(mid(glow!) - mid(plaque!))).toBeLessThan(plaque!.height * 2);
  expect(Math.abs(mid(cage!) - mid(glow!))).toBeLessThan(cage!.height);
  await expect(text(page, 'plaque-23')).toHaveClass(/current/);
  // About 58% of the way down the view, between the top bar and the panel.
  const top = await page.locator('.tw-top').boundingBox();
  const panel = await text(page, 'tower-panel').boundingBox();
  const at = (mid(glow!) - (top!.y + top!.height)) / (panel!.y - (top!.y + top!.height));
  expect(at).toBeGreaterThan(0.5);
  expect(at).toBeLessThan(0.66);
});

test('tower flow: the floor intro shows the tier, the three phases, the opponents and the rule chips', async ({ page }) => {
  await ready(page);
  await speedUp(page);
  await towerAt(page, { floor: 37, hearts: 1, draw: { phases: [21, 35, 6], lineup: ['hoot', 'mallow', 'fennel'], guardian: null } });
  await openIntro(page);
  await expect(text(page, 'intro-kicker')).toHaveText('TIER 4 · STARLIT PINK NIGHT');
  await expect(text(page, 'intro-title')).toHaveText('Floor 37');
  await expect(page.locator('.fi-sub')).toHaveText('Win these three phases to climb');
  await expect(text(page, 'phase-label-1')).toHaveText('2 Sets of 3 + Pair');
  await expect(text(page, 'phase-label-2')).toHaveText('Color run of 3 + Set of 3 + Pair');
  await expect(text(page, 'phase-label-3')).toHaveText('Run of 9');
  await expect(page.locator('.ph-medal')).toHaveText(['1', '2', '3']);
  await expect(page.locator('.fi-opp > span')).toHaveText(['Professor Hoot', 'Mallow', 'Fennel']);
  await expect(text(page, 'chip-fog')).toHaveText('Moonlit Fog');
  await expect(text(page, 'chip-crown')).toHaveCount(0);
  await expect(text(page, 'chip-hearts')).toHaveText('1 heart left');
  await expect(text(page, 'begin-floor')).toHaveText('Begin floor');
  // The longest label fits inside its card at every size.
  const fits = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.ph-label')].every((l) => {
    const card = l.closest('.ph-card')!.getBoundingClientRect();
    const r = l.getBoundingClientRect();
    return l.scrollWidth <= l.clientWidth + 1 && l.scrollHeight <= l.clientHeight + 1 && r.left >= card.left && r.right <= card.right && r.bottom <= card.bottom;
  }));
  expect(fits).toBe(true);
  // Swiping down or tapping outside returns to Tower home.
  await page.locator('.backdrop').last().click({ position: { x: 5, y: 5 }, force: true });
  await page.waitForSelector('[data-testid="floor-intro"]', { state: 'detached' });
  await expect(page.locator('[data-screen="tower"]')).toHaveCount(1);
});

test('tower flow: a Guardian floor\'s intro sheet, and the Guardian\'s intro at the table', async ({ page }) => {
  await ready(page);
  await speedUp(page);
  await towerAt(page, { floor: 30, hearts: 2, seed: 'd2'.repeat(16) });
  await openIntro(page);
  await expect(text(page, 'intro-title')).toHaveText('Guardian Floor 30');
  await expect(text(page, 'chip-crown')).toHaveText('Thorned Crown');
  await expect(text(page, 'chip-hearts')).toHaveText('2 hearts left');
  await expect(page.locator('.fi-opp span').first()).toBeVisible();
  await expect(page.locator('.fi-opp[data-bot="nightshade"]')).toHaveCount(1);
  await expect(page.locator('.fi-opp[data-bot="puff"], .fi-opp[data-bot="haze"]')).toHaveCount(0);
  await tap(page, '[data-testid="begin-floor"]');
  await page.waitForSelector('[data-testid="boss-intro"]');
  await expect(text(page, 'guardian-kicker')).toHaveText('Guardian of Floor 30');
  await expect(text(page, 'boss-title')).toHaveText('Nightshade, the Moth Queen');
  await expect(text(page, 'intro-crown-chip')).toHaveText("Thorned Crown — no one can add to Nightshade's groups.");
  await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 20_000 });
  // Her own tablecloth, not the boss's.
  await expect(page.locator('[data-screen="table"]')).toHaveAttribute('data-cloth', await page.evaluate(() => (window as any).__TC__.getSave().equipped.cloth));
  await expect(page.locator('[data-testid="chip-crown"]')).toHaveCount(1);
  await expect(page.locator('.chip-phase').first()).toHaveText('Ph 1');

  await page.evaluate(() => (window as any).__TC__.towerSet({ floor: 40, hearts: 2, seed: 'e3'.repeat(16) }));
  await page.evaluate(() => { const t = (window as any).__TC__; const s = t.getSave(); s.match = null; t.loadSave(s); });
  await page.evaluate(() => (window as any).__TC__.towerHome());
  await page.waitForSelector('[data-screen="tower"].ready');
  await openIntro(page);
  await tap(page, '[data-testid="begin-floor"]');
  await page.waitForSelector('[data-testid="boss-intro"]');
  await expect(text(page, 'guardian-kicker')).toHaveText('Guardian of Floor 40');
  await expect(text(page, 'boss-title')).toHaveText('Lady Lunaria, the Fog Weaver');
  await expect(text(page, 'intro-crown-chip')).toHaveText("Thorned Crown — no one can add to Lunaria's groups.");
  await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 20_000 });
});

test('tower flow: every floor result, with its exact text', async ({ page }) => {
  await ready(page);
  await speedUp(page);
  const play = async (floor: number, hearts: number, won: boolean) => {
    await page.evaluate(() => { const t = (window as any).__TC__; const s = t.getSave(); s.match = null; t.loadSave(s); });
    await towerAt(page, { floor, hearts, seed: `${floor}${hearts}`.padEnd(32, 'f') });
    await openIntro(page);
    await beginFloor(page);
    await forceFloor(page, won);
  };
  await play(5, 3, true);
  await expect(text(page, 'result-header')).toHaveText('Floor 5 cleared!');
  await expect(text(page, 'result-sub')).toHaveText('On to Floor 6');
  await expect(page.locator('[data-testid="floor-result"] button')).toHaveText(['Climb']);
  await expect(page.locator('[data-testid="floor-result"] [data-testid="stars"]')).toHaveCount(0);

  await play(10, 2, true);
  await expect(text(page, 'result-header')).toHaveText('Guardian defeated!');
  await expect(text(page, 'result-sub')).toHaveText('You won back a heart.');
  await expect(page.locator('[data-testid="floor-result"] [data-testid="hearts"]')).toHaveAttribute('data-hearts', '3', { timeout: 5000 });

  await play(20, 3, true);
  await expect(text(page, 'result-sub')).toHaveText('Your hearts are full.');

  await play(14, 3, false);
  await expect(text(page, 'result-header')).toHaveText('Not this time');
  await expect(text(page, 'result-sub')).toHaveText('You lost a heart. 2 hearts left.');
  await expect(page.locator('[data-testid="floor-result"] button')).toHaveText(['Try again', 'Back to the Tower']);
  await expect(page.locator('[data-testid="floor-result"] [data-testid="hearts"]')).toHaveAttribute('data-hearts', '2', { timeout: 5000 });

  await play(14, 2, false);
  await expect(text(page, 'result-sub')).toHaveText('You lost a heart. 1 heart left.');

  await play(14, 1, false);
  await expect(text(page, 'result-header')).toHaveText('Not this time');
  await expect(text(page, 'result-sub')).toHaveText('That was your last heart.');
  await expect(page.locator('[data-testid="floor-result"] button')).toHaveText(['See your climb']);
  const events = await page.evaluate(() => (window as any).__TC__.events.map((e: any) => e.name));
  expect(events).toContain('tower.heartLost');
  expect(events).toContain('tower.heartBack');
});

test('tower flow: a forfeit loses the floor, through the existing confirmation', async ({ page }) => {
  await ready(page);
  await speedUp(page);
  await towerAt(page, { floor: 8, hearts: 3, seed: 'aa'.repeat(16) });
  await openIntro(page);
  await beginFloor(page);
  await tap(page, '[data-testid="menu"]');
  await tap(page, '[data-testid="forfeit"]');
  await expect(page.locator('.sheet-title').last()).toHaveText('Forfeit this match?');
  await tap(page, '[data-testid="confirm-ok"]');
  await page.waitForSelector('[data-testid="floor-result"]');
  await expect(text(page, 'result-sub')).toHaveText('You lost a heart. 2 hearts left.');
  const save = await page.evaluate(() => (window as any).__TC__.getSave());
  expect(save.tower.climb.floor).toBe(8);
  expect(save.tower.climb.hearts).toBe(2);
  expect(save.match).toBeNull();
});

test('tower flow: "End this climb" asks first; cancelling changes nothing, confirming ends it on the floor', async ({ page }) => {
  await ready(page);
  await speedUp(page);
  await towerAt(page, { floor: 26, hearts: 2, best: 30 });
  const before = await page.evaluate(() => JSON.stringify((window as any).__TC__.getSave().tower));
  await tap(page, '[data-testid="end-climb"]');
  await expect(page.locator('.sheet-title')).toHaveText('End this climb?');
  await expect(page.locator('.sheet .sheet-text')).toHaveText('Your climb will end on Floor 26. Your best floor is kept.');
  await expect(page.locator('[data-testid="confirm-ok"]')).toHaveText('End climb');
  await expect(page.locator('[data-testid="confirm-cancel"]')).toHaveText('Keep climbing');
  await tap(page, '[data-testid="confirm-cancel"]');
  await page.waitForSelector('.sheet', { state: 'detached' });
  expect(await page.evaluate(() => JSON.stringify((window as any).__TC__.getSave().tower))).toBe(before);
  await tap(page, '[data-testid="end-climb"]');
  await tap(page, '[data-testid="confirm-ok"]');
  await page.waitForSelector('[data-screen="runover"]');
  await expect(text(page, 'runover-floor')).toHaveText('Floor 26');
  await expect(text(page, 'new-best')).toHaveCount(0);
  const t = await page.evaluate(() => (window as any).__TC__.getSave().tower);
  expect(t.climb).toBeNull();
  expect(t.best).toBe(30);
  expect(t.history[0].floor).toBe(26);
});

test('tower flow: run over: the lights reach the flag on a new best, and stop at the right height otherwise', async ({ page }) => {
  await ready(page);
  await speedUp(page);
  await page.evaluate(() => (window as any).__TC__.runOver({ floor: 143, oldBest: 142, newBest: true, run: { floorsCleared: 142, phasesCompleted: 428, guardiansBeaten: 14 } }));
  await page.waitForSelector('[data-screen="runover"]');
  await expect(text(page, 'new-best')).toHaveText('A new best!');
  await expect(text(page, 'fairy-lights')).toHaveAttribute('data-fraction', '1.000');
  await expect(text(page, 'pill-floor')).toHaveText('Floor 143');
  await expect(text(page, 'pill-best')).toHaveText('Old best 142');
  await expect(page.locator('.ro-reached')).toHaveText('Your climb reached');
  await expect(text(page, 'runover-floor')).toHaveText('Floor 143');
  await expect(text(page, 'stat-floors')).toHaveText('142Floors cleared');
  await expect(text(page, 'stat-phases')).toHaveText('428Phases completed');
  await expect(text(page, 'stat-guardians')).toHaveText('14Guardians beaten');
  await expect(text(page, 'stat-best')).toHaveText('142Old best floor');
  await expect(text(page, 'new-climb')).toHaveText('Start a new climb');
  await expect(page.locator('[data-testid="runover"] [data-testid="back-tower"]')).toHaveText('Back to the Tower');
  const flagTop = await page.evaluate(() => {
    const pill = document.querySelector('[data-testid="pill-floor"]')!.getBoundingClientRect();
    const art = document.querySelector('[data-testid="runover-tower"]')!.getBoundingClientRect();
    return (pill.top + pill.height / 2 - art.top) / art.height;
  });
  // The pill sits beside the flag, at the very top of the tower.
  expect(flagTop).toBeLessThan(0.15);

  await page.evaluate(() => (window as any).__TC__.runOver({ floor: 21, oldBest: 60, newBest: false, run: { floorsCleared: 20, phasesCompleted: 66, guardiansBeaten: 2 } }));
  await page.waitForFunction(() => document.querySelector('[data-testid="runover-floor"]')?.textContent === 'Floor 21');
  await expect(text(page, 'new-best')).toHaveCount(0);
  await expect(text(page, 'fairy-lights')).toHaveAttribute('data-fraction', (21 / 60).toFixed(3));
  await expect(text(page, 'pill-best')).toHaveText('Best 60');
  await expect(text(page, 'stat-best')).toHaveText('60Best floor');
});

test('tower: the Stats section and the How to Play section, in their exact words', async ({ page }) => {
  await openApp(page);
  await towerSave(page, { lunaria: false });
  await tap(page, '[data-testid="nav-stats"]');
  await expect(page.locator('[data-testid="tower-stats"]')).toHaveCount(0);
  await towerSave(page, { tower: { best: 0, history: [], totals: { climbs: 0, floorsCleared: 0, guardiansBeaten: 0 } } });
  await tap(page, '[data-testid="nav-stats"]');
  await expect(page.locator('[data-testid="tower-stats"] h2')).toHaveText('The Tower');
  await expect(page.locator('[data-testid="no-climbs"]')).toHaveText('No climbs yet');
  const history = Array.from({ length: 14 }, (_, i) => ({ floor: 30 - i, endedAt: Date.UTC(2026, 10, 1 + i, 12), newBest: i === 13 }));
  await towerSave(page, { tower: { best: 30, history: history.slice().reverse(), totals: { climbs: 14, floorsCleared: 290, guardiansBeaten: 25 } } });
  await tap(page, '[data-testid="nav-stats"]');
  const stats = page.locator('[data-testid="tower-stats"]');
  await expect(stats.locator('.stat small')).toHaveText(['Best floor', 'Climbs', 'Floors cleared', 'Guardians beaten']);
  await expect(stats.locator('.stat b')).toHaveText(['30', '14', '290', '25']);
  await expect(stats.locator('h3')).toHaveText('Recent climbs');
  const rows = stats.locator('.recent-row');
  await expect(rows).toHaveCount(10);
  await expect(rows.first().locator('b')).toHaveText('Floor 17');
  await expect(rows.first()).toHaveAttribute('data-new-best', 'true');
  await expect(rows.first().locator('.icon')).toHaveCount(1);
  await expect(rows.nth(1).locator('.icon')).toHaveCount(0);
  await expect(rows.first().locator('span').last()).toHaveText('Nov 14, 2026');

  // How to Play, from the pause menu, after the Moonlit Phases section.
  await page.evaluate(() => (window as any).__TC__.startMatch({ lineup: ['pip'] }));
  await page.waitForSelector('[data-screen="table"]');
  await tap(page, '[data-testid="menu"]');
  await page.locator('.menu-list button', { hasText: 'How to Play' }).click();
  const how = page.locator('[data-testid="tower-howto"]');
  await expect(how.locator('h2')).toHaveText('The Tower');
  await expect(how.locator('p')).toHaveText([
    'Climb as high as you can. Each floor is a short match of three phases, drawn at random from every phase in the game and played easiest first. Win the match to climb to the next floor.',
    'You start each climb with three hearts. Lose a floor and you lose a heart, then try that floor again with new phases. When your last heart is gone, the climb ends.',
    'Every tenth floor is a Guardian floor. The Guardian wears the Thorned Crown, so no one can add to their groups. Beat the Guardian to win back a heart.',
    "Every ten floors the sky changes and the tables grow tougher. From Tier 4, the Moonlit Fog hides everyone's card count. Your best floor is kept forever.",
  ]);
  const order = await page.evaluate(() => [...document.querySelectorAll('.howto .how-sec h2')].map((h) => h.textContent));
  expect(order.indexOf('The Tower')).toBe(order.indexOf('Moonlit Phases') + 1);
});
