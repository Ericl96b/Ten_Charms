// Round end, review, discard history, and the match-end sequences.
import { BOTS, CHARMS, STOPS, TYPE_LABEL, type Unlockable } from '../../content.ts';
import { cardLabel, cardPoints } from '../../engine/cards.ts';
import type { Card, HistoryEntry, RoundResult } from '../../engine/types.ts';
import type { MatchSummary } from '../../meta/progress.ts';
import { standings } from '../../meta/progress.ts';
import type { SavedMatch } from '../../meta/save.ts';
import { app, persist, show } from '../app.ts';
import { bigRose, cardEl, icon, portraitEl, teacupLid } from '../art.ts';
import { sfx } from '../audio/audio.ts';
import { clear, h, wait } from '../dom.ts';
import { SOFT, SPRING, animate, burst, center, finishAll, fx, motion, pause, rollNumber } from '../fx/motion.ts';
import { closeAllSheets, confirmSheet, openSheet } from '../overlays.ts';
import type { Table } from '../table/table.ts';
import { journey, startFromMode } from './journey.ts';
import { itemPreview } from './collection.ts';

function seatName(t: Table, seat: number): string {
  return seat === 0 ? 'You' : BOTS[t.match.lineup[seat - 1]].name;
}

function seatPortrait(t: Table, seat: number): HTMLElement {
  return seat === 0 ? h('div.portrait.p-small.you', null, h('span', null, 'You')) : portraitEl(t.match.lineup[seat - 1], 'small');
}

function miniCards(cards: Card[]): HTMLElement {
  const box = h('div.mini-row', { class: cards.length > 5 ? 'tight' : '' });
  cards.forEach((c) => box.append(cardEl(c, true)));
  return box;
}

function phaseChange(t: Table, r: RoundResult, seat: number): HTMLElement {
  const before = r.phasesBefore[seat];
  if (!r.advanced[seat]) return h('span.ph-change.stay', null, `Stays on ${before}`);
  const after = t.game.players[seat].phase ?? (before !== null ? before + 1 : 0);
  const isChoose = t.game.variant === 'choose';
  const finished = t.game.stage === 'matchOver' || isChoose;
  return h('span.ph-change', { html: finished ? `Phase ${before} ${icon('check')}` : `Phase ${before} <i class="gold-arrow">→</i> ${nextFor(t, before!, after)}` });
}

function nextFor(t: Table, before: number, _after: number): number {
  const seq = t.game.variant === 'sprint' ? [1, 3, 5, 7, 9] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  return seq[seq.indexOf(before) + 1] ?? before;
}

/** The screen after every round's tally. */
export function showRoundEnd(t: Table): void {
  const r = t.game.lastRound!;
  fx('round.screen');
  const rows = r.hands.map((hand, seat) => {
    const total = h('b.total');
    total.dataset.value = String(r.totals[seat] - r.points[seat]);
    total.textContent = total.dataset.value;
    const row = h('div.re-row', { 'data-seat': seat, 'data-testid': `round-row-${seat}` },
      seatPortrait(t, seat),
      h('div.re-main', null,
        h('b.re-name', null, seatName(t, seat), seat === r.wentOut ? h('span.out-tag', null, 'Out') : null),
        hand.length > 0 ? miniCards(hand) : h('span.re-none', null, 'No cards left'),
        phaseChange(t, r, seat),
      ),
      h('div.re-score', null, h('span.plus', null, `+${r.points[seat]}`), total),
    );
    setTimeout(() => rollNumber(total, r.totals[seat]), 260);
    return row;
  });
  const screen = h('div.overlay-screen.round-end', { 'data-testid': 'round-end', 'data-screen': 'round-end' },
    h('h2.title', null, `Round ${r.round} complete`),
    h('div.re-rows', null, rows),
    h('div.re-actions', null,
      h('button.btn.secondary', { 'data-testid': 'review-hands', onclick: () => reviewSheet(t, r) }, 'Review Hands'),
      h('button.btn.primary', {
        'data-testid': 'next-round',
        onclick: () => {
          void animate(screen, [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], { ms: 240, ease: 'ease-in' }).then(() => screen.remove());
          t.beginNextRound();
        },
      }, 'Next Round'),
    ),
  );
  t.root.append(screen);
  void animate(screen, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { ms: 360, ease: SOFT, fill: 'backwards' });
}

