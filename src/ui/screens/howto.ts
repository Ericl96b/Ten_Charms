// How to Play: the rules in plain, friendly language.
import { PHASES, phaseText } from '../../engine/phases.ts';
import { app, persist } from '../app.ts';
import { cardEl, icon } from '../art.ts';
import { h } from '../dom.ts';
import { SOFT, animate } from '../fx/motion.ts';
import { noteToast } from '../overlays.ts';
import type { Card } from '../../engine/types.ts';

const c = (id: number, num: number, suit: 'rose' | 'moss' | 'moonstone' | 'honey'): Card => ({ id, kind: 'num', num, suit });
const WILD: Card = { id: 96, kind: 'wild' };
const SKIP: Card = { id: 104, kind: 'skip' };

function sample(cards: Card[]): HTMLElement {
  return h('div.sample', { 'aria-hidden': 'true' }, cards.map((x) => cardEl(x, true)));
}

export function howToPlay(onClose: () => void): void {
  const screen = h('div.overlay-screen.page-screen.howto', { 'data-testid': 'howto', 'data-screen': 'howto' });
  const close = () => {
    onClose();
    void animate(screen, [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], { ms: 220, ease: 'ease-in' }).then(() => screen.remove());
  };
  const sec = (title: string, ...body: (HTMLElement | string)[]) => h('section.how-sec', null, h('h2.sec', null, title), ...body.map((b) => (typeof b === 'string' ? h('p', null, b) : b)));
  screen.append(
    h('div.page-top', null,
      h('button.round-btn', { 'aria-label': 'Back', html: icon('back'), onclick: close }),
      h('h1.game-title', null, 'How to Play'),
      h('i.spacer'),
    ),
    h('div.page-scroll', null,
      sec('The goal', 'Complete all ten phases, in order, before anyone else. When someone finishes the last one, the player among those finishers with the lowest score wins the match.'),
      sec('The phases', h('ol.phase-list', null, Object.keys(PHASES).map((p) => h('li', null, h('b', null, `Phase ${p}`), h('span', null, phaseText(Number(p))))))),
      sec('Sets, Runs and Color',
        h('p', null, h('b', null, 'A Set'), ' is cards of the same number. The suit doesn\'t matter.'),
        sample([c(0, 7, 'rose'), c(1, 7, 'moss'), c(2, 7, 'honey')]),
        h('p', null, h('b', null, 'A Run'), ' is cards in a row. The suit doesn\'t matter, and 12 is not followed by 1.'),
        sample([c(3, 4, 'moss'), c(4, 5, 'rose'), c(5, 6, 'honey'), c(6, 7, 'moonstone')]),
        h('p', null, h('b', null, 'A Color group'), ' is cards of one suit, with any numbers.'),
        sample([c(7, 2, 'moonstone'), c(8, 9, 'moonstone'), c(9, 11, 'moonstone')]),
      ),
      sec('Wilds and Skips',
        sample([WILD, SKIP]),
        'A Wild can stand in for any card in a group, but every group needs at least one regular card. You can even pick a Wild up from the discard pile.',
        'A Skip makes someone miss their next turn. Discard it and choose who. Skips can\'t go in groups, and they can\'t be picked up.',
      ),
      sec('Your turn',
        h('ol.steps', null,
          h('li', null, 'Draw one card, from the draw pile or the discard pile.'),
          h('li', null, 'Lay down your phase if you can. Tap cards, then tap a slot to build each group.'),
          h('li', null, 'Once your phase is down, you can hit.'),
          h('li', null, 'Discard one card to end your turn.'),
        ),
      ),
      sec('Hitting', 'After laying down your phase, add cards from your hand to any group on the table, yours or anyone else\'s. You can do it on the same turn you lay down.'),
      sec('Going out', 'When your hand is empty, you\'re out and the round ends right away. Everyone who laid down moves on to their next phase. Everyone else tries the same phase again.'),
      sec('Scoring',
        'Cards left in your hand count against you, so lower is better.',
        h('div.score-table', null,
          h('span', null, '1 to 9'), h('b', null, '5'),
          h('span', null, '10 to 12'), h('b', null, '10'),
          h('span', null, 'Skip'), h('b', null, '15'),
          h('span', null, 'Wild'), h('b', null, '25'),
        ),
      ),
      h('section.how-sec.fair', { 'data-testid': 'fair-play' },
        h('h2.sec', null, 'Fair play promise'),
        h('p', null, 'The bots can\'t see your cards, and they get no lucky draws. Everyone plays from the same fair shuffle by the same rules. After any round, tap the eye button to see every hand and check for yourself.'),
      ),
      h('button.btn.secondary.wide', {
        'data-testid': 'replay-tutorial',
        onclick: () => {
          app.save.tutorial = { done: false, seen: [] };
          persist();
          noteToast('Tips will show at your next match with Pip.');
        },
      }, 'Replay tutorial'),
    ),
  );
  document.getElementById('overlays')!.append(screen);
  void animate(screen, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { ms: 320, ease: SOFT, fill: 'backwards' });
}
