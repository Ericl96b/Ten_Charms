// All vector art, drawn in code: icons, suit symbols, card faces and backs, table decor.
import { cardLabel } from '../engine/cards.ts';
import type { Card, Suit } from '../engine/types.ts';
import { BOTS } from '../content.ts';
import type { BotId } from '../bots/profiles.ts';
import { h } from './dom.ts';

const path = (d: string, extra = '') => `<path d="${d}" ${extra}/>`;

/** Five overlapping petals around a small center. */
const FLOWER = '<g><circle cx="12" cy="6.6" r="4"/><circle cx="17.2" cy="10.3" r="4"/><circle cx="15.2" cy="16.5" r="4"/><circle cx="8.8" cy="16.5" r="4"/><circle cx="6.8" cy="10.3" r="4"/><circle cx="12" cy="12" r="2.2" fill="#FFF8F4"/></g>';
const LEAF = path('M4 20C4 10 10 4 20 4c0 10-6 16-16 16Z') + path('M5.5 18.5 15 9', 'fill="none" stroke="#FFF8F4" stroke-width="1.3" stroke-linecap="round"');
const MOON = path('M15.5 3a9.5 9.5 0 1 0 5.4 16.6A10.5 10.5 0 0 1 15.5 3Z');
const HEX = path('M12 2.5 20.5 7.3v9.4L12 21.5 3.5 16.7V7.3Z');
const SPARKLE = path('M12 2c.9 5.6 4.400 9.100 10 10-5.600.9-9.100 4.400-10 10-.9-5.600-4.400-9.100-10-10 5.600-.9 9.100-4.400 10-10Z');
const HOURGLASS = path('M6 2.500h12M6 21.500h12M7.500 2.500c0 4.500 2 6.500 4.500 9.500-2.500 3-4.500 5-4.500 9.500m9-19c0 4.500-2 6.500-4.500 9.500 2.500 3 4.500 5 4.500 9.500', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"') + path('M8.800 20.500c.4-2.400 1.600-3.700 3.200-5.200 1.600 1.500 2.800 2.800 3.200 5.200Z');

const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS: Record<string, string> = {
  menu: path('M4 7h16M4 12h16M4 17h11', STROKE),
  eye: path('M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12Z', STROKE) + `<circle cx="12" cy="12" r="3" ${STROKE}/>`,
  sort: path('M8 4v16M8 20l-4-4M8 4 4 8M16 20V4M16 4l4 4M16 20l4-4', STROKE),
  settings: path('M10.55 4.2L10.95 1.5L13.05 1.5L13.45 4.2L16.49 5.46L18.68 3.83L20.17 5.32L18.54 7.51L19.8 10.55L22.5 10.95L22.5 13.05L19.8 13.45L18.54 16.49L20.17 18.68L18.68 20.17L16.49 18.54L13.45 19.8L13.05 22.5L10.95 22.5L10.55 19.8L7.51 18.54L5.32 20.17L3.83 18.68L5.46 16.49L4.2 13.45L1.5 13.05L1.5 10.95L4.2 10.55L5.46 7.51L3.83 5.32L5.32 3.83L7.51 5.46Z', STROKE) + `<circle cx="12" cy="12" r="3" ${STROKE}/>`,
  map: path('M3.500 6.500 9 4l6 2.500L20.500 4v13.500L15 20l-6-2.500-5.500 2.500ZM9 4v13.500M15 6.500V20', STROKE),
  cards: path('M9 3.500h8.500A1.500 1.500 0 0 1 19 5v12a1.500 1.500 0 0 1-1.500 1.500H9A1.500 1.500 0 0 1 7.500 17V5A1.500 1.500 0 0 1 9 3.500ZM7.500 6.500 4.800 7.700a1.500 1.500 0 0 0-.8 2l3.500 9', STROKE),
  gift: path('M4 11h16v9H4ZM3 7.500h18V11H3ZM12 7.500V20M12 7.500S10.500 3 8 3.500 7 7.500 12 7.500ZM12 7.500S13.500 3 16 3.500 17 7.500 12 7.500Z', STROKE),
  chart: path('M4 20h16M7 20v-7M12 20V5M17 20v-10', STROKE),
  lock: path('M6.500 11h11A1.500 1.500 0 0 1 19 12.500v6.500a1.500 1.500 0 0 1-1.500 1.500h-11A1.500 1.500 0 0 1 5 19v-6.500A1.500 1.500 0 0 1 6.500 11ZM8 11V8a4 4 0 0 1 8 0v3', STROKE),
  check: path('M5 12.500 10 17.500 19 7', STROKE),
  hourglass: HOURGLASS,
  play: path('M7 4.500 19 12 7 19.500Z', 'fill="currentColor"'),
  star: path('M12 2.500 15 9l7 .8-5.200 4.700L18.300 21.500 12 18l-6.300 3.500 1.500-7L2 9.800 9 9Z', 'fill="currentColor"'),
  close: path('M6 6l12 12M18 6 6 18', STROKE),
  back: path('M15 5 8 12l7 7', STROKE),
  sparkle: SPARKLE,
  rose: FLOWER,
};

export function icon(name: string, cls = ''): string {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ICONS[name]}</svg>`;
}

export function iconEl(name: string, cls = ''): HTMLElement {
  return h('span.icon-wrap', { html: icon(name, cls) });
}

export const SUIT_INK: Record<Suit, string> = { rose: '#B8325C', moss: '#3C7449', moonstone: '#3B5BA0', honey: '#94600C' };
const SUIT_SHAPE: Record<Suit, string> = { rose: FLOWER, moss: LEAF, moonstone: MOON, honey: HEX };

export function suitSvg(suit: Suit, cls = ''): string {
  return `<svg class="suit ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${SUIT_SHAPE[suit]}</svg>`;
}

