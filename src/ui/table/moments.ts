// The table's set pieces: deal, lay down, hit, skip, going out, and the round-end tally.
import { BOTS } from '../../content.ts';
import { cardPoints } from '../../engine/cards.ts';
import type { Card, RoundResult } from '../../engine/types.ts';
import { backEl, cardEl, hourglassEl, portraitEl } from '../art.ts';
import { sfx } from '../audio/audio.ts';
import { h, rectOf } from '../dom.ts';
import { SPRING, animate, burst, center, confetti, fx, motion, pause, shake } from '../fx/motion.ts';
import { flyCard, type Table } from './table.ts';

type Box = { left: number; top: number; width: number; height: number };

const DEAL_GAP = 40;

/** Cards fly out to each seat in turn; hers land face-down and flip in a quick wave. */
export async function dealAnimation(t: Table): Promise<void> {
  fx('ui.deal');
  const from = rectOf(t.drawEl);
  const seats = t.game.playerCount;
  const ids = t.displayIds();
  const covers = new Map<number, HTMLElement>();
  for (const id of ids) {
    const el = t.handEls.get(id);
    if (!el) continue;
    el.classList.add('incoming');
    const cover = backEl(t.match.back);
    cover.classList.add('deal-cover');
    el.append(cover);
    covers.set(id, cover);
  }
  const dealOne = async (seat: number, index: number) => {
    let to: Box;
    if (seat === 0) {
      const id = ids[index];
      to = t.handSpotRect(id);
      sfx('deal', { quiet: 0.8 });
    } else {
      const c = rectOf(t.chips[seat]);
      to = { left: c.left + c.width / 2 - from.width * 0.2, top: c.top + c.height / 2 - from.height * 0.2, width: from.width * 0.4, height: from.height * 0.4 };
    }
    await flyCard(t, null, from, to, false, 200);
    if (seat === 0) t.handEls.get(ids[index])?.classList.remove('incoming');
  };
  const flights: Promise<void>[] = [];
  const first = (t.game.dealer + 1) % seats;
  for (let c = 0; c < 10; c++) {
    for (let s = 0; s < seats; s++) {
      const seat = (first + s) % seats;
      flights.push(dealOne(seat, c));
      await pause(DEAL_GAP);
    }
  }
  await Promise.all(flights);
  await Promise.all(ids.map(async (id, i) => {
    const cover = covers.get(id);
    const el = t.handEls.get(id);
    if (!cover || !el) return;
    await pause(i * 32);
    const face = el.querySelector<HTMLElement>('.card:not(.deal-cover)');
    await animate(cover, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { ms: 80, ease: 'ease-in' });
    cover.remove();
    if (face) await animate(face, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { ms: 90, ease: 'ease-out', fill: 'none' });
  }));
}

function banner(t: Table, text: string, cls = ''): HTMLElement {
  const el = h(`div.banner${cls ? `.${cls}` : ''}`, { 'data-testid': 'banner' }, text);
  const cloth = rectOf(t.clothEl);
  const host = rectOf(t.fxEl);
  el.style.top = `${cloth.top - host.top + t.rem * 1.4}px`;
  t.fxEl.append(el);
  void animate(el, [
    { transform: 'translateX(-50%) scale(.6)', opacity: 0 },
    { transform: 'translateX(-50%) scale(1.08)', opacity: 1, offset: 0.65 },
    { transform: 'translateX(-50%) scale(1)', opacity: 1 },
  ], { ms: 360, ease: 'ease-out' });
  return el;
}

