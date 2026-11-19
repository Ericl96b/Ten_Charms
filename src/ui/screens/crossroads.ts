// The Crossroads (TOWER_SPEC.md §2.5): a pink storybook fork, with Map 3's gate tied shut to the north and the Tower on
// its hill to the east.
import { app } from '../app.ts';
import { icon } from '../art.ts';
import { sfx } from '../audio/audio.ts';
import { h } from '../dom.ts';
import { SOFT, animate, fx, motion } from '../fx/motion.ts';
import { noteToast } from '../overlays.ts';
import { ambientLoop } from '../tower/ambient.ts';
import { crossroadsScene, loadKit, svgDoc, svgUrl } from '../tower/art.ts';
import { bottomNav, mapTop } from './journey.ts';
import { openTowerHome } from './tower.ts';

/** The scene's own size, and where its landmarks are, in its units (measured from the approved art). */
const SCENE = { w: 390, h: 730 };
export const LANDMARKS = {
  gate: { l: 154, t: 140, r: 238, b: 231 },
  sign: { l: 76, t: 211, r: 175, b: 297 },
  signpost: { l: 111, t: 376, r: 175, b: 455 },
  tower: { l: 297, t: 89, r: 353, b: 310 },
} as const;
const GAP = 10;
const EDGE = 16;

let sceneUrl: string | null = null;

/** The scene as an image, made once: drawn by the browser a single time, then only moved. */
async function sceneImage(): Promise<string> {
  if (sceneUrl) return sceneUrl;
  const kit = await loadKit();
  const scene = crossroadsScene(kit);
  sceneUrl = svgUrl(svgDoc(kit, scene.viewBox, scene.svg, SCENE.w * 2, SCENE.h * 2));
  return sceneUrl;
}

export function crossroadsScreen(opts: { pulseEnter?: boolean } = {}): HTMLElement {
  const save = app.save;
  const best = save.tower.best;
  const scene = h('div.xr-scene', { 'data-testid': 'xr-scene' });
  const img = h('img.xr-art', { alt: '', 'aria-hidden': 'true', draggable: 'false' }) as HTMLImageElement;
  const spots = {
    gate: h('button.xr-spot', { 'data-testid': 'xr-gate', 'aria-label': 'Map 3, coming soon', onclick: () => map3() }),
    sign: h('button.xr-spot', { 'data-testid': 'xr-sign', 'aria-label': 'Map 3 sign', onclick: () => map3() }),
    signpost: h('div.xr-mark', { 'data-testid': 'xr-signpost' }),
    tower: h('button.xr-spot', { 'data-testid': 'xr-tower', 'aria-label': 'The Tower', onclick: () => enter() }),
  };
  scene.append(img, spots.gate, spots.sign, spots.signpost, spots.tower);
  const enterBtn = h('button.btn.primary.play.xr-enter', { 'data-testid': 'tower-enter', onclick: () => enter(), html: `${icon('play')}<span>Enter</span>` });
  const card = h('div.xr-card', { 'data-testid': 'tower-card' },
    h('small.kicker', null, 'SIDE QUEST'),
    h('h2.xr-title', null, 'The Tower'),
    h('p.xr-best', { 'data-testid': 'tower-best', html: best > 0 ? `${icon('flag')}<span>Best floor ${best}</span>` : '<span>No climbs yet</span>' }),
    enterBtn,
  );
  const plate = h('div.xr-plate', { 'data-testid': 'xr-plate' }, 'The Crossroads');
  const petals = h('div.xr-petals.ambient');
  const root = h('div.screen.map-screen.crossroads-screen', { 'data-screen': 'journey', 'data-map': 'crossroads' },
    scene, petals, mapTop('crossroads'), plate, card, bottomNav('journey'),
  );

  function map3(): void {
    fx('crossroads.map3');
    sfx('invalid');
    noteToast('Map 3 is still being built. Check back soon!');
  }
  function enter(): void {
    fx('crossroads.enter');
    void openTowerHome();
  }

  /**
   * The scene fills the width and rests on the bottom edge; on a short phone it starts at the top instead. The card
   * and name plate then go where they cover none of the landmarks.
   */
  const place = () => {
    const box = root.getBoundingClientRect();
    if (box.width === 0) return;
    const s = box.width / SCENE.w;
    const height = SCENE.h * s;
    const top = Math.max(0, box.height - height);
    Object.assign(img.style, { width: `${box.width}px`, height: `${height}px`, top: `${top}px` });
    const at = (r: { l: number; t: number; r: number; b: number }) => ({ l: r.l * s, t: top + r.t * s, r: r.r * s, b: top + r.b * s });
    for (const [k, el] of Object.entries(spots)) {
      const r = at(LANDMARKS[k as keyof typeof LANDMARKS]);
      Object.assign(el.style, { left: `${r.l}px`, top: `${r.t}px`, width: `${r.r - r.l}px`, height: `${r.b - r.t}px` });
    }
    const nav = root.querySelector<HTMLElement>('.bottom-nav')!.getBoundingClientRect();
    const tower = at(LANDMARKS.tower);
    const post = at(LANDMARKS.signpost);
    // The card sits right of the signpost and below the tower, as low as it fits above the bottom bar.
    const left = Math.max(post.r + GAP, box.width / 2 - 12);
    const width = Math.min(box.width - EDGE - left, 23 * remPx());
    card.style.width = `${width}px`;
    card.style.left = `${box.width - EDGE - width}px`;
    const bottom = nav.top - box.top - GAP;
    const cardTop = Math.max(tower.b + GAP, bottom - card.offsetHeight);
    card.style.top = `${cardTop}px`;
    // The name plate sits at the lower left, below the signpost.
    plate.style.left = `${EDGE}px`;
    plate.style.top = `${Math.max(post.b + GAP, Math.min(bottom - plate.offsetHeight, cardTop + card.offsetHeight - plate.offsetHeight - 12))}px`;
  };
  void sceneImage().then((url) => {
    img.src = url;
    return img.decode().catch(() => undefined);
  }).then(() => root.classList.add('ready')).catch(() => root.classList.add('ready'));
  requestAnimationFrame(() => {
    place();
    void document.fonts.ready.then(() => { if (root.isConnected) place(); });
    window.addEventListener('resize', place);
    const stop = ambientLoop(root, { petals, clouds: scene });
    app.onLeave = () => { window.removeEventListener('resize', place); stop(); };
    if (opts.pulseEnter) pulse(enterBtn);
  });
  return root;
}

function remPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
}

/** The Enter button pulses gently twice, after the reveal lands. */
function pulse(el: HTMLElement): void {
  fx('crossroads.enterPulse');
  if (motion.reduced) return;
  void animate(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { ms: 1400, ease: SOFT, delay: 300, ambient: true });
}
