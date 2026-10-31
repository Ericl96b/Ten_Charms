import { expect, openApp, test } from './helpers.ts';

test('the settings button shows a gear, in the same style and size as the other icons', async ({ page }) => {
  await openApp(page);
  const button = page.getByRole('button', { name: 'Settings' });
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  const gear = await button.locator('svg').evaluate((svg) => {
    const outline = svg.querySelector('path')!;
    const hole = svg.querySelector('circle')!;
    const style = getComputedStyle(outline);
    return {
      points: outline.getAttribute('d')!.split('L').length,
      hole: Number(hole.getAttribute('r')),
      strokeWidth: style.strokeWidth,
      fill: style.fill,
      color: getComputedStyle(svg).color,
      size: svg.getBoundingClientRect().width,
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    };
  });
  // Four points per tooth, so eight teeth around a center hole.
  expect(gear.points).toBe(32);
  expect(gear.hole).toBeGreaterThan(0);
  expect(parseFloat(gear.strokeWidth)).toBe(2);
  expect(gear.fill).toBe('none');
  expect(gear.color.replace(/\s/g, '')).toBe('rgb(91,35,64)');
  expect(gear.size).toBeCloseTo(gear.rem * 2.4, 1);
});