/* ---------- Cards ---------- */

const faceCache = new Map<string, string>();

function faceHtml(card: Card): string {
  const key = card.kind === 'num' ? `${card.suit}${card.num}` : card.kind;
  const cached = faceCache.get(key);
  if (cached) return cached;
  let html: string;
  if (card.kind === 'num') {
    const s = suitSvg(card.suit);
    html = `<i class="wm">${s}</i><span class="idx"><b>${card.num}</b>${s}</span><b class="mid">${card.num}</b><span class="br">${s}</span>`;
  } else if (card.kind === 'wild') {
    const s = `<svg class="suit" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${SPARKLE}</svg>`;
    html = `<i class="sheen"></i><span class="idx"><b>W</b>${s}</span><b class="mid">Wild</b><span class="br">${s}</span>`;
  } else {
    const s = `<svg class="suit" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${HOURGLASS}</svg>`;
    html = `<span class="idx">${s}</span><b class="mid">Skip</b><span class="br">${s}</span>`;
  }
  faceCache.set(key, html);
  return html;
}

function faceClass(card: Card): string {
  return card.kind === 'num' ? `s-${card.suit}` : card.kind;
}

export function cardEl(card: Card, mini = false): HTMLElement {
  const el = document.createElement('div');
  el.className = `card ${faceClass(card)}${mini ? ' mini' : ''}`;
  el.innerHTML = faceHtml(card);
  el.dataset.cardId = String(card.id);
  el.setAttribute('aria-label', cardLabel(card));
  return el;
}

export function backEl(backId: string, mini = false): HTMLElement {
  const el = document.createElement('div');
  el.className = `card card-back b-${backId}${mini ? ' mini' : ''}`;
  el.innerHTML = `<i class="medal">${backId === 'rose-lattice' ? `<svg class="suit" viewBox="0 0 24 24" fill="currentColor">${FLOWER}</svg>` : ''}</i>`;
  return el;
}

/* ---------- Portraits ---------- */

export type Expression = 'neutral' | 'happy' | 'sad' | 'smug' | 'intense';