/** Her phase going down: the game's biggest regular moment, about 1.6 s. */
export async function layDownMoment(t: Table, phase: number, groupIds: number[]): Promise<void> {
  sfx('layDown');
  t.renderHand();
  t.renderChips();
  t.renderLaid();
  const flights: Promise<void>[] = [];
  let n = 0;
  const ghosts: HTMLElement[] = [];
  fx('lay.fly');
  for (const gid of groupIds) {
    const group = t.laidEl.querySelector<HTMLElement>(`[data-group-id="${gid}"]`);
    if (!group) continue;
    group.querySelectorAll<HTMLElement>('.card').forEach((mini) => {
      const id = Number(mini.dataset.cardId);
      const placed = t.game.groups.find((g) => g.id === gid)?.cards.find((c) => c.card.id === id);
      const from = t.lastFrom.get(id);
      if (!placed || !from) return;
      mini.classList.add('in-flight');
      ghosts.push(mini);
      const to = rectOf(mini);
      const delay = 60 * n++;
      flights.push(flyAfter(t, placed.card, from, to, delay));
    });
  }
  t.laidEl.scrollTop = t.laidEl.scrollHeight;
  await pause(450);
  fx('lay.ringSweep');
  for (const gid of groupIds) {
    const group = t.laidEl.querySelector<HTMLElement>(`[data-group-id="${gid}"]`);
    if (group) {
      const ring = h('i.ring-sweep');
      group.append(ring);
      void animate(ring, [{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, offset: 0.4 }, { opacity: 0, transform: 'scale(1.1)' }], { ms: 450 }).then(() => ring.remove());
    }
  }
  await pause(100);
  // The hit-stop: everything holds still for a beat at the peak.
  await pause(100);
  const cloth = center(rectOf(t.clothEl));
  fx('lay.burst');
  burst(cloth.x, cloth.y, 40, ['petal', 'gold', 'sparkle'], 190);
  fx('lay.flash');
  const flash = h('div.screen-flash');
  t.fxEl.append(flash);
  void animate(flash, [{ opacity: 0 }, { opacity: 0.2, offset: 0.2 }, { opacity: 0 }], { ms: 340, ease: 'ease-out' }).then(() => flash.remove());
  fx('lay.banner');
  const bn = banner(t, `Phase ${phase} complete!`);
  await pause(170);
  await Promise.all(flights);
  ghosts.forEach((g) => g.classList.remove('in-flight'));
  fx('lay.trackFill');
  t.renderPanel();
  const seg = t.panelEl.querySelector<HTMLElement>(`.track [data-p="${phase}"]`);
  if (seg) {
    seg.classList.add('done', 'filling');
    seg.classList.remove('now');
    void animate(seg, [{ transform: 'scaleX(.2)', opacity: 0.4 }, { transform: 'scaleX(1)', opacity: 1 }], { ms: 320, ease: SPRING });
  }
  fx('lay.coinFlip');
  sfx('phaseAdvance');
  if (t.medal) void animate(t.medal, [{ transform: 'rotateY(0)' }, { transform: 'rotateY(360deg)' }], { ms: 560, ease: 'ease-in-out', fill: 'none' });
  await pause(600);
  fx('lay.settle');
  await animate(bn, [{ transform: 'translateX(-50%) scale(1)', opacity: 1 }, { transform: 'translateX(-50%) scale(1)', opacity: 0 }], { ms: 220 });
  bn.remove();
  t.render();
}

async function flyAfter(t: Table, card: Card, from: Box, to: Box, delay: number): Promise<void> {
  await pause(delay);
  await flyCard(t, card, from, to, false, 300, 0, true);
  const mini = t.laidEl.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
  mini?.classList.remove('in-flight');
}

