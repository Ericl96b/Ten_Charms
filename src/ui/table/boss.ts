// The bosses' theatrics: Nightshade's entrance and the garden's return to daylight, and Lunaria's entrance and exit.
import { BOTS, LINES, LUNARIA_TITLE } from '../../content.ts';
import { icon, mothSvg, portraitEl } from '../art.ts';
import { playMusic, sfx } from '../audio/audio.ts';
import { h, rectOf, wait } from '../dom.ts';
import { SOFT, animate, burst, center, finishAll, fx, motion, pause } from '../fx/motion.ts';
import type { Table } from './table.ts';

/** About 4 s, tap to skip. Resolves when the table should begin. */
export function bossIntro(host: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    fx('boss.intro');
    sfx('bossIntro');
    const overlay = h('div.boss-intro', { 'data-testid': 'boss-intro' });
    host.append(overlay);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      finishAll();
      playMusic('boss');
      void animate(overlay, [{ opacity: 1 }, { opacity: 0 }], { ms: 260 }).then(() => {
        overlay.remove();
        resolve();
      });
    };
    overlay.addEventListener('pointerdown', finish);
    overlay.addEventListener('click', finish);

    const dark = h('div.bi-dark');
    const cloth = h('div.bi-cloth');
    overlay.append(dark, cloth);
    fx('boss.darken');
    void animate(dark, [{ opacity: 0 }, { opacity: 1 }], { ms: 800 });
    fx('boss.clothFade');
    void animate(cloth, [{ opacity: 0 }, { opacity: 1 }], { ms: 1000, delay: 400 });

    const w = host.clientWidth;
    const hgt = host.clientHeight;
    fx('boss.mothsIn');
    const count = motion.reduced ? 8 : 12;
    for (let i = 0; i < count; i++) {
      const moth = h('div.moth.bi-moth', { html: mothSvg() });
      overlay.append(moth);
      const angle = (i / count) * Math.PI * 2;
      const sx = w / 2 + Math.cos(angle) * w;
      const sy = hgt / 2 + Math.sin(angle) * hgt;
      const cx = w / 2 + Math.cos(angle + 1.3) * w * 0.3;
      const cy = hgt * 0.42 + Math.sin(angle + 1.3) * hgt * 0.18;
      const ex = (w / (count + 1)) * (i + 1);
      const ey = hgt * 0.03 + (i % 2) * hgt * 0.02;
      if (motion.reduced) {
        moth.style.transform = `translate(${ex}px,${ey}px)`;
        void animate(moth, [{ opacity: 0 }, { opacity: 1 }], { ms: 600, delay: 300 });
      } else {
        void animate(moth, [
          { transform: `translate(${sx}px,${sy}px) scale(1)` },
          { transform: `translate(${cx}px,${cy}px) scale(1.15)`, offset: 0.55 },
          { transform: `translate(${ex}px,${ey}px) scale(.7)` },
        ], { ms: 2300, delay: 300 + i * 40, ease: 'ease-in-out' });
      }
    }

    const portrait = portraitEl('nightshade', 'large', 'intense');
    const glow = h('div.bi-glow');
    const title = h('h1.bi-title', { 'data-testid': 'boss-title' }, `${BOTS.nightshade.name}, the Moth Queen`);
    const line = h('p.bi-line', { 'data-testid': 'boss-line' }, LINES.nightshade.intro!);
    const center_ = h('div.bi-center', null, glow, portrait, title, line);
    overlay.append(center_);
    fx('boss.portrait');
    void animate(portrait, [{ transform: 'translateY(60px) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }], { ms: 800, delay: 1500, ease: SOFT });
    void animate(glow, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }], { ms: 900, delay: 1500, ease: SOFT });
    void animate(title, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'scale(1)' }], { ms: 500, delay: 2200, ease: SOFT });
    void animate(line, [{ opacity: 0 }, { opacity: 1 }], { ms: 500, delay: 2800 });
    wait(2800 * (motion.factor * motion.testScale)).then(() => {
      if (!done) { fx('boss.line'); playMusic('boss'); }
    });
    wait(4200 * motion.factor * motion.testScale).then(finish);
  });
}

/** Every moth bursts into petals, and the table goes back to daylight. */
export async function bossDefeatMoment(t: Table): Promise<void> {
  fx('boss.victory');
  const moths = [...t.root.querySelectorAll<HTMLElement>('.moth')];
  const garland = rectOf(t.root.querySelector('.garland')!);
  const w = t.root.clientWidth;
  const spots = moths.length > 0 ? moths.map((m) => center(rectOf(m))) : Array.from({ length: 6 }, (_, i) => ({ x: rectOf(t.root).left + (w / 7) * (i + 1), y: garland.top + 30 }));
  moths.forEach((m) => m.remove());
  for (const p of spots) burst(p.x, p.y, 10, ['petal'], 90);
  t.root.classList.add('daylight');
  t.root.dataset.cloth = 'blush-gingham';
  await pause(500);
  const banner = h('div.banner.boss-banner', { 'data-testid': 'boss-banner', style: `top:${rectOf(t.clothEl).top - rectOf(t.fxEl).top + t.rem * 3}px` }, 'The garden is yours!');
  t.fxEl.append(banner);
  await animate(banner, [
    { transform: 'translateX(-50%) scale(.6)', opacity: 0 },
    { transform: 'translateX(-50%) scale(1.08)', opacity: 1, offset: 0.65 },
    { transform: 'translateX(-50%) scale(1)', opacity: 1 },
  ], { ms: 420 });
  await pause(1400);
}