export function portraitEl(bot: BotId, size: 'small' | 'medium' | 'large' = 'small', expression: Expression = 'neutral'): HTMLElement {
  const info = BOTS[bot];
  const wrap = h(`div.portrait.p-${size}`, { 'data-bot': bot, 'data-expression': expression, 'aria-label': info.name, style: `--pc:${info.color};--pi:${info.ink}` });
  paintPortrait(wrap, bot, size, expression);
  return wrap;
}

function paintPortrait(wrap: HTMLElement, bot: BotId, size: string, expression: Expression): void {
  const name = `${bot}-${expression}`;
  if (__PORTRAITS__.includes(name)) {
    wrap.classList.add('painted');
    wrap.innerHTML = `<img alt="" src="portraits/${name}-${size === 'small' ? 256 : 512}.webp">`;
  } else {
    wrap.classList.remove('painted');
    wrap.innerHTML = `<span>${BOTS[bot].letter}</span>`;
  }
}

export function setExpression(wrap: HTMLElement, expression: Expression): void {
  const bot = wrap.dataset.bot as BotId;
  const size = wrap.classList.contains('p-small') ? 'small' : 'medium';
  wrap.dataset.expression = expression;
  paintPortrait(wrap, bot, size, expression);
}

/* ---------- Table decor ---------- */

function rose(x: number, y: number, r: number, c: string, d: string): string {
  return `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${c}"/><circle r="${r * 0.62}" fill="${d}"/><path d="M${-r * 0.35} 0a${r * 0.35} ${r * 0.35} 0 1 1 ${r * 0.55} ${r * 0.28}" fill="none" stroke="#FFF8F4" stroke-opacity=".7" stroke-width="${r * 0.13}" stroke-linecap="round"/></g>`;
}

function leaf(x: number, y: number, a: number, c: string): string {
  return `<path transform="translate(${x} ${y}) rotate(${a})" d="M0 0C-5-7-5-14 0-20 5-14 5-7 0 0Z" fill="${c}"/>`;
}

export function garlandSvg(): string {
  return `<svg class="garland-art" viewBox="0 0 390 56" preserveAspectRatio="none" aria-hidden="true">
<path class="vine" d="M-4 8C70 34 130 38 195 30S320 34 394 8" fill="none" stroke-width="2.600" stroke-linecap="round"/>
<g class="lf">${leaf(60, 22, -35, '')}${leaf(112, 30, 40, '')}${leaf(160, 33, -30, '')}${leaf(240, 32, 35, '')}${leaf(292, 30, -38, '')}${leaf(338, 20, 34, '')}</g>
<g class="roses">${rose(30, 16, 10, 'var(--g-a)', 'var(--g-b)')}${rose(358, 16, 10, 'var(--g-a)', 'var(--g-b)')}${rose(96, 30, 7, 'var(--g-c)', 'var(--g-a)')}${rose(195, 31, 9, 'var(--g-a)', 'var(--g-b)')}${rose(296, 31, 7, 'var(--g-c)', 'var(--g-a)')}</g>
</svg>`;
}

export function teacupSvg(): string {
  return `<svg class="teacup-art" viewBox="0 0 70 70" aria-hidden="true">
<g class="steam"><path class="w1" d="M26 22c-4-5 4-8 0-14" fill="none" stroke="#fff" stroke-width="2.500" stroke-linecap="round"/><path class="w2" d="M38 22c-4-5 4-8 0-14" fill="none" stroke="#fff" stroke-width="2.500" stroke-linecap="round"/></g>
<ellipse cx="33" cy="60" rx="27" ry="6" fill="#EBA9BC"/>
<path d="M50 34h6a7 7 0 0 1 0 14h-8" fill="none" stroke="#FBE4E2" stroke-width="4"/>
<path d="M12 28h42c0 18-7 30-21 30S12 46 12 28Z" fill="#FFF8F4"/>
<ellipse cx="33" cy="28" rx="21" ry="5" fill="#B57A52"/>
<circle cx="25" cy="42" r="1.800" fill="#5B2340"/><circle cx="41" cy="42" r="1.800" fill="#5B2340"/><path d="M30 46q3 3 6 0" fill="none" stroke="#5B2340" stroke-width="1.500" stroke-linecap="round"/>
<circle cx="20" cy="46" r="3" fill="#F2A7BC"/><circle cx="46" cy="46" r="3" fill="#F2A7BC"/>
</svg>`;
}

