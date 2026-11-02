import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect, test as base, type Page } from '@playwright/test';

export const LOG_DIR = 'test-results/juice';

/** Skips the install helper, which every browser-tab launch would otherwise show first. */
export async function prepare(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((extraSave) => {
    if (!localStorage.getItem('ten-charms.save')) {
      localStorage.setItem('ten-charms.save', JSON.stringify({ schema: 1, install: { dismissedAt: Date.now() }, ...extraSave }));
    }
  }, extra);
}

export async function openApp(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await prepare(page, extra);
  await page.goto('/');
  await page.waitForFunction(() => '__TC__' in window);
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
}

export type Hooks = {
  events: { kind: string; name: string }[];
  setTestScale(s: number): void;
  startMatch(o: Record<string, unknown>): void;
  getSave(): Record<string, any>;
  loadSave(d: unknown): void;
  state(): any;
  ui(): any;
  selected(): number[];
  idle(): boolean;
  patch(src: string): void;
  autoplay(on: boolean): void;
  autoTrace(): string[];
  autoRunning(): boolean;
  soundIds: readonly string[];
};

export const tc = (page: Page, fn: string) => page.evaluate(`(() => { const t = window.__TC__; ${fn} })()`);

export async function startMatch(page: Page, opts: Record<string, unknown>): Promise<void> {
  await page.evaluate((o) => (window as unknown as { __TC__: Hooks }).__TC__.startMatch(o), opts);
  await waitIdle(page);
}

export async function waitIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __TC__: Hooks }).__TC__.idle(), null, { timeout: 60_000 });
}

export async function patch(page: Page, source: string): Promise<void> {
  await page.evaluate((src) => (window as unknown as { __TC__: Hooks }).__TC__.patch(src), source);
}

/** Finds a point where this element is really on top, once it has stopped travelling. */
export async function pointOn(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const deadline = Date.now() + 15_000;
  let last = '';
  let steady = 0;
  while (Date.now() < deadline) {
    const found = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      // Like a person, scroll a list to reach what's below the fold.
      if (el.closest('.page-scroll,.sheet-body,.map-scroll,.laid')) el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      for (let fy = 0.5; fy > 0.05; fy -= 0.1) {
        for (let fx = 0.5; fx > 0.02; fx -= 0.06) {
          for (const side of [fx, 1 - fx]) {
            const x = r.left + r.width * side;
            const y = r.top + r.height * fy;
            const hit = document.elementFromPoint(x, y);
            if (hit && (hit === el || el.contains(hit))) return { x, y, key: `${Math.round(r.left)},${Math.round(r.top)}` };
          }
        }
      }
      return null;
    }, selector);
    steady = found && found.key === last ? steady + 1 : 0;
    if (found && steady >= 3) return { x: found.x, y: found.y };
    last = found?.key ?? '';
    await page.waitForTimeout(90);
  }
  throw new Error(`No tappable point on ${selector}`);
}

/** A real touch tap. Pulsing and breathing elements never count as stable, so this doesn't wait for that. */
export async function tap(page: Page, selector: string): Promise<void> {
  const p = await pointOn(page, selector);
  await page.touchscreen.tap(p.x, p.y);
}

export async function drag(page: Page, from: string, to: string): Promise<void> {
  const a = await pointOn(page, from);
  const box = await page.locator(to).boundingBox();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 8 });
  await page.mouse.up();
}

export function card(id: number, num: number, suit = 'rose') {
  return { id, kind: 'num', num, suit };
}

/** Saves what the app fired during a test, for the coverage check at the end of the suite. */
export async function saveEventLog(page: Page, project: string, worker: number): Promise<void> {
  mkdirSync(LOG_DIR, { recursive: true });
  const events = await page.evaluate(() => {
    const hooks = (window as unknown as { __TC__?: Hooks }).__TC__;
    return hooks ? hooks.events.map((e) => `${e.kind}:${e.name}`) : [];
  }).catch(() => [] as string[]);
  appendFileSync(`${LOG_DIR}/events-${project}-${worker}.log`, [...new Set(events)].join('\n') + '\n');
}

/** Fails on any console error or uncaught exception, and collects the event log. */
export const test = base.extend<{ errors: string[] }>({
  errors: [async ({ page }, use, info) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await use(errors);
    await saveEventLog(page, info.project.name, info.workerIndex);
    expect(errors, 'no console errors').toEqual([]);
  }, { auto: true }],
});

export { expect };

export function shotPath(name: string, project: string): string {
  mkdirSync('qa-screenshots', { recursive: true });
  return `qa-screenshots/${name}-${project}.png`;
}

void writeFileSync;
