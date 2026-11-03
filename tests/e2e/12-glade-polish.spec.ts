// The Moonlit Glade's polish: performance during its scenes and drifting fog, and short recordings for review.
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, openApp, patch, tap, test, waitIdle } from './helpers.ts';

/** Measures the longest gap in a main-thread message loop: a stand-in for the longest task. */
async function startProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __probe: boolean };
    w.__gaps = [];
    w.__probe = true;
    const ch = new MessageChannel();
    let last = performance.now();
    ch.port1.onmessage = () => {
      const now = performance.now();
      w.__gaps.push(now - last);
      last = now;
      if (w.__probe) ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
  });
}

async function stopProbe(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __probe: boolean };
    w.__probe = false;
    return w.__gaps.reduce((most, gap) => Math.max(most, gap), 0);
  });
}

async function gladeSave(page: Page, winOrder: string[], extra: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(([order, more]) => {
    const t = (window as any).__TC__;
    const s = t.getSave();
    s.match = null;
    s.tutorial.done = true;
    s.backupPrompted = true;
    s.campaign.won = [true, true, true, true, true];
    s.glade = { ...s.glade, winOrder: order, stars: Object.fromEntries((order as string[]).map((id) => [id, 1])), revealSeen: true, lastMap: 'glade', ...(more as object) };
    t.loadSave(s);
  }, [winOrder, extra] as const);
  await page.waitForSelector('[data-map="glade"]');
}

test('12. performance: no main-thread task over 50 ms in Lunaria\'s intro or the fog-lift scene', async ({ page }, info) => {
  test.setTimeout(120_000);
  await openApp(page);
  await gladeSave(page, ['g1', 'a1', 'a2', 'g2']);
  await tap(page, '[data-testid="glade-g3"] .stop-btn');
  await tap(page, '[data-testid="begin"]');
  // Only while the intro is on screen. Building the table before it, and starting it after, are separate steps
  // every match takes, so the gaps are timed and only those that end before the intro leaves count.
  await page.waitForSelector('[data-testid="boss-intro"]');
  await page.evaluate(() => {
    const w = window as unknown as { __spans: [number, number][]; __gone: number };
    w.__spans = [];
    w.__gone = Infinity;
    const ch = new MessageChannel();
    let last = performance.now();
    ch.port1.onmessage = () => {
      const now = performance.now();
      w.__spans.push([now - last, now]);
      last = now;
      if (w.__gone === Infinity) ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
    new MutationObserver((_, obs) => {
      if (!document.querySelector('[data-testid="boss-intro"]')) { w.__gone = performance.now(); obs.disconnect(); }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 20_000 });
  const intro = await page.evaluate(() => {
    const w = window as unknown as { __spans: [number, number][]; __gone: number };
    return w.__spans.filter(([, end]) => end <= w.__gone).reduce((most, [gap]) => Math.max(most, gap), 0);
  });

  // The scene plays the first time the map shows after the first boss win.
  await page.evaluate(() => { (window as any).__TC__.setTestScale(1); });
  await page.evaluate(() => { const t = (window as any).__TC__; const s = t.getSave(); s.match = null; t.loadSave(s); });
  await gladeSave(page, ['g1', 'a1', 'a2', 'g2', 'g3'], { fogLifted: true, liftScenePending: true });
  await startProbe(page);
  await expect(page.locator('[data-testid="lift-banner"]')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2500);
  const lift = await stopProbe(page);
  console.log(`[perf ${info.project.name}] Lunaria intro ${intro.toFixed(1)} ms, fog lift ${lift.toFixed(1)} ms`);
  expect(intro).toBeLessThanOrEqual(50);
  expect(lift).toBeLessThanOrEqual(50);
});

test('12. performance: no main-thread task over 50 ms with the clouds drifting for 10 s', async ({ page }, info) => {
  test.setTimeout(120_000);
  await openApp(page);
  await gladeSave(page, ['g1', 'a1']);
  await page.waitForTimeout(500);
  await startProbe(page);
  await page.waitForTimeout(10_000);
  const map = await stopProbe(page);

  await tap(page, '[data-testid="glade-a2"] .stop-btn');
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-screen="table"]');
  await waitIdle(page);
  await expect(page.locator('.table-screen.fogged .fog .cloud').first()).toBeAttached();
  // Let the deal's last flourishes finish; the 10 s are of a table at rest with the clouds moving.
  await page.waitForTimeout(2000);
  await startProbe(page);
  await page.waitForTimeout(10_000);
  const table = await stopProbe(page);
  console.log(`[perf ${info.project.name}] fogged map ${map.toFixed(1)} ms, fogged table ${table.toFixed(1)} ms`);
  expect(map).toBeLessThanOrEqual(50);
  expect(table).toBeLessThanOrEqual(50);
});

void patch;
void mkdirSync;
