// Free Play setup: pick opponents, a variant, and the look of the table.
import type { BotId } from '../../bots/profiles.ts';
import { BOTS, UNLOCKABLES } from '../../content.ts';
import type { Variant } from '../../engine/types.ts';
import { botsUnlocked, isUnlocked } from '../../meta/progress.ts';
import { app } from '../app.ts';
import { icon, portraitEl } from '../art.ts';
import { clear, h } from '../dom.ts';
import { invalid } from '../overlays.ts';
import { itemPreview } from './collection.ts';
import { bottomNav, startFromMode } from './journey.ts';

export function freePlayScreen(): HTMLElement {
  const save = app.save;
  const chosen = new Set<BotId>([botsUnlocked(save)[0]]);
  let variant: Variant = 'standard';
  let back = save.equipped.back;
  let cloth = save.equipped.cloth;

  const bots = h('div.fp-bots', { 'data-testid': 'fp-bots' });
  const variants = h('div.seg');
  const backs = h('div.fp-items');
  const cloths = h('div.fp-items');
  const begin = h('button.btn.primary.begin', { 'data-testid': 'fp-begin' }, 'Begin');

  const redraw = () => {
    clear(bots);
    for (const id of botsUnlocked(save)) {
      const on = chosen.has(id);
      const b = h('button.fp-bot', { class: on ? 'on' : '', 'data-testid': `fp-bot-${id}`, 'aria-pressed': on ? 'true' : 'false' },
        portraitEl(id, 'small'), h('span', null, BOTS[id].name), on ? h('i.tick', { html: icon('check') }) : null);
      b.addEventListener('click', () => {
        if (on && chosen.size === 1) { invalid(b, 'Choose at least one opponent.'); return; }
        if (on) chosen.delete(id);
        else chosen.add(id);
        redraw();
      });
      bots.append(b);
    }
    clear(variants);
    const options: [Variant, string, boolean][] = [
      ['standard', 'Standard', true],
      ['sprint', 'Sprint', isUnlocked(save, 'sprint')],
      ['choose', 'Choose Your Phase', isUnlocked(save, 'choose')],
      ['moonlit', 'Moonlit Phases', isUnlocked(save, 'moonlit')],
      // The trials open with the Moonlit Phases, in the order the simulation ranked them.
      ['trialA', 'Moonlit Trial A', isUnlocked(save, 'moonlit')],
      ['trialB', 'Moonlit Trial B', isUnlocked(save, 'moonlit')],
      ['trialC', 'Moonlit Trial C', isUnlocked(save, 'moonlit')],
    ];
    for (const [id, label, open] of options) {
      if (!open) continue;
      variants.append(h('button.seg-btn', { class: variant === id ? 'on' : '', 'data-testid': `fp-variant-${id}`, onclick: () => { variant = id; redraw(); } }, label));
    }
    clear(backs);
    for (const u of UNLOCKABLES.filter((x) => x.type === 'back' && isUnlocked(save, x.id))) {
      backs.append(h('button.fp-item', { class: back === u.id ? 'on' : '', 'aria-label': u.name, onclick: () => { back = u.id; redraw(); } }, itemPreview(u), h('small', null, u.name)));
    }
    clear(cloths);
    for (const u of UNLOCKABLES.filter((x) => x.type === 'cloth' && isUnlocked(save, x.id))) {
      cloths.append(h('button.fp-item', { class: cloth === u.id ? 'on' : '', 'aria-label': u.name, onclick: () => { cloth = u.id; redraw(); } }, itemPreview(u), h('small', null, u.name)));
    }
  };
  redraw();

  begin.addEventListener('click', () => {
    const order = botsUnlocked(save).filter((b) => chosen.has(b));
    startFromMode({ kind: 'free' }, order, variant, back, cloth);
  });

  return h('div.screen.page-screen', { 'data-screen': 'free' },
    h('div.page-top', null, h('h1.game-title', null, 'Free Play')),
    h('div.page-scroll', null,
      h('h2.sec', null, 'Opponents'), bots,
      h('h2.sec', null, 'Variant'), variants,
      h('h2.sec', null, 'Card back'), backs,
      h('h2.sec', null, 'Tablecloth'), cloths,
      begin,
    ),
    bottomNav('free'),
  );
}