/** A smaller version when someone else lays down. */
export async function otherLayDownMoment(t: Table, seat: number, groupIds: number[]): Promise<void> {
  fx('lay.botLay');
  sfx('oppLayDown');
  t.renderChips();
  t.renderLaid();
  const chip = rectOf(t.chips[seat]);
  const from: Box = { left: chip.left + chip.width / 2 - 10, top: chip.top + chip.height / 2 - 14, width: 20, height: 28 };
  const flights: Promise<void>[] = [];
  let n = 0;
  for (const gid of groupIds) {
    const placed = t.game.groups.find((g) => g.id === gid);
    placed?.cards.forEach((p) => {
      const mini = t.laidEl.querySelector<HTMLElement>(`[data-card-id="${p.card.id}"]`);
      if (!mini) return;
      mini.classList.add('in-flight');
      flights.push(flyAfter(t, p.card, from, rectOf(mini), 26 * n++));
    });
  }
  await Promise.all(flights);
  const row = t.laidEl.querySelector<HTMLElement>(`.laid-row[data-seat="${seat}"]`);
  if (row) {
    row.scrollIntoView({ block: 'nearest' });
    const c = center(rectOf(row));
    burst(c.x, c.y, 15, ['sparkle', 'gold'], 70);
  }
}

export async function hitMoment(t: Table, seat: number, card: Card, groupId: number): Promise<void> {
  fx(seat === 0 ? 'hit.human' : 'hit.bot');
  sfx('hit', seat === 0 ? {} : { quiet: 0.7 });
  const saved = t.lastFrom.get(card.id);
  t.renderHand();
  t.renderChips();
  t.renderLaid();
  const group = t.laidEl.querySelector<HTMLElement>(`[data-group-id="${groupId}"]`);
  const mini = t.laidEl.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
  if (!group || !mini) return;
  group.scrollIntoView({ block: 'nearest' });
  mini.classList.add('in-flight');
  const to = rectOf(mini);
  let from: Box;
  if (seat === 0 && saved) from = saved;
  else {
    const c = rectOf(t.chips[seat]);
    from = { left: c.left + c.width / 2 - 14, top: c.top + c.height / 2 - 20, width: 28, height: 40 };
  }
  await flyCard(t, card, from, to, false, seat === 0 ? 260 : 200, 0, true);
  mini.classList.remove('in-flight');
  void animate(group, [{ transform: 'scale(1)' }, { transform: `scale(${seat === 0 ? 1.06 : 1.03})`, offset: 0.4 }, { transform: 'scale(1)' }], { ms: 240, ease: 'ease-out', fill: 'none' });
  const c = center(rectOf(group));
  burst(c.x, c.y, seat === 0 ? 9 : 4, ['sparkle', 'gold'], seat === 0 ? 50 : 30);
}

/** A big hourglass, a lavender wash, and a shake. */
export async function skipOnHerMoment(t: Table): Promise<void> {
  fx('skip.onHer');
  sfx('skipOnHer');
  const tint = h('div.tint');
  t.fxEl.append(tint);
  void animate(tint, [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 1, offset: 0.73 }, { opacity: 0 }], { ms: 1100, ease: 'linear' }).then(() => tint.remove());
  const glass = hourglassEl('big');
  t.fxEl.append(glass);
  void animate(glass, [
    { transform: 'translate(-50%,-160%) rotate(0)', opacity: 0 },
    { transform: 'translate(-50%,-50%) rotate(0)', opacity: 1, offset: 0.3 },
    { transform: 'translate(-50%,-50%) rotate(180deg)', opacity: 1, offset: 0.7 },
    { transform: 'translate(-50%,-50%) rotate(180deg)', opacity: 0 },
  ], { ms: 1100, ease: 'ease-in-out' }).then(() => glass.remove());
  if (!motion.reduced) {
    fx('skip.shake');
    void shake(t.root, 4, 200, 3);
  }
  const hr = rectOf(t.handEl);
  const host = rectOf(t.fxEl);
  const text = h('div.skip-text', { style: `top:${hr.top - host.top + hr.height * 0.25}px` }, 'Skipped!');
  t.fxEl.append(text);
  void animate(text, [
    { transform: 'translateX(-50%) scale(.5)', opacity: 0 },
    { transform: 'translateX(-50%) scale(1.1)', opacity: 1, offset: 0.2 },
    { transform: 'translateX(-50%) scale(1)', opacity: 1, offset: 0.8 },
    { transform: 'translateX(-50%) scale(1)', opacity: 0 },
  ], { ms: 1100 }).then(() => text.remove());
  t.handEl.classList.add('dim');
  await pause(1100);
}

