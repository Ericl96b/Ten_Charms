// The lift between floors (TOWER_SPEC.md §9.4, §9.5): the ascent after every ordinary floor won, and the tier change
// after every Guardian. Tapping anywhere skips to the same end state the full sequence lands on.
import { sfx } from '../audio/audio.ts';
import { h } from '../dom.ts';
import { SOFT, SPRING, animate, finishAll, fx, motion } from '../fx/motion.ts';
import { skyName, tierOf } from '../../meta/tower.ts';
import { ambientLife } from './ambient.ts';
import { cageArt, floorHeight, floorLook, loadKit, svgDoc, svgUrl, towerStrip } from './art.ts';

const ART_W = 220;

/** What the last ride did, for tests: how far the tower slid, one floor's height, and where it came to rest. */
export type LiftRecord = { from: number; to: number; shift: number; floorPx: number; endY: number; counter: string; skipped: boolean; reduced: boolean; banner: string | null };
export let lastLift: LiftRecord | null = null;

/** The brass dial, its needle and the floor counter beneath it. */
function dialEl(): { el: HTMLElement; needle: HTMLElement; counter: HTMLElement } {
  const needle = h('i.as-needle');
  const ticks = Array.from({ length: 9 }, (_, i) => `<line x1="0" y1="-38" x2="0" y2="${i % 4 === 0 ? -28 : -32}" transform="rotate(${-80 + i * 20})" stroke="#5B2340" stroke-width="${i % 4 === 0 ? 3 : 2}" stroke-linecap="round"/>`).join('');
  const face = h('div.as-face', { html: `<svg viewBox="-50 -50 100 56" aria-hidden="true"><path d="M-46 4 A46 46 0 0 1 46 4 Z" fill="#E0B356"/><path d="M-40 4 A40 40 0 0 1 40 4 Z" fill="#FFF8F2"/>${ticks}<circle cx="-44" cy="2" r="4" fill="#E8789A"/><circle cx="44" cy="2" r="4" fill="#E8789A"/><circle cx="0" cy="4" r="5" fill="#E0B356"/></svg>` });
  face.append(needle);
  const counter = h('b.as-count', { 'data-testid': 'lift-counter' });
  const el = h('div.as-dial', null, face, h('div.as-plate', null, h('small', null, 'FLOOR'), counter));
  return { el, needle, counter };
}

type Prepared = { key: string; strip: ReturnType<typeof towerStrip>; url: string; cage: string };
let prepared: Promise<Prepared> | null = null;

/**
 * Builds and decodes the lift's pictures for a ride ahead of time: the result screen does this while it shows, so the
 * ride itself starts with nothing heavy left to do.
 */
export function prepareClimb(from: number, to: number): Promise<Prepared> {
  const key = `${from}-${to}`;
  const build = async (): Promise<Prepared> => {
    const kit = await loadKit();
    const strip = towerStrip(kit, Math.max(1, from - 2), to + 3, to);
    const url = svgUrl(svgDoc(kit, `-${ART_W / 2} 0 ${ART_W} ${strip.height}`, strip.svg, ART_W * 2, Math.round(strip.height * 2)));
    const c = cageArt(kit);
    const cage = svgUrl(svgDoc(kit, c.viewBox, c.svg, 200, 300));
    await Promise.all([url, cage].map((src) => { const i = new Image(); i.src = src; return i.decode().catch(() => undefined); }));
    return { key, strip, url, cage };
  };
  prepared = (prepared ?? Promise.resolve(null as unknown as Prepared)).catch(() => null as unknown as Prepared).then((p) => (p && p.key === key ? p : build()));
  return prepared;
}

/**
 * Rides the lift from `from` to `to`. Resolves on the end state: Tower home then opens with the new floor. The scene
 * records what it moved, so a test can check it rose by exactly one floor.
 */
