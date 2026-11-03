// Moonlit Fog: translucent storybook clouds drifting left to right across the whole screen.
// Each cloud is a pre-blurred image moved only by transform, so the work stays on the compositor.
// The layer never takes a tap: interactive things sit above it, and it ignores the pointer.
import { h } from '../dom.ts';
import { fx, motion } from './motion.ts';

/** Measured at 440 points wide, as in the spec. Sizes and speeds scale with screen width. */
const REFERENCE = 440;

type Layer = { name: 'far' | 'middle' | 'near'; onScreen: number; minW: number; maxW: number; opacity: number; speed: number };

const LAYERS: Layer[] = [
  { name: 'far', onScreen: 8, minW: 70, maxW: 100, opacity: 0.36, speed: 6 },
  { name: 'middle', onScreen: 6, minW: 125, maxW: 165, opacity: 0.46, speed: 10 },
  { name: 'near', onScreen: 4, minW: 200, maxW: 265, opacity: 0.55, speed: 16 },
];

const MIST_UNDERSIDE = '#E2CFEA';

/** Three scalloped cloud outlines: rounded bumps along the top and a gently rounded base, in a 200 by 90 box. */
const SHAPES = [
  'M18 70C6 70 2 60 8 52C2 42 12 32 24 36C26 22 42 16 54 24C60 8 84 4 96 18C106 6 132 8 138 26C150 18 170 24 170 38C186 36 196 50 188 60C196 70 186 76 176 74C140 80 60 80 18 70Z',
  'M14 68C4 66 4 54 14 50C10 38 24 30 36 36C40 20 60 14 72 24C82 10 104 10 112 24C124 14 146 18 148 34C162 28 178 36 176 50C190 52 194 66 182 70C140 78 56 78 14 68Z',
  'M20 70C8 68 6 58 14 54C12 44 22 38 32 42C34 30 48 26 58 32C66 18 86 16 94 28C102 20 116 22 120 32C130 22 150 24 154 38C168 34 184 44 180 56C194 60 190 72 178 72C140 78 60 78 20 70Z',
];

const imageCache = new Map<number, string>();

/** A cloud as an image: lavender underside showing just below a white body, edges softly blurred. */
function cloudImage(shape: number): string {
  const cached = imageCache.get(shape);
  if (cached) return cached;
  const d = SHAPES[shape];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -6 220 104"><defs><filter id="b" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur stdDeviation="2.4"/></filter></defs><g filter="url(#b)"><path d="${d}" transform="translate(0 7)" fill="${MIST_UNDERSIDE}"/><path d="${d}" fill="#FFFFFF"/></g></svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  imageCache.set(shape, url);
  return url;
}

/** Repeatable "randomness", so every visit and every screenshot lays clouds out the same way. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export type FogLayer = { el: HTMLElement; stop: () => void };

const live = new Set<{ anims: Animation[]; starts: number[] }>();

/**
 * Builds the drifting cloud field. `width` and `height` are the area it covers, in points.
 * Every cloud loops from just off the left edge to just off the right, so the field never shows a seam.
 */
export function fogLayer(width: number, height: number, seed = 7): FogLayer {
  const el = h('div.fog', { 'aria-hidden': 'true', 'data-testid': 'fog' });
  const scale = width / REFERENCE;
  const rand = seeded(seed);
  const anims: Animation[] = [];
  const starts: number[] = [];
  for (const layer of LAYERS) {
    const maxW = layer.maxW * scale;
    const travel = width + maxW;
    // Enough clouds that, on average, `onScreen` of them are in view at once.
    const count = Math.round((layer.onScreen * travel) / width);
    const duration = (travel / (layer.speed * scale)) * 1000;
    for (let i = 0; i < count; i++) {
      const w = (layer.minW + rand() * (layer.maxW - layer.minW)) * scale;
      const mirrored = rand() < 0.4;
      // Spread evenly over the full height, so every part of the screen sees clouds pass.
      const top = ((i + rand() * 0.8) / count) * (height + w * 0.2) - w * 0.3;
      const img = h('img.cloud', {
        src: cloudImage(Math.floor(rand() * SHAPES.length)), alt: '', draggable: 'false',
        'data-layer': layer.name,
        style: `width:${w}px;top:${top}px;opacity:${layer.opacity}`,
      });
      el.append(img);
      // Start from just past the left edge (the widest cloud's width) and leave just past the right edge.
      const a = img.animate(
        [{ transform: `translate3d(${-maxW}px,0,0)${mirrored ? ' scaleX(-1)' : ''}` }, { transform: `translate3d(${width}px,0,0)${mirrored ? ' scaleX(-1)' : ''}` }],
        { duration, iterations: Infinity, easing: 'linear' },
      );
      const start = ((i + rand() * 0.5) / count) * duration;
      a.currentTime = start;
      anims.push(a);
      starts.push(start);
    }
  }
  const handle = { anims, starts };
  live.add(handle);
  fx('fog.clouds');
  const apply = () => {
    for (const a of anims) {
      if (motion.reduced || document.hidden) a.pause();
      else a.play();
    }
  };
  apply();
  document.addEventListener('visibilitychange', apply);
  return {
    el,
    stop: () => {
      document.removeEventListener('visibilitychange', apply);
      live.delete(handle);
      for (const a of anims) a.cancel();
      el.remove();
    },
  };
}

/** Puts every cloud back where it started and holds it there: the same picture every time. Test builds only. */
export function freezeFogForTests(): void {
  if (!__DEV__) return;
  for (const { anims, starts } of live) {
    anims.forEach((a, i) => { a.pause(); a.currentTime = starts[i]; });
  }
}
