// Collection: card backs, tablecloths, music and Charms.
import { CHARMS, UNLOCKABLES, requirementText, type Unlockable, type UnlockType } from '../../content.ts';
import { isUnlocked } from '../../meta/progress.ts';
import { app, persist } from '../app.ts';
import { backEl, icon } from '../art.ts';
import { playMusic } from '../audio/audio.ts';
import { clear, h } from '../dom.ts';
import { openSheet } from '../overlays.ts';
import { bottomNav } from './journey.ts';

/** The picture of an unlockable item. */
export function itemPreview(u: Unlockable): HTMLElement {
  if (u.type === 'back') return backEl(u.id);
  if (u.type === 'cloth') return h(`div.swatch.c-${u.id}`, null, h('i.swatch-stitch'));
  if (u.type === 'music') return h('div.music-disc', { html: icon('sparkle') });
  return h('div.mode-badge', { html: icon('cards') });
}

const TABS: { id: UnlockType | 'charms'; label: string }[] = [
  { id: 'back', label: 'Card Backs' },
  { id: 'cloth', label: 'Tablecloths' },
  { id: 'music', label: 'Music' },
  { id: 'charms', label: 'Charms' },
];

export function collectionScreen(): HTMLElement {
  let tab: UnlockType | 'charms' = 'back';
  const tabs = h('div.seg.tabs', { role: 'tablist' });
  const body = h('div.page-scroll');

  const equippedKey = (type: UnlockType) => (type === 'back' ? 'back' : type === 'cloth' ? 'cloth' : 'music') as 'back' | 'cloth' | 'music';

  const draw = () => {
    clear(tabs);
    for (const t of TABS) {
      tabs.append(h('button.seg-btn', { class: tab === t.id ? 'on' : '', role: 'tab', 'aria-selected': tab === t.id ? 'true' : 'false', 'data-testid': `tab-${t.id}`, onclick: () => { tab = t.id; draw(); } }, t.label));
    }
    clear(body);
    if (tab === 'charms') {
      const grid = h('div.charm-grid', { 'data-testid': 'charm-grid' });
      for (const c of CHARMS) {
        const earned = app.save.charms.includes(c.id);
        grid.append(h('div.charm-item', { class: earned ? 'earned' : '', 'data-charm': c.id, 'data-earned': earned ? '1' : '0' },
          h('span.pendant', { html: icon(earned ? 'sparkle' : 'lock') }),
          h('b', null, c.name),
          h('small', null, c.text),
        ));
      }
      body.append(grid);
      return;
    }
    const grid = h('div.item-grid');
    for (const u of UNLOCKABLES.filter((x) => x.type === tab)) {
      const open = isUnlocked(app.save, u.id);
      const key = equippedKey(u.type);
      const equipped = app.save.equipped[key] === u.id;
      const item = h('button.item', {
        class: `${open ? '' : 'locked'} ${equipped ? 'equipped' : ''}`,
        'data-testid': `item-${u.id}`, 'data-unlocked': open ? '1' : '0',
        'aria-label': open ? `${u.name}${equipped ? ', equipped' : ''}` : `${u.name}, locked. ${requirementText(u.req)}`,
      },
        h('div.item-art', null, open ? itemPreview(u) : h('div.silhouette', { html: icon('lock') })),
        h('b', null, u.name),
        open ? null : h('small', null, requirementText(u.req)),
        equipped ? h('i.tick', { html: icon('check') }) : null,
      );
      if (open) item.addEventListener('click', () => preview(u, draw));
      grid.append(item);
    }
    body.append(grid);
  };
  draw();

  return h('div.screen.page-screen', { 'data-screen': 'collection' },
    h('div.page-top', null, h('h1.game-title', null, 'Collection')),
    tabs,
    body,
    bottomNav('collection'),
  );
}

function preview(u: Unlockable, redraw: () => void): void {
  const key = (u.type === 'back' ? 'back' : u.type === 'cloth' ? 'cloth' : 'music') as 'back' | 'cloth' | 'music';
  const equipped = app.save.equipped[key] === u.id;
  if (u.type === 'music') playMusic(u.id === 'music-box' ? 'musicbox' : 'waltz');
  const sheet = openSheet([
    h('div.preview-large', null, itemPreview(u)),
    h('button.btn.primary.begin', {
      'data-testid': 'equip',
      disabled: equipped,
      onclick: () => {
        app.save.equipped[key] = u.id;
        persist();
        redraw();
        void sheet.close();
      },
    }, equipped ? 'Equipped' : 'Equip'),
  ], { title: u.name, onClose: () => { if (u.type === 'music') playMusic('map'); } });
}