export async function climbScene(from: number, to: number): Promise<void> {
  const tierChange = from % 10 === 0;
  fx(tierChange ? 'tower.tierChange' : 'tower.ascent');
  const kit = await loadKit();
  const ready = await prepareClimb(from, to);
  const strip = ready.strip;
  const img = h('img.as-strip', { alt: '', 'aria-hidden': 'true', src: ready.url }) as HTMLImageElement;
  const cage = h('img.as-cage', { alt: '', 'aria-hidden': 'true', src: ready.cage });
  const chain = h('i.as-chain');
  const lift = h('div.as-lift', null, chain, cage);
  const art = h('div.as-art', null, img);
  const rail = h('i.as-rail');
  const oldSky = h('div.as-sky', { class: skyClassOf(tierOf(from)) });
  const newSky = h('div.as-sky', { class: skyClassOf(tierOf(to)), style: tierChange ? 'opacity:0' : '' });
  const life = h('div.as-life');
  const dial = dialEl();
  const burst = h('i.as-burst');
  const skip = h('div.as-skip', null, 'Tap to skip');
  const cloud = h('div.as-cloudbank');
  const banner = h('div.as-banner', { 'data-testid': 'tier-banner' }, h('small', null, `TIER ${tierOf(to)}`), h('b', null, skyName(tierOf(to))));
  const scene = h('div.screen.ascent-screen', { 'data-screen': 'ascent', 'data-testid': 'ascent', 'data-from': String(from), 'data-to': String(to) },
    oldSky, newSky, life, art, rail, lift, burst, dial.el, skip,
  );
  if (tierChange) scene.append(cloud, banner);
  const host = document.getElementById('overlays')!;
  host.append(scene);
  await img.decode?.().catch(() => undefined);
  // The scene covers the whole screen, so the screen beneath it needn't be drawn while it plays.
  const below = document.getElementById('screens');
  if (below) below.style.visibility = 'hidden';
  // The sky's clouds and stars move together, more slowly than the tower, for parallax.
  const stopLife = ambientLife(life, ['clouds', 'stars'], from, true);

  // Where floor N's window is in the strip, and how far the tower slides: exactly the floors between.
  const box = scene.getBoundingClientRect();
  const scale = (box.width * 1.15) / ART_W;
  const windowY = (n: number) => strip.tops.get(n)! + (floorLook(n, kit).guardian ? 60 : 38);
  const anchor = box.height * 0.6;
  const yFor = (n: number) => anchor - windowY(n) * scale;
  const shift = (windowY(from) - windowY(to)) * scale;
  Object.assign(art.style, { width: `${ART_W * scale}px`, height: `${strip.height * scale}px`, transform: `translateY(${yFor(from)}px)` });
  scene.dataset.shift = shift.toFixed(1);
  scene.dataset.floorPx = (floorHeight(from) * scale).toFixed(1);
  dial.counter.textContent = String(from);

  const endState = () => {
    art.style.transform = `translateY(${yFor(to)}px)`;
    art.dataset.y = yFor(to).toFixed(1);
    dial.counter.textContent = String(to);
    dial.needle.style.transform = 'rotate(70deg)';
    newSky.style.opacity = '1';
    cloud.style.opacity = '0';
    scene.dataset.done = 'true';
  };

  let skipped = false;
  const done = new Promise<void>((resolve) => {
    const finish = () => {
      if (scene.dataset.done) return;
      finishAll();
      endState();
      resolve();
    };
    scene.addEventListener('pointerdown', () => { skipped = true; fx('tower.liftSkip'); finish(); });
    void run(finish);
  });

  async function run(finish: () => void): Promise<void> {
    const s = motion.factor * motion.testScale;
    const at = (ms: number) => new Promise<void>((r) => setTimeout(r, ms * s));
    if (motion.reduced) {
      // A 0.4 s crossfade to the new floor; the counter already reads it. The tier change keeps its banner, still.
      dial.counter.textContent = String(to);
      await animate(art, [{ opacity: 1 }, { opacity: 0.2 }], { ms: 200 });
      art.style.transform = `translateY(${yFor(to)}px)`;
      newSky.style.opacity = '1';
      await animate(art, [{ opacity: 0.2 }, { opacity: 1 }], { ms: 200 });
      if (tierChange) { fx('tower.tierBanner'); await at(1500); }
      finish();
      return;
    }
    // 0 to 0.3 s: the cage gives a small jolt.
    void animate(lift, [{ transform: 'translateY(0)' }, { transform: 'translateY(.5rem)', offset: 0.4 }, { transform: 'translateY(-.2rem)', offset: 0.75 }, { transform: 'translateY(0)' }], { ms: 300, ease: SOFT });
    await at(300);
    if (skipped) return;
    sfx('liftRatchet');
    const rise = tierChange ? 2600 : 1700;
    // Marks the slide's start, so smoothness is measured over the slide itself and not the scene's set-up.
    scene.dataset.sliding = '1';
    // The tower slides down past the cage, easing in and out; the sky's life drifts more slowly behind it.
    void animate(art, [{ transform: `translateY(${yFor(from)}px)` }, { transform: `translateY(${yFor(to)}px)` }], { ms: rise, ease: 'ease-in-out', fill: 'forwards' });
    void animate(life, [{ transform: 'translateY(0)' }, { transform: `translateY(${shift * 0.25}px)` }], { ms: rise, ease: 'ease-in-out', fill: 'forwards' });
    void animate(dial.needle, [{ transform: 'rotate(-70deg)' }, { transform: 'rotate(70deg)' }], { ms: rise, ease: 'ease-in-out', fill: 'forwards' });
    void animate(lift, [{ transform: 'rotate(0)' }, { transform: 'rotate(-2deg)', offset: 0.3 }, { transform: 'rotate(2deg)', offset: 0.7 }, { transform: 'rotate(0)' }], { ms: rise, ease: 'ease-in-out' });
    void at(rise * 0.55).then(() => { if (!skipped) dial.counter.textContent = String(to); });
    if (tierChange) {
      // Partway up, a soft white-pink cloud bank fills the screen; behind it the sky turns to the new tier's band.
      fx('tower.cloudBank');
      sfx('cloudSwell');
      void animate(cloud, [{ opacity: 0, transform: 'translateY(40%)' }, { opacity: 1, transform: 'translateY(0)', offset: 0.45 }, { opacity: 1, transform: 'translateY(0)', offset: 0.6 }, { opacity: 0, transform: 'translateY(-50%)' }], { ms: rise, ease: 'ease-in-out', fill: 'forwards' });
      void at(rise * 0.5).then(() => { newSky.style.opacity = '1'; });
    }
    await at(rise);
    if (skipped) return;
    // The cage settles with a small bounce, a soft bell, a gold starburst behind it, and the counter pops.
    fx('tower.liftSettle');
    sfx('liftBell');
    void animate(lift, [{ transform: 'translateY(-.6rem)' }, { transform: 'translateY(.25rem)', offset: 0.6 }, { transform: 'translateY(0)' }], { ms: 600, ease: SPRING });
    void animate(burst, [{ opacity: 0, transform: 'translate(-50%, -50%) scale(.3) rotate(0)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1.15) rotate(20deg)', offset: 0.4 }, { opacity: 0, transform: 'translate(-50%, -50%) scale(1.3) rotate(30deg)' }], { ms: 600 });
    void animate(dial.counter, [{ transform: 'scale(1)' }, { transform: 'scale(1.3)', offset: 0.4 }, { transform: 'scale(1)' }], { ms: 360, ease: SPRING });
    await at(600);
    if (skipped) return;
    if (tierChange) {
      // A pink ribbon banner unfolds with the tier and its sky's name, and holds about 1.5 s.
      fx('tower.tierBanner');
      sfx('tierFlourish');
      void animate(banner, [{ transform: 'translate(-50%, -50%) scaleX(.1)', opacity: 0 }, { transform: 'translate(-50%, -50%) scaleX(1.05)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%, -50%) scaleX(1)', opacity: 1 }], { ms: 450, ease: SPRING, fill: 'forwards' });
      await at(1500);
      if (skipped) return;
    }
    finish();
  }

  await done;
  lastLift = {
    from, to, shift, floorPx: floorHeight(from) * scale, endY: Number(art.dataset.y), counter: dial.counter.textContent ?? '',
    skipped, reduced: motion.reduced, banner: tierChange ? banner.textContent : null,
  };
  stopLife();
  if (below) below.style.visibility = '';
  // A breath on the end state, then the scene gives way to Tower home.
  await new Promise((r) => setTimeout(r, motion.reduced ? 0 : 160 * motion.testScale));
  void animate(scene, [{ opacity: 1 }, { opacity: 0 }], { ms: 220, ambient: true }).then(() => scene.remove());
}

function skyClassOf(tier: number): string {
  return `sky-${skyName(tier).toLowerCase().replace(/ /g, '-')}`;
}