export function candleSvg(): string {
  return `<svg class="candle-art" viewBox="0 0 50 90" aria-hidden="true">
<circle class="glow" cx="25" cy="20" r="20"/>
<g class="flame"><path class="fl-o" d="M25 6c6 8 8 12 8 16a8 8 0 0 1-16 0c0-4 2-8 8-16Z"/><path class="fl-i" d="M25 14c3 4 4 6 4 8.500a4 4 0 0 1-8 0c0-2.500 1-4.500 4-8.500Z"/></g>
<rect x="17" y="30" width="16" height="42" rx="2" fill="#FFF8F4"/><path d="M17 36c3 5 5 0 8 3s5-2 8 0v-7H17Z" fill="#FBEFE6"/>
<ellipse cx="25" cy="76" rx="20" ry="6" fill="#C9973F"/><ellipse cx="25" cy="74" rx="14" ry="3.500" fill="#F6D27F"/>
</svg>`;
}

export function roseIllustration(): string {
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M60 118V62" stroke="#6E9A6A" stroke-width="5" stroke-linecap="round"/>${leaf(60, 96, -60, '#7FAE77')}${leaf(60, 86, 60, '#6E9A6A')}${rose(60, 42, 30, '#E8789A', '#C7406E')}</svg>`;
}

export function mothSvg(cls = ''): string {
  return `<svg class="moth-art ${cls}" viewBox="0 0 60 44" aria-hidden="true"><g class="wing wl"><path d="M28 22C18 2 4 2 2 12s10 22 26 14Z"/><circle cx="12" cy="13" r="3" class="sp"/></g><g class="wing wr"><path d="M32 22C42 2 56 2 58 12s-10 22-26 14Z"/><circle cx="48" cy="13" r="3" class="sp"/></g><ellipse cx="30" cy="24" rx="3" ry="9" class="bd"/></svg>`;
}

export function petalSvg(color = 'var(--rose-blush)'): string {
  return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1c6 3 9 8 6 13-2 3-8 5-12 2C0 13 3 5 10 1Z" fill="${color}"/></svg>`;
}

export function bigRose(): string {
  const layer = (n: number, r: number, c: string, cls: string) => {
    let out = `<g class="${cls}">`;
    for (let i = 0; i < n; i++) {
      out += `<ellipse cx="0" cy="${-r}" rx="${r * 0.72}" ry="${r}" fill="${c}" transform="rotate(${(360 / n) * i})"/>`;
    }
    return `${out}</g>`;
  };
  return `<svg class="big-rose" viewBox="-110 -110 220 220" aria-hidden="true">${layer(8, 70, '#F2A7BC', 'pl pl1')}${layer(7, 52, '#E8789A', 'pl pl2')}${layer(6, 36, '#C7406E', 'pl pl3')}${layer(5, 20, '#A32C57', 'pl pl4')}</svg>`;
}

export function teacupLid(): string {
  return `<svg class="lid-art" viewBox="0 0 120 40" aria-hidden="true"><ellipse cx="60" cy="30" rx="50" ry="10" fill="#FFF8F4"/><path d="M14 30C20 8 100 8 106 30Z" fill="#FBE4E2"/><circle cx="60" cy="9" r="6" fill="#C9973F"/></svg>`;
}

export function hourglassEl(cls = ''): HTMLElement {
  return h(`div.hourglass-fx ${cls}`.trim().replace(/ /g, '.'), { html: icon('hourglass') });
}

/** The design of a card back or tablecloth, for previews. */
export function clothSwatch(id: string): HTMLElement {
  return h(`div.swatch.c-${id}`);
}