/* ---------- Lady Lunaria ---------- */

/**
 * About 4 s, tap to skip. Mist gathers from the edges, silver threads weave into a crown, Lunaria rises,
 * Puff and Haze bob into their seats, then her line, the rule chips, and her music.
 */
export function lunariaIntro(t: Table, line: string, fogged: boolean): Promise<void> {
  return new Promise((resolve) => {
    fx('lunaria.intro');
    sfx('bossIntro');
    const host = t.root;
    const overlay = h('div.boss-intro.lunaria-intro', { 'data-testid': 'boss-intro' });
    host.append(overlay);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      finishAll();
      playMusic('lunaria');
      void animate(overlay, [{ opacity: 1 }, { opacity: 0 }], { ms: 260 }).then(() => {
        overlay.remove();
        resolve();
      });
    };
    overlay.addEventListener('pointerdown', finish);
    overlay.addEventListener('click', finish);
    const s = motion.factor * motion.testScale;

    const mist = h('div.li-mist');
    overlay.append(mist);
    fx('lunaria.mist');
    void animate(mist, [{ opacity: 0, transform: 'scale(1.25)' }, { opacity: 1, transform: 'scale(1)' }], { ms: 900, ease: SOFT });

    // Silver threads weave across the screen into a crown.
    const threads = h('div.li-threads', { html: '<svg viewBox="0 0 200 120" aria-hidden="true"><path d="M10 100C60 60 140 140 190 60" /><path d="M10 60C70 120 130 20 190 100" /><path d="M30 92L44 40L70 74L100 22L130 74L156 40L170 92Z" class="crown-line"/></svg>' });
    overlay.append(threads);
    fx('lunaria.threads');
    threads.querySelectorAll('path').forEach((p, i) => {
      void animate(p, [{ strokeDashoffset: 400 }, { strokeDashoffset: 0 }], { ms: 1100, delay: 300 + i * 220, ease: SOFT });
    });

    const portrait = portraitEl('lunaria', 'large', 'intense');
    const glow = h('div.bi-glow.li-glow');
    const title = h('h1.bi-title.li-title', { 'data-testid': 'boss-title' }, LUNARIA_TITLE);
    const said = h('p.bi-line.li-line', { 'data-testid': 'boss-line' }, line);
    const chips = h('div.rule-chips.li-chips', null,
      fogged ? h('span.rule-chip', { html: `${icon('wisp')}<span>Moonlit Fog — card counts are hidden.</span>` }) : null,
      h('span.rule-chip', { html: `${icon('thorncrown')}<span>Thorned Crown — no one can add to Lunaria's groups.</span>` }),
    );
    overlay.append(h('div.bi-center', null, glow, portrait, title, said, chips));
    fx('lunaria.portrait');
    void animate(portrait, [{ transform: 'translateY(60px) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }], { ms: 800, delay: 1300, ease: SOFT });
    void animate(glow, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }], { ms: 900, delay: 1300, ease: SOFT });
    void animate(title, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'scale(1)' }], { ms: 500, delay: 1900, ease: SOFT });

    // Puff and Haze bob into their seats.
    t.match.lineup.forEach((bot, i) => {
      if (bot !== 'puff' && bot !== 'haze') return;
      fx('lunaria.wispsIn');
      void animate(t.chips[i + 1], [{ transform: 'translateY(-2.4rem)', opacity: 0 }, { transform: 'translateY(.4rem)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }], { ms: 700, delay: 2200 + i * 120, ease: SOFT });
    });
    void animate(said, [{ opacity: 0 }, { opacity: 1 }], { ms: 500, delay: 2600 });
    void animate(chips, [{ opacity: 0, transform: 'translateY(.6rem)' }, { opacity: 1, transform: 'none' }], { ms: 400, delay: 3000 });
    void wait(2600 * s).then(() => {
      if (!done) { fx('lunaria.line'); playMusic('lunaria'); }
    });
    void wait(4200 * s).then(finish);
  });
}

/** On the first win only: her portrait dissolves into pink mist before the usual victory. */
export async function lunariaDefeatMoment(t: Table): Promise<void> {
  fx('lunaria.dissolve');
  const seat = t.match.lineup.indexOf('lunaria') + 1;
  const portrait = t.portraits[seat];
  if (!portrait) return;
  const r = rectOf(portrait);
  const c = center(r);
  const mist = h('div.li-dissolve');
  const host = rectOf(t.fxEl);
  mist.style.cssText = `left:${c.x - host.left}px;top:${c.y - host.top}px`;
  t.fxEl.append(mist);
  void animate(portrait, [{ opacity: 1, filter: 'blur(0)' }, { opacity: 0, filter: 'blur(6px)' }], { ms: 900, ease: SOFT, fill: 'forwards' });
  await animate(mist, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.4)' }, { opacity: 0.9, transform: 'translate(-50%,-50%) scale(1.4)', offset: 0.5 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(2.4)' }], { ms: 1200, ease: SOFT });
  mist.remove();
  burst(c.x, c.y, 14, ['petal'], 80);
  await pause(400);
}
