// The tower drawn as vectors from the approved art (TOWER_SPEC.md §6). The pieces live in public/art/tower-kit.json,
// lifted from the reference SVGs; this file only chooses and places them. Every floor's look is fixed by its number.
// Pure string building, so it runs in tests without a browser.
import { createRng, shuffle } from '../../engine/rng.ts';

export type KitPiece = { svg: string; dy: number; derived?: boolean };
export type TowerKit = {
  defs: string;
  bands: { h: number; svg: string; from: string }[];
  guardianBand: { h: number; svg: string };
  ledges: { pink: string; lav: string; gold: string };
  windows: Record<WindowDesign, { lit: KitPiece; dark: KitPiece }>;
  guardian: string;
  decor: { from: string; svg: string }[];
  top: string;
  roof: string;
  base: string;
  wholeDecor: string;
  cage: string;
  crossroads: { below: string; above: string; tower: string; viewBox: string };
  refs: {
    floors35to41: Record<string, { band: number | null; top: number; h: number; window: { design: WindowDesign; state: 'lit' | 'dark'; x: number } | null; decor: number | null }>;
    whole: { viewBox: string; floorsTop: number; floors: number };
    cage: { viewBox: string };
  };
};

export const WINDOW_DESIGNS = ['arched', 'shuttered', 'rose', 'balcony', 'lancets', 'lantern'] as const;
export type WindowDesign = (typeof WINDOW_DESIGNS)[number];
export type FloorState = 'climbed' | 'current' | 'ahead';

/** Floor heights in the art's units. The tower is 200 wide, from -100 to 100. */
export const FLOOR_H = 92;
export const GUARDIAN_H = 118;
export const TOWER_W = 200;
/** The design's own spot in the references, so a window sits slightly off center as drawn. */
const WINDOW_X: Record<WindowDesign, number> = { arched: 1.3, shuttered: -19.7, rose: -20.6, balcony: -6, lancets: 17.8, lantern: 2.2 };

const ART_SEED = '7a0e3c5d1b2f48699e0c7a5b3d1f2e48';
const isGuardian = (n: number) => n % 10 === 0;

/** A stable 32-bit hash of a floor number and a purpose. */
function hash(n: number, salt: number): number {
  const rng = createRng(ART_SEED, (n * 16 + salt) >>> 0);
  return rng.next();
}

/**
 * The window design of an ordinary floor. Floors come in runs of six, each run a seeded shuffle of the six designs;
 * where a run would start with the design the run before ended on, its first two swap. So neighbouring floors never
 * share a design, and floor N looks the same in every climb.
 */
export function windowDesign(n: number): WindowDesign {
  const run = Math.floor(n / 6);
  const at = n % 6;
  const order = (r: number) => shuffle([...WINDOW_DESIGNS], createRng(ART_SEED, 0x40000000 + r));
  const mine = order(run);
  if (run > 0 && mine[0] === order(run - 1)[5]) [mine[0], mine[1]] = [mine[1], mine[0]];
  return mine[at];
}

export type FloorLook = {
  floor: number;
  guardian: boolean;
  band: number;
  design: WindowDesign | null;
  /** Where the window sits across the floor, from the center. */
  x: number;
  decor: number | null;
};

/** Everything about how floor N looks, from its number alone. */
export function floorLook(n: number, kit: Pick<TowerKit, 'bands' | 'decor'>): FloorLook {
  if (isGuardian(n)) return { floor: n, guardian: true, band: -1, design: null, x: 0, decor: hash(n, 3) % 3 === 0 ? null : hash(n, 4) % kit.decor.length };
  const design = windowDesign(n);
  const jitter = ((hash(n, 1) % 61) - 30) / 10;
  // Some stretches of the tower are bare stone: about one floor in six has no vines.
  const bare = hash(n, 3) % 6 === 0;
  return { floor: n, guardian: false, band: hash(n, 2) % kit.bands.length, design, x: WINDOW_X[design] + jitter, decor: bare ? null : hash(n, 4) % kit.decor.length };
}

export const floorHeight = (n: number) => (isGuardian(n) ? GUARDIAN_H : FLOOR_H);

export function floorState(n: number, current: number): FloorState {
  return n < current ? 'climbed' : n === current ? 'current' : 'ahead';
}

/** A jittered outline down one edge of the tower, never ruler-straight. */
function edge(side: -1 | 1, top: number, height: number, seed: number): string {
  const rng = createRng(ART_SEED, 0x20000000 + seed);
  let d = `M${side * 100} ${top}`;
  for (let y = 0; y <= height; y += 6) d += ` L${(side * (100 + (rng.below(15) - 4) / 10)).toFixed(1)} ${top + y}`;
  return `<path d="${d}" fill="none" stroke="#D9A5AF" stroke-width="1.6" stroke-linejoin="round" opacity=".9"/>`;
}

const at = (y: number, svg: string) => `<g transform="translate(0 ${round(y)})">${svg}</g>`;
const round = (v: number) => Math.round(v * 10) / 10;

export type StripOptions = {
  /** Replaces the look chosen by number, for drawing the reference floors exactly. */
  looks?: Partial<Record<number, Partial<FloorLook>>>;
  /** Forces a floor's lit or dark state, for the same reason. */
  states?: Partial<Record<number, 'lit' | 'dark'>>;
};

export type Strip = {
  /** SVG content in tower units: x from -100 to 100, y from 0 down. */
  svg: string;
  height: number;
  /** Each floor's top, in the strip's units. */
  tops: Map<number, number>;
};

