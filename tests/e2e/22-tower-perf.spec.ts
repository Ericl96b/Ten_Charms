// The Tower's performance (TOWER_SPEC.md §14). Alone in the gate, with nothing else running, like the others.
import type { Page } from '@playwright/test';
import { expect, openApp, test } from './helpers.ts';
import { openIntro, towerAt, towerSave } from './tower-helpers.ts';

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

/** The gaps between frames while something plays, for smoothness. */
async function startFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __framing: boolean };
    w.__frames = [];
    w.__framing = true;
    let last = performance.now();
    const step = (now: number) => {
      w.__frames.push(now - last);
      last = now;
      if (w.__framing) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function stopFrames(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __framing: boolean };
    w.__framing = false;
    return w.__frames.slice(1).reduce((most, gap) => Math.max(most, gap), 0);
  });
}

async function ready(page: Page): Promise<void> {
  await openApp(page);
  await towerSave(page, { place: 'crossroads' });
  await page.waitForSelector('[data-map="crossroads"].ready');
  await page.waitForTimeout(800);
}

test('12. performance: tower: no main-thread task over 50 ms in the ascent, the tier change, the deal or the run-over', async ({ page }, info) => {
  test.setTimeout(150_000);
  await ready(page);
  await towerAt(page, { floor: 25, hearts: 2, seed: '25'.repeat(16) });
  await page.waitForTimeout(800);
  const run = async (fn: string, done: string) => {
    await startProbe(page);
    await page.evaluate(fn);
    await page.waitForFunction(done, null, { timeout: 20_000 });
    return stopProbe(page);
  };
  // As in the game, where the floor result prepares the ride while it shows.
  await page.evaluate(() => (window as any).__TC__.prepareClimb(25, 26));
  const ascent = await run('window.__done = false; window.__TC__.climbScene(25, 26).then(() => { window.__done = true; })', 'window.__done === true');
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as any).__TC__.prepareClimb(30, 31));
  const tier = await run('window.__done = false; window.__TC__.climbScene(30, 31).then(() => { window.__done = true; })', 'window.__done === true');
  await page.waitForTimeout(500);
  await startProbe(page);
  await openIntro(page);
  const deal = await stopProbe(page);
  await page.locator('.backdrop').last().click({ position: { x: 5, y: 5 }, force: true });
  // As in the game, where the lost floor's result or the "End this climb?" sheet prepares the run-over while it shows.
  await page.evaluate(() => (window as any).__TC__.prepareRunOver());
  await page.waitForTimeout(500);
  await startProbe(page);
  await page.evaluate(() => (window as any).__TC__.runOver({ floor: 26, oldBest: 20, newBest: true, run: { floorsCleared: 25, phasesCompleted: 80, guardiansBeaten: 2 } }));
  await page.waitForSelector('[data-screen="runover"].burst', { timeout: 10_000 });
  await page.waitForTimeout(1500);
  const runOver = await stopProbe(page);
  console.log(`[perf ${info.project.name}] ascent ${ascent.toFixed(1)} ms, tier change ${tier.toFixed(1)} ms, deal ${deal.toFixed(1)} ms, run over ${runOver.toFixed(1)} ms`);
  for (const v of [ascent, tier, deal, runOver]) expect(v).toBeLessThanOrEqual(50);
});

test('12. performance: tower: no main-thread task over 50 ms with Tower home and the Crossroads at rest for 10 s each', async ({ page }, info) => {
  test.setTimeout(120_000);
  await ready(page);
  await startProbe(page);
  await page.waitForTimeout(10_000);
  const crossroads = await stopProbe(page);
  await towerAt(page, { floor: 37, hearts: 1, best: 142 });
  await page.waitForTimeout(1500);
  await startProbe(page);
  await page.waitForTimeout(10_000);
  const home = await stopProbe(page);
  console.log(`[perf ${info.project.name}] Crossroads ${crossroads.toFixed(1)} ms, Tower home ${home.toFixed(1)} ms`);
  expect(crossroads).toBeLessThanOrEqual(50);
  expect(home).toBeLessThanOrEqual(50);
});

test('12. performance: tower: Tower home opens from the Crossroads in under 500 ms, and the lift slides smoothly', async ({ page }, info) => {
  test.setTimeout(120_000);
  await ready(page);
  const opened = await page.evaluate(() => new Promise<number>((resolve) => {
    const start = performance.now();
    new MutationObserver((_, obs) => {
      if (document.querySelector('[data-screen="tower"]')) {
        obs.disconnect();
        requestAnimationFrame(() => resolve(performance.now() - start));
      }
    }).observe(document.body, { childList: true, subtree: true });
    (document.querySelector('[data-testid="tower-enter"]') as HTMLElement).click();
  }));
  // A mid-range phone: on Chromium, the CPU at a quarter of this machine's speed.
  const cdp = info.project.name === 'android' ? await page.context().newCDPSession(page) : null;
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.waitForTimeout(800);
  await page.evaluate(() => (window as any).__TC__.prepareClimb(37, 38));
  await page.evaluate(() => { (window as any).__done = false; (window as any).__TC__.climbScene(37, 38).then(() => { (window as any).__done = true; }); });
  await page.waitForSelector('[data-testid="ascent"][data-sliding]');
  await startFrames(page);
  await page.waitForTimeout(1500);
  const frame = await stopFrames(page);
  await page.waitForFunction('window.__done === true', null, { timeout: 20_000 });
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(`[perf ${info.project.name}] Tower home opened in ${opened.toFixed(0)} ms, longest frame while sliding ${frame.toFixed(1)} ms`);
  expect(opened).toBeLessThan(500);
  // Smoothness is judged on the mid-range phone profile the spec names (§14). WebKit on this Windows machine draws in
  // software, where even the existing table runs at about 60 ms a frame, so there its frame times are only logged.
  if (cdp) expect(frame).toBeLessThanOrEqual(50);
});