function historyList(t: { match: SavedMatch }, entries: readonly HistoryEntry[]): HTMLElement {
  const nameOf = (seat: number) => (seat < 0 ? 'First card' : seat === 0 ? 'You' : BOTS[t.match.lineup[seat - 1]].name);
  const list = h('div.history', { 'data-testid': 'history' });
  const discards = entries.filter((e) => e.kind === 'discard' || e.kind === 'reshuffle');
  if (discards.length === 0) list.append(h('p.sheet-text', null, 'No discards yet.'));
  discards.forEach((e, i) => {
    if (e.kind === 'reshuffle') {
      list.append(h('div.hist-note', null, 'Reshuffled into the draw pile'));
      return;
    }
    if (e.kind !== 'discard') return;
    list.append(h('div.hist-row', null,
      h('span.hist-n', null, i + 1),
      cardEl(e.card, true),
      h('span.hist-text', null,
        h('b', null, cardLabel(e.card)),
        h('small', null, `${nameOf(e.seat)}${e.pickedUpBy !== undefined ? `, picked up by ${nameOf(e.pickedUpBy)}` : ''}`),
      ),
    ));
  });
  return list;
}

/** Everything anyone discarded this round, the same record the Tracker bots remember. */
export function historySheet(t: Table): void {
  openSheet(historyList(t, t.game.history), { title: 'Discard history' });
}

/** Every player's final hand, how the points were counted, the seed and the discards. */
export function reviewSheet(t: Table, r: RoundResult): void {
  const hands = r.hands.map((hand, seat) => h('div.review-hand', { 'data-testid': `review-${seat}` },
    h('div.review-head', null, seatPortrait(t, seat), h('b', null, seatName(t, seat)), h('span.pts', null, `${r.points[seat]} pts`)),
    hand.length > 0 ? miniCards(hand) : h('p.re-none', null, 'No cards left'),
    hand.length > 0 ? h('p.count-line', null, hand.map((c) => `${cardLabel(c)} ${cardPoints(c)}`).join(' + ')) : null,
  ));
  openSheet([
    h('div.review', { 'data-testid': 'review-sheet' }, hands,
      h('div.seed', null, h('small', null, 'Round seed'), h('code', { 'data-testid': 'seed' }, r.seed)),
      h('h3', null, 'Discards'),
      historyList(t, r.history),
    ),
  ], { title: `Review of round ${r.round}`, className: 'tall' });
}

/* ---------- Match end ---------- */

export function showMatchEnd(t: Table, match: SavedMatch, s: MatchSummary): void {
  closeAllSheets();
  if (s.humanWon) void victory(t, match, s);
  else loss(t, match, s);
}

function rematch(match: SavedMatch): void {
  closeAllSheets();
  startFromMode(match.mode, match.lineup, match.game.variant, match.back, match.cloth);
}

function toMap(): void {
  closeAllSheets();
  show(journey(), 'map');
  maybeBackupPrompt();
}

function maybeBackupPrompt(): void {
  if (app.save.campaign.won[4] && !app.save.backupPrompted) {
    app.save.backupPrompted = true;
    persist();
    confirmSheet('Want to back up your garden?', 'A backup code keeps your stars and Charms safe. You can make one in Settings.', 'Open Settings', () => {
      void import('./settings.ts').then((m) => m.settingsScreen(false));
    }, 'Not now');
  }
}