/** Floors `low` to `high`, the highest at the top, drawn in the references' order: stone, edges, ledges, windows, vines. */
export function towerStrip(kit: TowerKit, low: number, high: number, current: number, opts: StripOptions = {}): Strip {
  const floors: number[] = [];
  for (let n = high; n >= low; n--) floors.push(n);
  const tops = new Map<number, number>();
  let y = 0;
  for (const n of floors) { tops.set(n, y); y += floorHeight(n); }
  const height = y;
  const look = (n: number): FloorLook => ({ ...floorLook(n, kit), ...(opts.looks?.[n] ?? {}) });
  const parts: string[] = [];
  for (const n of floors) {
    const l = look(n);
    parts.push(at(tops.get(n)!, l.guardian ? kit.guardianBand.svg : kit.bands[l.band].svg));
  }
  parts.push(edge(1, 0, height, low * 7 + high), edge(-1, 0, height, low * 11 + high));
  for (const n of floors) {
    // The ledge under a floor is lavender where it touches a Guardian floor, with a gold line on top.
    const bottom = tops.get(n)! + floorHeight(n);
    const lav = isGuardian(n) || isGuardian(n - 1);
    parts.push(at(bottom, lav ? kit.ledges.lav : kit.ledges.pink));
    if (lav) parts.push(at(bottom - 1, kit.ledges.gold));
  }
  for (const n of floors) {
    const l = look(n);
    const top = tops.get(n)!;
    if (l.guardian) { parts.push(at(top, kit.guardian)); continue; }
    const state = opts.states?.[n] ?? (floorState(n, current) === 'ahead' ? 'dark' : 'lit');
    const w = kit.windows[l.design!][state];
    parts.push(`<g transform="translate(${round(l.x)} ${round(top + w.dy)})">${w.svg}</g>`);
  }
  for (const n of floors) {
    const l = look(n);
    if (l.decor !== null) parts.push(at(tops.get(n)!, kit.decor[l.decor].svg));
  }
  return { svg: parts.join(''), height, tops };
}

/** A whole SVG document, ready for an image. */
export function svgDoc(kit: TowerKit, viewBox: string, content: string, w?: number, h?: number): string {
  const size = w && h ? ` width="${w}" height="${h}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${size}><defs>${kit.defs}</defs>${content}</svg>`;
}

export function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The six floors of the whole tower as the reference draws them: one of each design, all lit. */
const WHOLE_FLOORS: Partial<FloorLook>[] = [
  { design: 'arched', x: -0.8 }, { design: 'shuttered', x: -18.1 }, { design: 'rose', x: -20.6 },
  { design: 'balcony', x: 5.2 }, { design: 'lancets', x: -12 }, { design: 'lantern', x: -15.7 },
];

/** The whole tower: roof, top room, six floors and the base (§6.6), in the reference's own coordinates. */
export function wholeTower(kit: TowerKit): { svg: string; viewBox: string } {
  const firstWholeBand = kit.bands.findIndex((b) => b.from === 'tower-whole');
  const firstWholeDecor = kit.decor.findIndex((d) => d.from.startsWith('whole'));
  const looks: Record<number, Partial<FloorLook>> = {};
  WHOLE_FLOORS.forEach((l, i) => {
    const n = 6 - i;
    looks[n] = { ...l, guardian: false, band: firstWholeBand + i, decor: firstWholeDecor >= 0 ? firstWholeDecor + i : null };
  });
  // Floors 1 to 6 stand in for any six ordinary floors; none of them is a Guardian floor.
  const strip = towerStrip(kit, 1, 6, 7, { looks });
  const svg = kit.top + `<g transform="translate(0 ${kit.refs.whole.floorsTop})">${strip.svg}</g>` + kit.base + kit.wholeDecor + kit.roof;
  return { svg, viewBox: kit.refs.whole.viewBox };
}

/** The Crossroads scene: the sky, hills, paths, gate and signs, with the whole tower on its hill (§2.5). */
export function crossroadsScene(kit: TowerKit): { svg: string; viewBox: string } {
  const tower = wholeTower(kit).svg;
  return { svg: `${kit.crossroads.below}<g transform="${kit.crossroads.tower}">${tower}</g>${kit.crossroads.above}`, viewBox: kit.crossroads.viewBox };
}

/** The birdcage lift (§6.7). */
export function cageArt(kit: TowerKit): { svg: string; viewBox: string } {
  return { svg: kit.cage, viewBox: kit.refs.cage.viewBox };
}

/** The reference floors 35 to 41 exactly as drawn, for checking the art against them. */
export function referenceStrip(kit: TowerKit): Strip {
  const looks: Record<number, Partial<FloorLook>> = {};
  const states: Record<number, 'lit' | 'dark'> = {};
  for (const [k, r] of Object.entries(kit.refs.floors35to41)) {
    const n = Number(k);
    looks[n] = r.window ? { band: r.band!, design: r.window.design, x: r.window.x, decor: r.decor } : { decor: r.decor };
    if (r.window) states[n] = r.window.state;
  }
  return towerStrip(kit, 35, 41, 37, { looks, states });
}

/* ---------- Loading ---------- */

let loading: Promise<TowerKit> | null = null;

/** The kit, fetched once and kept. The service worker precaches it with the rest of the game. */
export function loadKit(): Promise<TowerKit> {
  loading ??= fetch('art/tower-kit.json').then((r) => {
    if (!r.ok) throw new Error(`tower art ${r.status}`);
    return r.json() as Promise<TowerKit>;
  }).catch((e) => { loading = null; throw e; });
  return loading;
}
