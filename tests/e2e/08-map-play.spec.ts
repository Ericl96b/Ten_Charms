import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { simulateInsets } from './fixtures.ts';
import { expect, openApp, tap, test } from './helpers.ts';

const STOPS = ['Pip', 'Marigold', 'Briar', 'Hoot', 'Nightshade'];
/** Roughly the Dynamic Island and home indicator on a large iPhone. */
const INSETS = { top: 62, bottom: 34 };

type Rect = { left: number; top: number; right: number; bottom: number; name: string };

const makeCurrent = (page: Page, stop: number) => page.evaluate((k) => {
  const t = (window as any).__TC__;
  const s = t.getSave();
  s.match = null;
  s.tutorial.done = true;
  s.campaign.won = [0, 1, 2, 3, 4].map((i) => i < k);
  s.campaign.stars = [3, 2, 3, 1, 0].map((n, i) => (i < k ? n : 0));
  t.loadSave(s);
}, stop);

const measure = (page: Page) => page.evaluate(() => {
  const rect = (el: Element, name: string): Rect => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, name };
  };
  const sat = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0;
  const sab = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0;
  const play = document.querySelector('[data-testid="play"]')!;
  const chip = document.querySelector('[data-testid="reward-chip"]')!;
  const others: Rect[] = [];
  document.querySelectorAll('.stop').forEach((stop) => {
    const id = stop.getAttribute('data-testid')!;
    stop.querySelectorAll('.stop-medal, .stars, .name-plate, .boss-plate').forEach((el) => others.push(rect(el, `${id} ${el.className}`)));
  });
  others.push(rect(document.querySelector('.map-top')!, 'top bar'), rect(document.querySelector('.bottom-nav')!, 'bottom nav'));
  return {
    play: rect(play, 'play'),
    chip: rect(chip, 'chip'),
    others,
    sat,
    sab,
    chipText: chip.textContent!,
    chipClipped: chip.scrollWidth > chip.clientWidth + 1,
    width: window.innerWidth,
    height: window.innerHeight,
    node: rect(document.querySelector('.stop.current .stop-medal')!, 'node'),
    plate: rect(document.querySelector('.stop.current .name-plate, .stop.current .boss-plate')!, 'plate'),
  };
});

const overlap = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

for (const insets of [null, INSETS]) {
  test.describe(insets ? 'with simulated safe areas' : 'at the plain viewport', () => {
    for (const [stop, name] of STOPS.entries()) {
      test(`${name} as the current stop: Play and reward stay on screen, clear of everything`, async ({ page }, info) => {
        if (insets) await simulateInsets(page, insets.top, insets.bottom);
        await openApp(page);
        await makeCurrent(page, stop);
        await page.waitForTimeout(300);
        const m = await measure(page);

        for (const r of [m.play, m.chip, m.node, m.plate]) {
          expect(r.top, `${r.name} below the top`).toBeGreaterThanOrEqual(m.sat);
          expect(r.bottom, `${r.name} above the bottom`).toBeLessThanOrEqual(m.height - m.sab);
        }
        for (const r of [m.play, m.chip]) {
          expect(r.left, `${r.name} left margin`).toBeGreaterThanOrEqual(16);
          expect(r.right, `${r.name} right margin`).toBeLessThanOrEqual(m.width - 16);
          expect(r.top, `${r.name} top margin`).toBeGreaterThanOrEqual(m.sat + 16);
          expect(r.bottom, `${r.name} bottom margin`).toBeLessThanOrEqual(m.height - m.sab - 16);
          for (const other of m.others) expect(overlap(r, other), `${r.name} clear of ${other.name}`).toBe(false);
        }
        expect(m.play.bottom - m.play.top).toBeGreaterThanOrEqual(44);
        expect(m.chipClipped).toBe(false);
        expect(m.chipText.startsWith('Win: ')).toBe(true);

        // Still reads as belonging to its stop.
        const gapX = Math.max(0, Math.max(m.play.left, m.node.left) - Math.min(m.play.right, m.node.right));
        const gapY = Math.max(0, Math.max(m.play.top, m.plate.top) - Math.min(m.play.bottom, m.plate.bottom));
        expect(gapX + gapY).toBeLessThan(120);

        if (!insets) {
          mkdirSync('qa-screenshots/cr01/map', { recursive: true });
          await page.screenshot({ path: `qa-screenshots/cr01/map/${name.toLowerCase()}-${info.project.name}.png` });
        }

        await tap(page, '[data-testid="play"]');
        await expect(page.locator('[data-testid="match-intro"]')).toBeVisible();
      });
    }
  });
}
