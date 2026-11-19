// The Tower: the three-part switcher, the Crossroads and its one-time reveal (TOWER_SPEC.md §2).
import type { Page } from '@playwright/test';
import { expect, openApp, tap, test } from './helpers.ts';
import { settled, towerSave } from './tower-helpers.ts';

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const box = (page: Page, sel: string) => page.locator(sel).boundingBox() as Promise<Box>;

test('tower: the switcher shows all three options, with the padlock and its text before the Crossroads opens', async ({ page }) => {
  await openApp(page);
  await towerSave(page, { lunaria: false });
  await page.waitForSelector('[data-map="garden"]');
  await expect(page.locator('[data-testid="total-stars"]')).toHaveCount(0);
  const sign = page.locator('[data-testid="map-crossroads"]');
  await expect(sign).toHaveAttribute('aria-label', 'The Crossroads, locked. Beat Lady Lunaria to unlock.');
  await expect(sign.locator('.sign-lock')).toHaveCount(1);
  await expect(page.locator('[data-testid="map-garden"]')).toContainText('Rose Garden');
  await expect(page.locator('[data-testid="map-garden"]')).toContainText('15/15');
  await expect(page.locator('[data-testid="map-glade"]')).toContainText('Moonlit Glade');
  await expect(page.locator('[data-testid="map-glade"]')).toContainText('18/21');
  await tap(page, '[data-testid="map-crossroads"]');
  await expect(page.locator('[data-testid="tooltip"]')).toHaveText('Beat Lady Lunaria to unlock.');
  await expect(page.locator('[data-map="garden"]')).toHaveCount(1);

  // No clipping, truncation, overlap or sideways scrolling, and every option a 44-point target.
  const fit = await page.evaluate(() => {
    const sw = document.querySelector<HTMLElement>('[data-testid="map-switch"]')!;
    const r = sw.getBoundingClientRect();
    const opts = [...sw.querySelectorAll<HTMLElement>('.map-opt')].map((o) => {
      const b = o.getBoundingClientRect();
      const labels = [...o.querySelectorAll<HTMLElement>('b, small')].map((l) => l.scrollWidth <= l.clientWidth + 1);
      return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, labels };
    });
    return { scroll: sw.scrollWidth <= sw.clientWidth + 1, inside: opts.every((o) => o.l >= r.left - 0.5 && o.r <= r.right + 0.5 && o.t >= r.top - 0.5 && o.b <= r.bottom + 0.5), opts };
  });
  expect(fit.scroll).toBe(true);
  expect(fit.inside).toBe(true);
  expect(fit.opts).toHaveLength(3);
  for (const o of fit.opts) {
    expect(o.w).toBeGreaterThanOrEqual(44);
    expect(o.h).toBeGreaterThanOrEqual(44);
    expect(o.labels.every(Boolean)).toBe(true);
  }
  for (let i = 1; i < fit.opts.length; i++) expect(fit.opts[i].l).toBeGreaterThanOrEqual(fit.opts[i - 1].r - 0.5);
});

test('tower: once Lunaria is beaten the signpost opens the Crossroads, and the app reopens there', async ({ page }) => {
  await openApp(page);
  await towerSave(page);
  await page.waitForSelector('[data-map="garden"]');
  const sign = page.locator('[data-testid="map-crossroads"]');
  await expect(sign).toHaveAttribute('aria-label', 'The Crossroads');
  await expect(sign.locator('.sign-lock')).toHaveCount(0);
  await tap(page, '[data-testid="map-crossroads"]');
  await page.waitForSelector('[data-map="crossroads"]');
  await expect(page.locator('[data-testid="map-crossroads"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="xr-plate"]')).toHaveText('The Crossroads');
  await expect(page.locator('[data-testid="tower-card"]')).toContainText('SIDE QUEST');
  await expect(page.locator('[data-testid="tower-card"]')).toContainText('The Tower');
  await expect(page.locator('[data-testid="tower-best"]')).toHaveText('No climbs yet');
  await expect(page.locator('[data-testid="tower-enter"]')).toHaveText('Enter');
  await page.reload();
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await page.waitForSelector('[data-map="crossroads"]');
  await tap(page, '[data-testid="map-glade"]');
  await page.waitForSelector('[data-map="glade"]');
  await page.reload();
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await page.waitForSelector('[data-map="glade"]');
});

test('tower: the Crossroads card shows her best floor', async ({ page }) => {
  await openApp(page);
  await towerSave(page, { place: 'crossroads', tower: { best: 142 } });
  await page.waitForSelector('[data-map="crossroads"]');
  await expect(page.locator('[data-testid="tower-best"]')).toHaveText('Best floor 142');
});