/** Stars, then each unlock, then each Charm. Tapping jumps ahead; nothing traps her. */
async function victory(t: Table, match: SavedMatch, s: MatchSummary): Promise<void> {
  fx('victory.bloom');
  sfx('victory');
  const screen = h('div.overlay-screen.victory', { 'data-testid': 'victory', 'data-screen': 'victory' });
  const dim = h('div.dim');
  screen.append(dim);
  t.root.append(screen);
  void animate(dim, [{ opacity: 0 }, { opacity: 1 }], { ms: 300 });
  const stage = h('div.vic-stage');
  screen.append(stage);
  const roseWrap = h('div.rose-wrap', { html: bigRose() });
  stage.append(roseWrap);
  const layers = roseWrap.querySelectorAll('.pl');
  layers.forEach((l, i) => {
    const stepMs = motion.reduced ? 300 : 900;
    void animate(l, [{ transform: 'scale(.15) rotate(-40deg)', opacity: 0 }, { transform: 'scale(1) rotate(0)', opacity: 1 }], { ms: stepMs * 0.7, delay: i * stepMs * 0.1, ease: SPRING });
  });
  const title = h('h1.vic-title', { 'data-testid': 'victory-title' }, 'Victory!');
  stage.append(title);
  void animate(title, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], { ms: 420, delay: 420 });

  let skipped = false;
  const onTap = () => {
    skipped = true;
    finishAll();
  };
  screen.addEventListener('pointerdown', onTap);
  await pause(skipped ? 0 : 900);

  if (match.mode.kind === 'campaign') {
    const stars = h('div.vic-stars', { 'data-testid': 'stars', 'aria-label': `${s.stars} of 3 stars` });
    stage.append(stars);
    for (let i = 0; i < 3; i++) {
      const earned = i < s.stars;
      const star = h('span.vstar', { class: earned ? 'on' : 'off', html: icon('star') });
      stars.append(star);
      if (earned) {
        fx('victory.star');
        sfx('star', { step: i });
        await animate(star, [{ transform: 'translateY(-90px) scale(1.4)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.6 }, { transform: 'translateY(-10px) scale(1)', offset: 0.8 }, { transform: 'translateY(0) scale(1)' }], { ms: 340, ease: 'ease-in' });
        const c = center(star.getBoundingClientRect());
        burst(c.x, c.y, 8, ['sparkle', 'gold'], 50);
        if (!skipped) await pause(30);
      }
    }
    stage.append(h('p.vic-rounds', null, `Won in ${s.rounds} rounds`));
  } else {
    stage.append(h('p.vic-rounds', null, `Won in ${s.rounds} rounds`));
  }
  await pause(skipped ? 0 : 450);
  screen.removeEventListener('pointerdown', onTap);

  for (const unlock of s.newUnlocks) await revealUnlock(screen, unlock);
  for (const id of s.newCharms) await revealCharm(screen, id);

  stage.append(h('div.re-actions.end', null,
    h('button.btn.secondary', { 'data-testid': 'rematch', onclick: () => rematch(match) }, 'Rematch'),
    h('button.btn.primary', { 'data-testid': 'continue', onclick: toMap }, 'Continue'),
  ));
  t.autoHook?.();
}

function revealUnlock(screen: HTMLElement, u: Unlockable): Promise<void> {
  return new Promise((resolve) => {
    fx('victory.unlock');
    sfx('unlock');
    const lid = h('div.lid', { html: teacupLid() });
    const item = h('div.reveal-item', null, itemPreview(u));
    const name = h('b.reveal-name', null, u.name);
    const type = h('small.reveal-type', null, TYPE_LABEL[u.type]);
    const card = h('button.reveal', { 'data-testid': 'reveal', 'aria-label': `Unlocked ${u.name}` },
      h('div.reveal-cup', null, item, lid), name, type, h('small.tap-on', null, 'Tap to continue'),
    );
    screen.append(card);
    void animate(card, [{ transform: 'translateY(30px) scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], { ms: 300, ease: SPRING });
    if (!motion.reduced) void animate(lid, [
      { transform: 'translateY(0) rotate(0)' }, { transform: 'translateY(-6px) rotate(-5deg)', offset: 0.15 }, { transform: 'translateY(-6px) rotate(5deg)', offset: 0.3 }, { transform: 'translateY(-90px) rotate(-14deg)', opacity: 0 },
    ], { ms: 900, delay: 260, ease: 'ease-in-out' });
    else void animate(lid, [{ opacity: 1 }, { opacity: 0 }], { ms: 400, delay: 200 });
    void animate(item, [{ transform: 'translateY(30px) scale(.7) rotateY(0)', opacity: 0 }, { transform: 'translateY(0) scale(1) rotateY(360deg)', opacity: 1 }], { ms: 1100, delay: 500, ease: SOFT });
    void animate(name, [{ opacity: 0 }, { opacity: 1 }], { ms: 240, delay: 1200 });
    void animate(type, [{ opacity: 0 }, { opacity: 1 }], { ms: 240, delay: 1200 });
    const close = () => {
      finishAll();
      card.remove();
      resolve();
    };
    card.addEventListener('click', close);
  });
}

function revealCharm(screen: HTMLElement, id: string): Promise<void> {
  return new Promise((resolve) => {
    fx('victory.charm');
    sfx('charm');
    const charm = CHARMS.find((c) => c.id === id)!;
    const pendant = h('div.ribbon-pendant', null, h('i.ribbon-line'), h('span.pendant.big', { html: icon('sparkle') }));
    const card = h('button.reveal.charm', { 'data-testid': 'reveal-charm', 'aria-label': `Charm earned: ${charm.name}` },
      pendant, h('b.reveal-name', null, charm.name), h('small.reveal-type', null, charm.text), h('small.tap-on', null, 'Tap to continue'));
    screen.append(card);
    void animate(pendant, [
      { transform: 'rotate(-34deg) translateY(-80px)', opacity: 0 },
      { transform: 'rotate(16deg)', opacity: 1, offset: 0.4 },
      { transform: 'rotate(-8deg)', offset: 0.7 },
      { transform: 'rotate(0)' },
    ], { ms: 800, ease: 'ease-out' });
    card.addEventListener('click', () => {
      finishAll();
      card.remove();
      resolve();
    });
  });
}

function loss(t: Table, match: SavedMatch, s: MatchSummary): void {
  fx('loss.petals');
  sfx('defeat');
  const place = s.standings.indexOf(0) + 1;
  const winner = standings(match.game).find((seat) => seat !== 0) ?? 1;
  const winnerSeat = match.game.winners[0] ?? winner;
  const bot = match.lineup[winnerSeat - 1];
  const screen = h('div.overlay-screen.loss', { 'data-testid': 'loss', 'data-screen': 'loss' });
  const fall = h('div.petal-fall');
  screen.append(fall);
  const count = motion.reduced ? 5 : 16;
  for (let i = 0; i < count; i++) {
    const p = h('i.fall-petal', { style: `left:${Math.random() * 100}%` });
    fall.append(p);
    void animate(p, [
      { transform: 'translateY(-20px) rotate(0)', opacity: 0 },
      { transform: 'translateY(30vh) rotate(120deg)', opacity: 0.9, offset: 0.3 },
      { transform: 'translateY(100vh) rotate(380deg)', opacity: 0.2 },
    ], { ms: 3200 + Math.random() * 1600, delay: Math.random() * 1400, ease: 'linear' }).then(() => p.remove());
  }
  const me = match.game.players[0];
  const reached = me.phase ?? me.completed.length;
  const card = h('div.loss-card', null,
    portraitEl(bot, 'medium', 'happy'),
    h('h1.title', null, 'So close!'),
    h('p.sheet-text', null, `${BOTS[bot].name} takes this one.`),
    h('div.loss-facts', null,
      h('span', null, h('small', null, 'Your place'), h('b', { 'data-testid': 'loss-place' }, ordinal(place))),
      h('span', null, h('small', null, 'Phase reached'), h('b', null, reached)),
    ),
    h('div.re-actions.end', null,
      h('button.btn.secondary', { 'data-testid': 'back-map', onclick: toMap }, 'Back to Map'),
      h('button.btn.primary', { 'data-testid': 'try-again', onclick: () => rematch(match) }, 'Try Again'),
    ),
  );
  screen.append(card);
  t.root.append(screen);
  void animate(card, [{ transform: 'translateY(60px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { ms: 480, ease: SOFT, fill: 'backwards' });
}

function ordinal(n: number): string {
  return ['1st', '2nd', '3rd', '4th', '5th', '6th'][n - 1] ?? `${n}th`;
}

void clear;
void wait;
void STOPS;