/** The hourglass flies to the target's chip, which frosts over. */
export async function skipOnBotMoment(t: Table, target: number): Promise<void> {
  fx('skip.onBot');
  sfx('skipPlayed');
  const from = center(rectOf(t.discardEl));
  const to = center(rectOf(t.chips[target]));
  const host = rectOf(t.fxEl);
  const glass = hourglassEl();
  glass.style.left = `${from.x - host.left}px`;
  glass.style.top = `${from.y - host.top}px`;
  t.fxEl.append(glass);
  await animate(glass, [
    { transform: 'translate(-50%,-50%) scale(.8) rotate(0)', opacity: 1 },
    { transform: `translate(calc(-50% + ${(to.x - from.x) / 2}px),calc(-50% + ${(to.y - from.y) / 2 - 16}px)) scale(1.3) rotate(180deg)`, opacity: 1, offset: 0.5 },
    { transform: `translate(calc(-50% + ${to.x - from.x}px),calc(-50% + ${to.y - from.y}px)) scale(.8) rotate(360deg)`, opacity: 0.9 },
  ], { ms: 380, ease: 'ease-in-out' });
  glass.remove();
  fx('skip.frost');
  t.renderChips();
  const chip = t.chips[target];
  chip.classList.add('frost');
  burst(to.x, to.y, motion.reduced ? 3 : 8, ['sparkle'], 40);
  setTimeout(() => chip.classList.remove('frost'), 600);
}

function stamp(t: Table, near: DOMRect | null, big: boolean): Promise<void> {
  const host = rectOf(t.fxEl);
  const c = near ? center(near) : center(rectOf(t.clothEl));
  const el = h(`div.stamp${big ? '.big' : ''}`, { 'data-testid': 'out-stamp', style: `left:${c.x - host.left}px;top:${c.y - host.top}px` }, 'Out!');
  t.fxEl.append(el);
  return animate(el, [
    { transform: `translate(-50%,-50%) scale(${big ? 1.6 : 1.3})`, opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.25 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.85 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 },
  ], { ms: big ? 1500 : 900, ease: 'ease-in' }).then(() => el.remove());
}

export async function outMoment(t: Table, seat: number, _by: string): Promise<void> {
  if (seat === 0) {
    fx('out.human');
    sfx('goOutHer');
    t.render();
    void stamp(t, null, true);
    await pause(240);
    if (!motion.reduced) {
      fx('out.shake');
      void shake(t.root, 6, 200, 3);
    }
    fx('out.confetti');
    confetti(1500);
    await pause(1300);
  } else {
    fx('out.bot');
    sfx('goOutBot');
    t.render();
    await stamp(t, rectOf(t.chips[seat]), false);
  }
}

export async function reshuffleMoment(t: Table): Promise<void> {
  fx('ui.reshuffle');
  sfx('reshuffle');
  const from = rectOf(t.discardEl);
  const to = rectOf(t.drawEl);
  const shots: Promise<void>[] = [];
  for (let i = 0; i < 8; i++) {
    const b = backEl(t.match.back);
    b.classList.add('flyer');
    const host = rectOf(t.fxEl);
    b.style.cssText += `left:${from.left - host.left}px;top:${from.top - host.top}px;width:${from.width}px;height:${from.height}px`;
    t.fxEl.append(b);
    shots.push(animate(b, [
      { transform: 'translate(0,0) rotate(0)' },
      { transform: `translate(${(to.left - from.left) / 2}px,${-t.rem * 3}px) rotate(${i % 2 ? 10 : -10}deg)`, offset: 0.5 },
      { transform: `translate(${to.left - from.left}px,0) rotate(0)` },
    ], { ms: 380, delay: i * 45, ease: 'ease-in-out' }).then(() => b.remove()));
  }
  const note = h('div.note-pop', { 'data-testid': 'reshuffled' }, 'Reshuffled');
  t.fxEl.append(note);
  note.style.left = `${to.left - rectOf(t.fxEl).left + to.width / 2}px`;
  note.style.top = `${to.top - rectOf(t.fxEl).top - t.rem * 1.2}px`;
  void animate(note, [{ opacity: 0, transform: 'translateX(-50%) scale(.7)' }, { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.2 }, { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.8 }, { opacity: 0, transform: 'translateX(-50%) scale(1)' }], { ms: 900 }).then(() => note.remove());
  await Promise.all(shots);
  t.renderPiles();
}

