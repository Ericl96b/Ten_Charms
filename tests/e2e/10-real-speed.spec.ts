// Every other full match runs with its waits scaled down, which could hide a timing bug. Runs at 440×956 only.
import { expect, openApp, startMatch, test } from './helpers.ts';

test('a full match at real speed finishes through the real UI', async ({ page }) => {
  test.setTimeout(25 * 60_000);
  await openApp(page);
  await startMatch(page, { lineup: ['pip'], seed: 'e1'.repeat(16), botSeed: 'e2'.repeat(16) });
  await page.evaluate(() => (window as any).__TC__.autoplay(true));
  await page.waitForFunction(() => !(window as any).__TC__.autoRunning(), null, { timeout: 24 * 60_000 });
  const report = await page.evaluate(() => {
    const t = (window as any).__TC__;
    return { trace: t.autoTrace(), names: t.events.map((e: { name: string }) => e.name), save: t.getSave() };
  });
  expect(report.trace).toContain('layDown');
  expect(report.names).toContain('lay.fly');
  expect(report.names).toContain('ui.botThinking');
  expect(report.save.stats.played).toBe(1);
});
