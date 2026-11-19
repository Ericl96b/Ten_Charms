// The tower art (TOWER_SPEC.md §6): every floor's look comes from its number; climbed, current and ahead floors and
// Guardian floors look as the spec says.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { WINDOW_DESIGNS, floorLook, floorState, referenceStrip, towerStrip, windowDesign, wholeTower, type TowerKit } from '../../src/ui/tower/art.ts';

const kit = JSON.parse(readFileSync('public/art/tower-kit.json', 'utf8')) as TowerKit;

describe('window designs', () => {
  test('neighbouring ordinary floors never share a design, up to floor 10,000', () => {
    for (let n = 1; n < 10000; n++) {
      if (n % 10 === 0 || (n + 1) % 10 === 0) continue;
      assert.notEqual(windowDesign(n), windowDesign(n + 1), `floors ${n} and ${n + 1}`);
    }
  });

  test('floor N looks the same every time, in every climb', () => {
    for (const n of [1, 9, 37, 41, 143, 999]) assert.deepEqual(floorLook(n, kit), floorLook(n, kit));
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(windowDesign), [1, 2, 3, 4, 5, 6, 7].map(windowDesign));
  });

  test('all six designs are used, about equally', () => {
    const count = new Map<string, number>();
    for (let n = 1; n <= 6000; n++) count.set(windowDesign(n), (count.get(windowDesign(n)) ?? 0) + 1);
    assert.deepEqual([...count.keys()].sort(), [...WINDOW_DESIGNS].sort());
    for (const c of count.values()) assert.ok(c > 900 && c < 1100);
  });

  test('every design has a lit and a dark version in the kit', () => {
    for (const d of WINDOW_DESIGNS) {
      assert.ok(kit.windows[d].lit.svg.includes('url(#tcLit)'), `${d} lit`);
      assert.ok(kit.windows[d].dark.svg.includes('url(#tcDark)'), `${d} dark`);
      assert.ok(!kit.windows[d].dark.svg.includes('url(#tcLit)'), `${d} dark has no warm glass`);
    }
  });
});

describe('floor states', () => {
  test('climbed floors are lit, the current floor is lit, floors ahead are lavender with closed curtains', () => {
    assert.deepEqual([35, 36, 37, 38].map((n) => floorState(n, 37)), ['climbed', 'climbed', 'current', 'ahead']);
    for (const n of [31, 32, 33, 34, 36, 37, 38, 39, 41, 42]) {
      const strip = towerStrip(kit, n, n, 37);
      const ahead = n > 37;
      assert.equal(strip.svg.includes('url(#tcLit)'), !ahead, `floor ${n}`);
      assert.equal(strip.svg.includes('url(#tcDark)'), ahead, `floor ${n}`);
    }
  });

  test('a Guardian floor has the lavender stone, gold-trimmed ledges, the crowned door and the banners', () => {
    const strip = towerStrip(kit, 40, 40, 37);
    assert.ok(strip.svg.includes(kit.guardianBand.svg), 'lavender stone');
    assert.ok(strip.svg.includes('#D8C5EA'), 'lavender stone');
    assert.ok(strip.svg.includes(kit.guardian), 'the door, crown and banners');
    assert.ok(kit.guardian.includes('url(#tcGoldV)') && kit.guardian.includes('#C9B0E4'), 'gold door and lavender banners');
    assert.ok(kit.guardian.includes('url(#tcRoseL)'), 'lavender roses');
    assert.ok(strip.svg.includes('stroke="#D9A441"'), 'gold-trimmed ledge');
    assert.ok(!strip.svg.includes('url(#tcLit)') && !strip.svg.includes('url(#tcDark)'), 'no ordinary window');
  });

  test('the strip is deterministic: the same floors draw the same art', () => {
    assert.equal(towerStrip(kit, 30, 38, 34).svg, towerStrip(kit, 30, 38, 34).svg);
    assert.equal(wholeTower(kit).svg, wholeTower(kit).svg);
  });

  test('the reference floors 35 to 41 are drawn from the reference pieces', () => {
    const strip = referenceStrip(kit);
    assert.equal(strip.height, 6 * 92 + 118);
    assert.deepEqual([...strip.tops.entries()], [[41, 0], [40, 92], [39, 210], [38, 302], [37, 394], [36, 486], [35, 578]]);
  });
});