/** Every hand flips up, the points tick in, and medallions turn over for those who advance. */
export async function roundEndMoment(t: Table, result: RoundResult): Promise<void> {
  t.render();
  fx('round.flipHands');
  const overlay = h('div.tally', { 'data-testid': 'tally' });
  t.fxEl.append(overlay);
  overlay.classList.add('interactive');
  const skip = () => { skipping = true; };
  let skipping = false;
  overlay.addEventListener('pointerdown', skip);
  void animate(overlay, [{ opacity: 0 }, { opacity: 1 }], { ms: 180 });
  const rows = result.hands.map((hand, seat) => {
    const name = seat === 0 ? 'You' : BOTS[t.match.lineup[seat - 1]].name;
    const counter = h('b.tally-count', null, '0');
    const cards = h('div.tally-cards');
    const medal = h('span.medallion.tiny', null, h('span', null, result.phasesBefore[seat] ?? ''));
    const row = h('div.tally-row', { 'data-seat': seat },
      seat === 0 ? h('div.portrait.p-small.you', null, h('span', null, 'You')) : portraitEl(t.match.lineup[seat - 1], 'small'),
      h('div.tally-main', null, h('b.tally-name', null, name), cards),
      medal,
      counter,
    );
    overlay.append(row);
    const els = hand.map((c, i) => {
      const flip = backEl(t.match.back, true);
      cards.append(flip);
      return { flip, c, i };
    });
    return { seat, counter, els, medal };
  });
  await Promise.all(rows.flatMap((r) => r.els.map(async ({ flip, c, i }) => {
    await pause(i * 34);
    const face = cardEl(c, true);
    await animate(flip, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { ms: 80, ease: 'ease-in' });
    flip.replaceWith(face);
    await animate(face, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { ms: 90, ease: 'ease-out', fill: 'none' });
  })));
  fx('round.tally');
  for (const r of rows) {
    let total = 0;
    let tick = 0;
    for (const { c } of r.els) {
      total += cardPoints(c);
      if (!skipping) {
        sfx('tally', { step: tick * 0.5 });
        tick++;
        r.counter.textContent = String(total);
        const shown = r.counter.parentElement!.querySelectorAll('.tally-cards .card')[tick - 1];
        if (shown) void animate(shown, [{ transform: 'scale(1)' }, { transform: 'scale(1.25)', offset: 0.4 }, { transform: 'scale(1)' }], { ms: 120, fill: 'none' });
        await pause(60);
      }
    }
    r.counter.textContent = String(total);
  }
  fx('round.medallionFlip');
  for (const r of rows) {
    if (!result.advanced[r.seat]) continue;
    const before = result.phasesBefore[r.seat];
    sfx('phaseAdvance', { step: r.seat, quiet: 0.7 });
    void animate(r.medal, [{ transform: 'rotateY(0)' }, { transform: 'rotateY(360deg)' }], { ms: 420, fill: 'none' });
    const span = r.medal.querySelector('span');
    await pause(210);
    if (span && before !== null) span.textContent = t.game.variant === 'choose' ? '✓' : String(before + 1);
    const c = center(rectOf(r.medal));
    burst(c.x, c.y, 6, ['sparkle'], 34);
  }
  await pause(skipping ? 120 : 600);
  overlay.remove();
  t.render();
}

