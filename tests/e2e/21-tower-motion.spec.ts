// The Tower's motion and sound (TOWER_SPEC.md §9): the lift, skipping, Reduced Motion, sky bands and music layers.
import type { Page } from '@playwright/test';
import { expect, openApp, test } from './helpers.ts';
import { openIntro, towerAt, towerSave } from './tower-helpers.ts';

const hooks = (page: Page, fn: string) => page.evaluate(`(() => { const t = window.__TC__; return ${fn}; })()`) as Promise<any>;

async function ready(page: Page, scale = 0.25): Promise<void> {
  await openApp(page);
  await towerSave(page, { place: 'crossroads' });
  await page.waitForSelector('[data-map="crossroads"]');
  await hooks(page, `t.setTestScale(${scale})`);
}

async function ride(page: Page, from: number, to: number, skipAfter?: number): Promise<any> {
  await page.waitForSelector('[data-testid="ascent"]', { state: 'detached' });
  await page.evaluate(([a, b]) => { (window as any).__lift = (window as any).__TC__.climbScene(a, b); }, [from, to]);
  await page.waitForSelector('[data-testid="ascent"]');
  if (skipAfter !== undefined) {
    await page.waitForTimeout(skipAfter);
    await page.locator('[data-testid="ascent"]').dispatchEvent('pointerdown');
  }
  await page.evaluate(() => (window as any).__lift);
  return hooks(page, 't.lastLift()');
}

test('tower flow: the ascent moves exactly one floor, and a tap lands on the same end state', async ({ page }) => {
  await ready(page);
  const full = await ride(page, 15, 16);
  expect(full.skipped).toBe(false);
  expect(full.counter).toBe('16');
  expect(Math.abs(full.shift - full.floorPx)).toBeLessThan(0.5);
  const skipped = await ride(page, 15, 16, 80);
  expect(skipped.skipped).toBe(true);
  expect(skipped.counter).toBe(full.counter);
  expect(skipped.endY).toBeCloseTo(full.endY, 1);
  const events = await hooks(page, 't.events.map((e) => e.name)');
  for (const name of ['tower.ascent', 'tower.liftSettle', 'tower.liftSkip', 'liftRatchet', 'liftBell']) expect(events).toContain(name);
});

test('tower flow: the tier change rises past the Guardian, through the cloud, to the new sky and its banner', async ({ page }) => {
  await ready(page);
  const full = await ride(page, 40, 41);
  expect(full.counter).toBe('41');
  expect(full.banner).toBe('TIER 5Aurora');
  const skipped = await ride(page, 40, 41, 150);
  expect(skipped.endY).toBeCloseTo(full.endY, 1);
  expect(skipped.counter).toBe('41');
  const events = await hooks(page, 't.events.map((e) => e.name)');
  for (const name of ['tower.tierChange', 'tower.cloudBank', 'tower.tierBanner', 'cloudSwell', 'tierFlourish']) expect(events).toContain(name);
});

test('tower flow: "Climb" plays the ascent, then Tower home opens with the next floor\'s intro', async ({ page }) => {
  await ready(page, 0.05);
  await towerAt(page, { floor: 3, hearts: 3, seed: '3c'.repeat(16) });
  await openIntro(page);
  await page.locator('[data-testid="begin-floor"]').click();
  await page.waitForSelector('[data-screen="table"]');
  await page.waitForFunction(() => (window as any).__TC__.idle(), null, { timeout: 60_000 });
  await page.evaluate(() => (window as any).__TC__.forceFloor(true));
  await page.waitForSelector('[data-testid="climb"]');
  await page.locator('[data-testid="climb"]').click();
  await page.waitForSelector('[data-testid="floor-intro"]', { timeout: 20_000 });
  await expect(page.locator('[data-testid="intro-title"]')).toHaveText('Floor 4');
  expect((await hooks(page, 't.lastLift()')).to).toBe(4);
});

test('tower flow: sky bands follow the tier and cycle every five tiers; the music adds a layer per tier up to four', async ({ page }) => {
  await ready(page, 0.05);
  const want: [number, string, number][] = [[1, 'sky-rose-dawn', 1], [11, 'sky-peach-noon', 2], [21, 'sky-lavender-dusk', 3], [31, 'sky-starlit-pink-night', 4], [41, 'sky-aurora', 4], [51, 'sky-rose-dawn', 4], [61, 'sky-peach-noon', 4]];
  for (const [floor, sky, layers] of want) {
    await towerAt(page, { floor, hearts: 3 });
    await expect(page.locator('[data-screen="tower"]')).toHaveClass(new RegExp(sky));
    await expect(page.locator('[data-screen="tower"]')).toHaveAttribute('data-tier', String(Math.ceil(floor / 10)));
    const events = await hooks(page, 't.events.map((e) => e.name)');
    expect(events.filter((n: string) => n.startsWith('music.towerLayers')).at(-1)).toBe(`music.towerLayers${layers}`);
  }
  const events = await hooks(page, 't.events.map((e) => e.name)');
  expect(events).toContain('music.tower');
});

test('tower flow: under Reduced Motion the deal shows the cards face up, and the lift crossfades with its banner still', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { const t = (window as any).__TC__; const s = t.getSave(); s.settings.reducedMotion = true; t.loadSave(s); });
  await page.reload();
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await hooks(page, 't.setTestScale(1)');
  await towerAt(page, { floor: 9, hearts: 1, seed: '9a'.repeat(16) });
  await page.locator('[data-testid="tower-play"]').click();
  await page.waitForSelector('[data-testid="floor-intro"]');
  await expect(page.locator('.ph-card.up')).toHaveCount(3, { timeout: 200 });
  // Ambient motion stops.
  expect(await page.evaluate(() => document.querySelector('[data-testid="cage"]')!.getAnimations().length)).toBe(0);
  await page.locator('.backdrop').last().click({ position: { x: 5, y: 5 }, force: true });
  const started = Date.now();
  const lift = await ride(page, 9, 10);
  expect(lift.reduced).toBe(true);
  expect(lift.counter).toBe('10');
  expect(Date.now() - started).toBeLessThan(1500);
  const tier = await ride(page, 10, 11);
  expect(tier.banner).toBe('TIER 2Peach Noon');
  // Hearts change state without the crack or the fill; the run-over shows its final state at once.
  await page.evaluate(() => (window as any).__TC__.runOver({ floor: 12, oldBest: 10, newBest: true, run: { floorsCleared: 11, phasesCompleted: 35, guardiansBeaten: 1 } }));
  await page.waitForSelector('[data-screen="runover"].burst');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="runover-card"]')!).opacity)).toBe('1');
});