test('tower: the Map 3 gate and sign show the toast; the Tower card and the tower both open Tower home', async ({ page }) => {
  await openApp(page);
  await towerSave(page, { place: 'crossroads' });
  await page.waitForSelector('[data-map="crossroads"]');
  for (const spot of ['xr-gate', 'xr-sign']) {
    await page.locator(`[data-testid="${spot}"]`).click();
    await expect(page.locator('.note-toast')).toHaveText('Map 3 is still being built. Check back soon!');
    await page.waitForSelector('.note-toast', { state: 'detached', timeout: 5000 });
  }
  await tap(page, '[data-testid="tower-enter"]');
  await page.waitForSelector('[data-screen="tower"]');
  await tap(page, '[data-testid="tower-back"]');
  await page.waitForSelector('[data-map="crossroads"]');
  await settled(page);
  await page.locator('[data-testid="xr-tower"]').click();
  await page.waitForSelector('[data-screen="tower"]');
  await settled(page);
  await expect(page.locator('[data-testid="nav-journey"]')).toHaveAttribute('aria-current', 'page');
});

test('tower: the Crossroads fits without scrolling, and nothing covers the gate, sign, signpost or tower', async ({ page }, info) => {
  await openApp(page);
  await towerSave(page, { place: 'crossroads' });
  await page.waitForSelector('[data-map="crossroads"].ready');
  await page.waitForTimeout(300);
  const fits = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.crossroads-screen')!;
    // Nothing on the page can scroll: the screen clips, and the document is no larger than the window.
    const doc = document.documentElement;
    return getComputedStyle(root).overflow === 'hidden' && doc.scrollHeight <= window.innerHeight + 1 && doc.scrollWidth <= window.innerWidth + 1;
  });
  expect(fits).toBe(true);
  // TOWER_SPEC.md §2.5 sets these two sizes; the smaller phones show the same parts, nearer together.
  if (!['max', 'android'].includes(info.project.name)) return;
  const img = await box(page, '.xr-art');
  const vp = page.viewportSize()!;
  expect(img.y + img.height).toBeLessThanOrEqual(vp.height + 1);
  const covers = [await box(page, '[data-testid="tower-card"]'), await box(page, '[data-testid="xr-plate"]'), await box(page, '[data-testid="map-top"]')];
  for (const mark of ['xr-gate', 'xr-sign', 'xr-signpost', 'xr-tower']) {
    const m = await box(page, `[data-testid="${mark}"]`);
    for (const c of covers) expect(overlap(c, m), `${mark} covered`).toBe(false);
  }
});

test('tower: the Crossroads reveal plays once, lands on the Crossroads with Enter pulsing, and never replays', async ({ page }) => {
  await openApp(page);
  await towerSave(page, { place: 'glade', revealSeen: false });
  await expect(page.locator('[data-testid="xr-reveal-banner"]')).toHaveText('Two paths lie ahead…');
  expect((await page.evaluate(() => (window as any).__TC__.getSave())).tower.revealSeen).toBe(true);
  await page.waitForSelector('[data-map="crossroads"]', { timeout: 10_000 });
  await page.waitForSelector('[data-testid="xr-reveal-banner"]', { state: 'detached' });
  const events = await page.evaluate(() => (window as any).__TC__.events.map((e: any) => e.name));
  expect(events).toContain('crossroads.reveal');
  expect(events).toContain('crossroads.enterPulse');
  await page.reload();
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await page.waitForSelector('[data-map="crossroads"]');
  await expect(page.locator('[data-testid="xr-reveal-banner"]')).toHaveCount(0);
});

test('tower: a tap skips the Crossroads reveal, and a force-quit midway never replays it', async ({ page }) => {
  await openApp(page);
  await towerSave(page, { place: 'glade', revealSeen: false });
  await page.waitForSelector('[data-testid="xr-reveal-skip"]');
  const started = Date.now();
  await page.locator('[data-testid="xr-reveal-skip"]').click();
  await page.waitForSelector('[data-map="crossroads"]', { timeout: 10_000 });
  expect(Date.now() - started).toBeLessThan(3000);
  // Quitting during a reveal, before it lands: it still counts as seen.
  await towerSave(page, { place: 'glade', revealSeen: false });
  await page.waitForSelector('[data-testid="xr-reveal-banner"]');
  await page.reload();
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await page.waitForSelector('[data-map="crossroads"]');
  await expect(page.locator('[data-testid="xr-reveal-banner"]')).toHaveCount(0);
});

test('tower: the reveal waits while the fog-lift scene is owed, and plays the time after', async ({ page }) => {
  await openApp(page);
  await towerSave(page, { place: 'garden' });
  await page.waitForSelector('[data-map="garden"]');
  // Lunaria just beaten for the first time: the fog-lift scene is owed on the Glade, and the reveal not yet seen.
  await page.evaluate(() => {
    const t = (window as any).__TC__;
    const s = t.getSave();
    s.glade.liftScenePending = true;
    s.glade.lastMap = 'glade';
    s.tower.revealSeen = false;
    t.loadSave(s);
  });
  await page.waitForSelector('[data-map="glade"]');
  await expect(page.locator('[data-testid="xr-reveal-banner"]')).toHaveCount(0);
  await page.waitForTimeout(800);
  await tap(page, '[data-testid="nav-stats"]');
  await page.waitForSelector('[data-screen="stats"]');
  await tap(page, '[data-testid="nav-journey"]');
  await expect(page.locator('[data-testid="xr-reveal-banner"]')).toHaveText('Two paths lie ahead…');
  await page.waitForSelector('[data-map="crossroads"]', { timeout: 10_000 });
});
