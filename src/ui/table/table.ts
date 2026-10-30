// The game table: drives the rules engine from taps and bot decisions, and keeps the screen in step.
import { decide, type BotId } from '../../bots/profiles.ts';
import { simpleUnseen, tally, evaluate, usedCards } from '../../bots/analysis.ts';
import { BOTS, LINES, type LineTrigger } from '../../content.ts';
import { eligibleSkipTargets, nextRound, step } from '../../engine/game.ts';
import { observe } from '../../engine/observation.ts';
import { PHASES, checkGroup, checkHit, findArrangement, groupLabel, phaseSequence, phaseText } from '../../engine/phases.ts';
import { createRng } from '../../engine/rng.ts';
import type { Action, Card, GameEvent, GameState, LaidGroup } from '../../engine/types.ts';
import { applyEvents, finishMatch, type MatchSummary } from '../../meta/progress.ts';
import type { SavedMatch } from '../../meta/save.ts';
import { app, persist, show } from '../app.ts';
import { backEl, candleSvg, cardEl, garlandSvg, icon, portraitEl, setExpression, teacupSvg, type Expression } from '../art.ts';
import { setTension, sfx } from '../audio/audio.ts';
import { clear, h, rectOf, wait } from '../dom.ts';
import { SPRING, animate, burst, center, fx, motion, pause, rollNumber, setFxLayer, setRate } from '../fx/motion.ts';
import { charmToast, closeAllSheets, confirmSheet, invalid, noteToast, openSheet, tooltip } from '../overlays.ts';
import { startAmbient, startBossAmbient } from './ambient.ts';
import { dealAnimation, hitMoment, layDownMoment, otherLayDownMoment, outMoment, reshuffleMoment, roundEndMoment, skipOnHerMoment, skipOnBotMoment } from './moments.ts';
import { bossDefeatMoment } from './boss.ts';
import { reviewSheet, historySheet, showRoundEnd, showMatchEnd } from '../screens/end.ts';
import { howToPlay } from '../screens/howto.ts';
import { settingsScreen } from '../screens/settings.ts';
import { journey } from '../screens/journey.ts';
import { Tutorial } from './tutorial.ts';

const SPEED: Record<string, [number, number]> = { relaxed: [1600, 2400], normal: [900, 1400], brisk: [400, 700] };
const IDLE_BREATH_MS = 3000;

export let activeTable: Table | null = null;

export class Table {
  match: SavedMatch;
  game: GameState;
  root!: HTMLElement;
  fxEl!: HTMLElement;
  chips: HTMLElement[] = [];
  portraits: HTMLElement[] = [];
  clothEl!: HTMLElement;
  ribbon!: HTMLElement;
  drawEl!: HTMLElement;
  drawCount!: HTMLElement;
  discardEl!: HTMLElement;
  laidEl!: HTMLElement;
  panelEl!: HTMLElement;
  handEl!: HTMLElement;
  primaryBtn!: HTMLButtonElement;
  discardBtn!: HTMLButtonElement;
  sortBtn!: HTMLButtonElement;
  pill!: HTMLElement;
  medal!: HTMLElement;
  bubbleEl: HTMLElement | null = null;
  handEls = new Map<number, HTMLElement>();
  selected: number[] = [];
  queue: Promise<unknown> = Promise.resolve();
  alive = true;
  animating = 0;
  ffUntilTurnEnd = false;
  handDimmed = false;
  layReadyShown = false;
  validSlots = new Set<number>();
  botDice: () => number;
  botBudget = 1000;
  lastActive = -1;
  lastTouch = Date.now();
  tutorial: Tutorial;
  /** Set while a celebration can be tapped through. */
  celebrating = false;
  ambientStop: (() => void) | null = null;
  autoHook: (() => void) | null = null;
  expressionTimers = new Map<number, number>();
  rem = 10;
  dragging: { id: number } | null = null;
  fresh: boolean;

  constructor(match: SavedMatch, fresh: boolean) {
    this.match = match;
    this.game = match.game;
    this.fresh = fresh;
    if (__DEV__ && match.botSeed) {
      const rng = createRng(match.botSeed, 0x626f74);
      this.botDice = () => rng.next() / 0x100000000;
    } else {
      this.botDice = Math.random;
    }
    this.tutorial = new Tutorial(this);
    activeTable = this;
  }

  /* ---------- Building the screen ---------- */

  mount(): HTMLElement {
    const m = this.match;
    const opponents = m.lineup.length;
    this.root = h('div.screen.table-screen', {
      'data-screen': 'table', 'data-cloth': m.boss ? 'midnight-garden' : m.cloth, 'data-back': m.back,
      class: `${m.boss ? 'boss' : ''} ${opponents === 1 ? 'duel' : ''} ${opponents > 3 ? 'crowded' : ''}`,
    });
    const garland = h('div.garland', { html: garlandSvg() });
    const menuBtn = h('button.round-btn', { 'aria-label': 'Menu', html: icon('menu'), onclick: () => this.pauseMenu(), 'data-testid': 'menu' });
    const eyeBtn = h('button.round-btn', { 'aria-label': 'Review last round', html: icon('eye'), onclick: () => this.reviewLast(), 'data-testid': 'review' });
    this.pill = h('div.pill', { 'data-testid': 'round-pill' });
    const topbar = h('div.topbar', null, menuBtn, this.pill, eyeBtn);

    const opps = h('div.opps', { 'data-testid': 'opponents' });
    m.lineup.forEach((bot, i) => {
      const seat = i + 1;
      const portrait = portraitEl(bot, 'small');
      this.portraits[seat] = portrait;
      const chip = h('div.chip', { 'data-seat': seat, 'data-bot': bot, 'data-testid': `chip-${seat}` },
        h('div.chip-main', null, portrait,
          h('div.chip-text', null,
            h('b.chip-name', null, BOTS[bot].name),
            h('span.chip-info', null, h('span.chip-phase'), ' · ', h('span.chip-count'), h('span.chip-cards')),
          ),
        ),
        h('div.chip-status'),
        h('i.chip-badge', { html: icon('hourglass') }),
      );
      chip.addEventListener('click', () => this.onTapAnywhere());
      this.chips[seat] = chip;
      opps.append(chip);
    });

    this.ribbon = h('div.ribbon', { 'data-testid': 'ribbon' });
    this.drawEl = h('button.pile.draw', { 'aria-label': 'Draw pile', 'data-testid': 'draw-pile' });
    this.drawCount = h('span.count');
    const drawStack = h('div.pile-wrap', null, this.drawEl, h('span.pile-label', null, 'Draw · ', this.drawCount));
    this.discardEl = h('button.pile.discard', { 'aria-label': 'Discard pile', 'data-testid': 'discard-pile' });
    const discardStack = h('div.pile-wrap', null, this.discardEl, h('span.pile-label', null, 'Discard'));
    this.laidEl = h('div.laid', { 'data-testid': 'laid' });
    this.clothEl = h('div.cloth', { 'data-testid': 'cloth' },
      h('div.stitch'),
      this.ribbon,
      h('div.table-row', null,
        h('div.decor.teacup', { html: teacupSvg() }),
        h('div.piles', null, drawStack, discardStack),
        h('div.decor.candle', { html: candleSvg() }),
      ),
      this.laidEl,
      h('i.rest-petal.a'), h('i.rest-petal.b'),
    );

    this.panelEl = h('div.panel', { 'data-testid': 'phase-panel' });
    this.handEl = h('div.hand', { 'data-testid': 'hand', 'aria-label': 'Your hand' });
    this.sortBtn = h('button.square-btn' as 'button', { 'aria-label': 'Sort: by number', html: icon('sort'), 'data-testid': 'sort' });
    this.primaryBtn = h('button.btn.primary.main-action' as 'button', { 'data-testid': 'primary' });
    this.discardBtn = h('button.btn.secondary.discard-btn' as 'button', { 'data-testid': 'discard-btn' }, 'Discard');
    const actions = h('div.actions', null, this.sortBtn, this.primaryBtn, this.discardBtn);
    this.fxEl = h('div.fx-layer');
    const vignette = h('div.vignette');

    this.root.append(garland, topbar, opps, this.clothEl, this.panelEl, this.handEl, actions, vignette, this.fxEl);
    setFxLayer(this.fxEl);
    this.bindInput();
    return this.root;
  }

  /** Starts or resumes play once the screen is on the page. */
  start(events: GameEvent[]): void {
    this.measure();
    this.ambientStop = startAmbient(this);
    if (this.match.boss) {
      const stop = startBossAmbient(this);
      const prev = this.ambientStop;
      this.ambientStop = () => { prev(); stop(); };
    }
    this.syncTension();
    this.render();
    const resize = () => { this.measure(); this.layoutHand(); };
    window.addEventListener('resize', resize);
    app.onLeave = () => {
      this.alive = false;
      activeTable = null;
      window.removeEventListener('resize', resize);
      this.cleanups.forEach((c) => c());
      this.ambientStop?.();
      setTension(false);
      setRate(1);
    };
    this.enqueue(async () => {
      if (events.length > 0) await this.play(events);
      await this.pump();
    });
  }

  measure(): void {
    this.rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  }

  busy = 0;

  enqueue(job: () => Promise<unknown> | void): Promise<void> {
    this.busy++;
    const run = this.queue.then(() => (this.alive ? job() : undefined)).catch((err) => { console.error(err); }).finally(() => { this.busy--; });
    this.queue = run;
    return run.then(() => undefined);
  }

  /* ---------- Reading the state ---------- */

  get me() { return this.game.players[0]; }
  get myTurn() { return this.game.current === 0 && (this.game.stage === 'draw' || this.game.stage === 'play'); }

  cardById(id: number): Card | undefined {
    return this.me.hand.find((c) => c.id === id);
  }

  slotIds(): Set<number> {
    return new Set(this.match.ui.slots.flat());
  }

  /** The cards in the fan, in display order. */
  displayIds(): number[] {
    const inSlot = this.slotIds();
    const hand = this.me.hand.filter((c) => !inSlot.has(c.id));
    const sort = this.match.ui.sort;
    const rank = (c: Card) => (c.kind === 'wild' ? 100 : c.kind === 'skip' ? 200 : 0);
    const SUIT_ORDER = { rose: 0, moss: 1, moonstone: 2, honey: 3 };
    if (sort === 'number') {
      hand.sort((a, b) => rank(a) - rank(b) || (a.kind === 'num' && b.kind === 'num' ? a.num - b.num || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] : a.id - b.id));
    } else if (sort === 'color') {
      hand.sort((a, b) => rank(a) - rank(b) || (a.kind === 'num' && b.kind === 'num' ? SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || a.num - b.num : a.id - b.id));
    } else {
      const order = this.match.ui.order;
      const pos = (c: Card) => { const i = order.indexOf(c.id); return i < 0 ? 1e6 + c.id : i; };
      hand.sort((a, b) => pos(a) - pos(b));
    }
    return hand.map((c) => c.id);
  }

  hitTargets(card: Card): LaidGroup[] {
    return this.game.groups.filter((g) => checkHit(g, card).ok);
  }

  /** The cards worth a shimmer: those in the best partial grouping for her phase. Her own hand only. */
  hintIds(): Set<number> {
    if (!app.save.settings.hints || this.me.laidDown || this.me.phase === null) return new Set();
    const inSlot = this.slotIds();
    const hand = this.me.hand;
    const ev = evaluate(tally(hand), this.me.phase, simpleUnseen(hand));
    const used = usedCards(hand, ev.picks);
    for (const id of inSlot) used.delete(id);
    return used;
  }

  slotChecks() {
    const phase = this.me.phase;
    if (phase === null) return [];
    return PHASES[phase].map((req, i) => {
      const cards = this.match.ui.slots[i].map((id) => this.cardById(id)!).filter(Boolean);
      return { req, cards, check: checkGroup(req, cards) };
    });
  }

  allSlotsReady(): boolean {
    const checks = this.slotChecks();
    return checks.length > 0 && checks.every((c) => c.check.ok);
  }

  /* ---------- Rendering ---------- */

  render(): void {
    if (!this.alive) return;
    const g = this.game;
    this.pill.innerHTML = '';
    const pts = h('span.pts');
    this.pill.append(h('span', null, `Round ${g.round}`), h('i.dot'), pts, h('span', null, ' pts'));
    pts.dataset.value = String(this.prevPts ?? this.me.score);
    pts.textContent = String(this.prevPts ?? this.me.score);
    rollNumber(pts, this.me.score);
    this.prevPts = this.me.score;
    this.renderChips();
    this.renderPiles();
    this.renderLaid();
    this.renderPanel();
    this.renderHand();
    this.renderActions();
  }

  prevPts: number | null = null;

  renderChips(): void {
    this.match.lineup.forEach((_, i) => {
      const seat = i + 1;
      const p = this.game.players[seat];
      const chip = this.chips[seat];
      chip.querySelector('.chip-phase')!.textContent = p.phase === null ? 'Choosing' : `Phase ${p.phase}`;
      rollNumber(chip.querySelector('.chip-count') as HTMLElement, p.hand.length);
      chip.querySelector('.chip-cards')!.textContent = p.hand.length === 1 ? ' card' : ' cards';
      const active = this.game.current === seat && (this.game.stage === 'draw' || this.game.stage === 'play');
      chip.classList.toggle('active', active);
      chip.classList.toggle('skipped', p.pendingSkip);
      chip.classList.toggle('down', p.laidDown);
      const status = chip.querySelector('.chip-status') as HTMLElement;
      const key = active ? 'thinking' : p.pendingSkip ? 'skipped' : p.laidDown ? 'laid' : 'none';
      if (status.dataset.key !== key) {
        status.dataset.key = key;
        status.className = `chip-status st-${key}`;
        clear(status);
        if (key === 'thinking') {
          status.setAttribute('aria-label', 'Thinking');
          status.append(h('span', null, 'Thinking'), h('i.dots', null, h('i'), h('i'), h('i')));
          fx('ui.botThinking');
        } else if (key === 'skipped') {
          status.innerHTML = `${icon('hourglass')}<span>Skipped</span>`;
        } else if (key === 'laid') {
          status.innerHTML = `${icon('check')}<span>Laid down</span>`;
        }
      }
    });
    const nextActive = this.game.current;
    if (this.lastActive !== nextActive && (this.game.stage === 'draw' || this.game.stage === 'play')) {
      if (this.lastActive >= 0) this.turnGlow(this.lastActive, nextActive);
      this.lastActive = nextActive;
    }
  }

  seatAnchor(seat: number): DOMRect {
    return seat === 0 ? rectOf(this.handEl) : rectOf(this.chips[seat]);
  }

  turnGlow(from: number, to: number): void {
    fx('ui.turnGlow');
    const a = center(this.seatAnchor(from));
    const b = center(this.seatAnchor(to));
    const host = rectOf(this.fxEl);
    const glow = h('div.turn-glow', { style: `left:${a.x - host.left}px;top:${a.y - host.top}px` });
    this.fxEl.append(glow);
    void animate(glow, [
      { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 0.9, offset: 0.25 },
      { transform: `translate(calc(-50% + ${b.x - a.x}px),calc(-50% + ${b.y - a.y}px)) scale(.9)`, opacity: 0 },
    ], { ms: 300, ease: 'ease-in-out' }).then(() => glow.remove());
  }

  discardRotation(id: number): number {
    return ((id * 37) % 13) - 6;
  }

  renderPiles(): void {
    const g = this.game;
    rollNumber(this.drawCount, g.drawPile.length);
    if (this.drawEl.dataset.ready !== '1' || this.drawEl.dataset.count !== String(Math.min(g.drawPile.length, 3))) {
      clear(this.drawEl);
      const layers = Math.min(g.drawPile.length, 3);
      for (let i = 0; i < layers; i++) {
        const b = backEl(this.match.back);
        b.style.transform = `translate(${(layers - 1 - i) * -1.5}px,${(layers - 1 - i) * 1.5}px)`;
        this.drawEl.append(b);
      }
      this.drawEl.dataset.ready = '1';
      this.drawEl.dataset.count = String(layers);
    }
    const pile = g.discardPile;
    const topCard = pile[pile.length - 1];
    const topId = topCard ? String(topCard.id) : '';
    if (this.discardEl.dataset.top !== topId || this.discardEl.dataset.size !== String(Math.min(pile.length, 2))) {
      clear(this.discardEl);
      if (pile.length > 1) {
        const under = cardEl(pile[pile.length - 2]);
        under.style.transform = `rotate(${this.discardRotation(pile[pile.length - 2].id)}deg)`;
        under.classList.add('under');
        this.discardEl.append(under);
      }
      if (topCard) {
        const el = cardEl(topCard);
        el.style.transform = `rotate(${this.discardRotation(topCard.id)}deg)`;
        this.discardEl.append(el);
      }
      this.discardEl.dataset.top = topId;
      this.discardEl.dataset.size = String(Math.min(pile.length, 2));
    }
    const drawing = this.myTurn && g.stage === 'draw';
    const canTake = drawing && !!topCard && topCard.kind !== 'skip';
    this.drawEl.classList.toggle('invite', drawing && g.drawPile.length > 0);
    this.discardEl.classList.toggle('invite', canTake);
    if (drawing) fx('ambient.pileInvite');
    this.discardEl.setAttribute('aria-label', topCard ? `Discard pile, top card ${cardEl(topCard).getAttribute('aria-label')}` : 'Discard pile');
  }

  renderLaid(): void {
    const g = this.game;
    const signature = g.groups.map((x) => `${x.id}:${x.owner}:${x.cards.map((c) => c.card.id).join(',')}`).join('|');
    if (this.laidEl.dataset.sig === signature) { this.refreshHitGlow(); return; }
    const oldRects = new Map<string, DOMRect>();
    this.laidEl.querySelectorAll<HTMLElement>('.card').forEach((c) => oldRects.set(c.dataset.cardId!, rectOf(c)));
    const scroll = this.laidEl.scrollTop;
    clear(this.laidEl);
    this.laidEl.dataset.sig = signature;
    for (let seat = 0; seat < g.playerCount; seat++) {
      const groups = g.groups.filter((x) => x.owner === seat);
      if (groups.length === 0) continue;
      const p = g.players[seat];
      const name = seat === 0 ? 'Your' : `${BOTS[this.match.lineup[seat - 1]].name}'s`;
      const row = h('div.laid-row', { 'data-seat': seat },
        h('span.laid-label', null, `${name} Phase ${p.phase}`),
        h('div.laid-groups', null, groups.map((x) => this.groupEl(x))),
      );
      this.laidEl.append(row);
    }
    this.laidEl.scrollTop = scroll;
    if (oldRects.size > 0 && !motion.reduced) {
      this.laidEl.querySelectorAll<HTMLElement>('.card').forEach((c) => {
        const before = oldRects.get(c.dataset.cardId!);
        if (!before) return;
        const now = rectOf(c);
        const dx = before.left - now.left;
        const dy = before.top - now.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          void animate(c, [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { ms: 300, ease: SPRING, fill: 'backwards' });
        }
      });
    }
    this.refreshHitGlow();
  }

  groupEl(g: LaidGroup): HTMLElement {
    const el = h('button.group', {
      'data-group-id': g.id, 'data-testid': `group-${g.id}`,
      'aria-label': `${g.type === 'set' ? `Set of ${g.num}s` : g.type === 'run' ? `Run from ${g.cards[0].num} to ${g.cards[g.cards.length - 1].num}` : `${g.suit} Color group`}, ${g.cards.length} cards`,
      class: `${g.type === 'run' && g.cards.length > 5 ? 'long' : ''} t-${g.type}`,
    });
    for (const p of g.cards) el.append(cardEl(p.card, true));
    el.addEventListener('click', (e) => this.onGroupTap(g.id, e as MouseEvent));
    return el;
  }

  renderPanel(): void {
    const me = this.me;
    const seq = phaseSequence(this.game.variant);
    const phase = me.phase;
    const panel = this.panelEl;
    const sig = `${phase}|${me.laidDown}|${me.completed.join(',')}`;
    if (panel.dataset.sig !== sig) {
      panel.dataset.sig = sig;
      clear(panel);
      this.medal = h('div.medallion', { 'data-testid': 'medallion', 'aria-label': phase === null ? 'Choosing a phase' : `Phase ${phase}` }, h('span', null, phase ?? '?'));
      const track = h('div.track', { 'aria-hidden': 'true' });
      for (const p of seq) {
        track.append(h('i', { class: me.completed.includes(p) ? 'done' : p === phase ? 'now' : '', 'data-p': p }));
      }
      const text = h('div.panel-text', null,
        h('b.req', { 'data-testid': 'requirement' }, phase === null ? 'Choose your phase' : phaseText(phase)),
        track,
      );
      const suggest = h('button.chip-btn.suggest', { 'data-testid': 'suggest', onclick: () => this.suggest() }, 'Suggest');
      const head = h('div.panel-head', null, this.medal, text, !me.laidDown && app.save.settings.hints ? suggest : null);
      panel.append(head);
      if (phase !== null && !me.laidDown) {
        const slots = h('div.slots', { class: PHASES[phase].length === 1 ? 'single' : '' });
        PHASES[phase].forEach((req, i) => {
          const slot = h('button.slot', { 'data-slot': i, 'data-testid': `slot-${i}`, 'aria-label': groupLabel(req) },
            h('div.slot-cards'),
            h('div.slot-status'),
          );
          slot.addEventListener('click', () => this.onSlotTap(i));
          slots.append(slot);
        });
        panel.append(slots);
      } else if (phase !== null) {
        panel.append(h('div.panel-done', { html: `${icon('check')}<span>Phase ${phase} is down</span>` }));
      }
    }
    if (phase === null || me.laidDown) return;
    this.slotChecks().forEach(({ req, cards, check }, i) => {
      const slot = panel.querySelector<HTMLElement>(`[data-slot="${i}"]`);
      if (!slot) return;
      const holder = slot.querySelector('.slot-cards') as HTMLElement;
      const key = cards.map((c) => c.id).join(',');
      if (holder.dataset.key !== key) {
        holder.dataset.key = key;
        clear(holder);
        holder.classList.toggle('crowded', cards.length > 4);
        cards.forEach((c) => holder.append(cardEl(c, true)));
      }
      const status = slot.querySelector('.slot-status') as HTMLElement;
      const nowValid = check.ok;
      slot.classList.toggle('ready', nowValid);
      slot.classList.toggle('bad', !check.ok && !check.partial);
      if (check.ok) status.innerHTML = `${icon('check')}<span>Ready</span>`;
      else if (check.partial) status.textContent = cards.length === 0 ? groupLabel(req) : `${cards.length}/${req.size}`;
      else status.textContent = check.reason;
      if (nowValid && !this.validSlots.has(i)) {
        this.validSlots.add(i);
        fx('group.slotValid');
        sfx('slotValid', { step: this.validSlots.size - 1 });
        slot.classList.remove('flash');
        void slot.offsetWidth;
        slot.classList.add('flash');
        const mark = status.querySelector('.icon');
        if (mark) void animate(mark, [{ transform: 'scale(0)' }, { transform: 'scale(1.3)', offset: 0.7 }, { transform: 'scale(1)' }], { ms: 260, ease: 'ease-out' });
      } else if (!nowValid) {
        this.validSlots.delete(i);
      }
    });
  }

  renderHand(): void {
    const ids = this.displayIds();
    const seen = new Set(ids);
    for (const [id, el] of this.handEls) {
      if (!seen.has(id)) { el.remove(); this.handEls.delete(id); }
    }
    const hints = this.hintIds();
    for (const id of ids) {
      let el = this.handEls.get(id);
      if (!el) {
        const card = this.cardById(id)!;
        el = h('div.hc', { 'data-id': id }, cardEl(card));
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', cardEl(card).getAttribute('aria-label')!);
        el.dataset.testid = 'hand-card';
        this.handEls.set(id, el);
        this.handEl.append(el);
      }
      el.classList.toggle('hinted', hints.has(id));
      el.classList.toggle('selected', this.selected.includes(id));
    }
    this.selected = this.selected.filter((id) => seen.has(id));
    this.handEl.classList.toggle('dim', this.handDimmed);
    this.layoutHand(ids);
  }

  fanMetrics(n: number) {
    const compact = matchMedia('(max-height: 749px)').matches;
    const cw = this.rem * (compact ? 5.28 : 6);
    const width = this.handEl.clientWidth || this.rem * 39;
    const room = (width - cw - this.rem * 3.6) / Math.max(1, n - 1);
    return { stepX: Math.min(cw * 0.72, room), cw };
  }

  /** Where a card sits in the fan, as an offset from the fan's bottom center. */
  fanSpot(i: number, n: number): { x: number; y: number; r: number } {
    const { stepX } = this.fanMetrics(n);
    const d = i - (n - 1) / 2;
    return { x: d * stepX, y: d * d * this.rem * 0.12, r: d * 3 };
  }

  layoutHand(ids = this.displayIds(), gapAt = -1): void {
    const n = ids.length + (gapAt >= 0 ? 1 : 0);
    ids.forEach((id, index) => {
      const i = gapAt >= 0 && index >= gapAt ? index + 1 : index;
      const el = this.handEls.get(id);
      if (!el || el.classList.contains('dragging')) return;
      const spot = this.fanSpot(i, n);
      const lift = el.classList.contains('selected') ? -this.rem * 2.4 : 0;
      el.style.setProperty('--i', String(index));
      el.style.zIndex = String(index + 1);
      el.style.transform = `translate(${spot.x}px,${spot.y + lift}px) rotate(${spot.r}deg)`;
    });
  }

  reflow(): void {
    fx('hand.reflow');
    this.layoutHand();
  }

  ribbonText(): string {
    const g = this.game;
    if (g.stage === 'draw') return 'Your turn — draw a card';
    if (!this.me.laidDown) return 'Your turn — lay down or discard';
    const canHit = this.me.hand.some((c) => this.hitTargets(c).length > 0);
    return canHit ? 'Your turn — hit or discard' : 'Your turn — discard to end your turn';
  }

  renderActions(): void {
    const g = this.game;
    const my = this.myTurn;
    const me = this.me;
    this.ribbon.classList.toggle('show', my);
    if (my) this.ribbon.textContent = this.ribbonText();
    const sel = this.selected.length === 1 ? this.cardById(this.selected[0]) : undefined;
    let label: string;
    let active = false;
    let mode: 'lay' | 'hit' | 'discard' = 'lay';
    if (me.laidDown) {
      const hittable = sel ? this.hitTargets(sel).length > 0 : me.hand.some((c) => this.hitTargets(c).length > 0);
      if (hittable) { label = 'Hit'; mode = 'hit'; active = my && g.stage === 'play' && !!sel; }
      else { label = 'Discard'; mode = 'discard'; active = my && g.stage === 'play' && !!sel; }
    } else {
      label = me.phase === null ? 'Lay down' : `Lay down Phase ${me.phase}`;
      active = my && g.stage === 'play' && this.allSlotsReady();
    }
    this.primaryBtn.dataset.mode = mode;
    if (this.primaryBtn.textContent !== label) {
      this.primaryBtn.textContent = '';
      this.primaryBtn.append(h('span', null, label));
    }
    this.primaryBtn.setAttribute('aria-label', label);
    this.primaryBtn.classList.toggle('inactive', !active);
    this.discardBtn.classList.toggle('inactive', !(my && g.stage === 'play' && this.selected.length === 1));
    const ready = mode === 'lay' && active;
    this.primaryBtn.classList.toggle('ignited', ready);
    if (ready && !this.layReadyShown) {
      this.layReadyShown = true;
      fx('group.layReady');
      sfx('layReady');
      const ring = h('i.ring-out');
      this.primaryBtn.append(ring);
      void animate(ring, [{ transform: 'scale(1)', opacity: 0.9 }, { transform: 'scale(1.35,1.9)', opacity: 0 }], { ms: 620, ease: 'ease-out' }).then(() => ring.remove());
      this.orbit();
    }
    if (!ready) {
      this.layReadyShown = false;
      this.primaryBtn.querySelectorAll('.orbit').forEach((o) => o.remove());
    }
    this.sortBtn.setAttribute('aria-label', `Sort: ${this.match.ui.sort === 'number' ? 'by number' : this.match.ui.sort === 'color' ? 'by color' : 'custom'}`);
    this.sortBtn.dataset.sort = this.match.ui.sort;
    this.refreshHitGlow();
    this.tutorial.check();
  }

  orbit(): void {
    if (motion.reduced) return;
    for (let i = 0; i < 3; i++) {
      this.primaryBtn.append(h('i.orbit', { style: `--o:${i}`, html: icon('sparkle') }));
    }
  }

  refreshHitGlow(): void {
    const sel = this.selected.length === 1 ? this.cardById(this.selected[0]) : undefined;
    const showing = !!sel && this.me.laidDown && this.myTurn && this.game.stage === 'play';
    const targets = new Set(showing && sel ? this.hitTargets(sel).map((g) => g.id) : []);
    this.laidEl.querySelectorAll<HTMLElement>('.group').forEach((el) => {
      el.classList.toggle('can-hit', targets.has(Number(el.dataset.groupId)));
    });
  }

  /* ---------- Input ---------- */

  bindInput(): void {
    this.sortBtn.addEventListener('click', () => this.cycleSort());
    this.primaryBtn.addEventListener('click', () => this.onPrimary());
    this.discardBtn.addEventListener('click', () => this.onDiscardButton());
    this.bindPile(this.drawEl, 'pile');
    this.bindPile(this.discardEl, 'discard');
    this.bindHandDrag();
    this.root.addEventListener('pointerdown', () => this.onTapAnywhere());
  }

  /** Tapping during a bot turn speeds it up, without skipping what it shows. */
  onTapAnywhere(): void {
    this.lastTouch = Date.now();
    this.stopBreathing();
    if (this.game.current !== 0 && this.animatingBot && !this.ffUntilTurnEnd) {
      this.ffUntilTurnEnd = true;
      setRate(2.5);
    }
  }

  animatingBot = false;
  breathing: Animation | null = null;

  stopBreathing(): void {
    this.breathing?.cancel();
    this.breathing = null;
  }

  bindPile(pile: HTMLElement, source: 'pile' | 'discard'): void {
    let down: { x: number; y: number; id: number; time: number; moved: boolean; ghost: HTMLElement | null; held: boolean } | null = null;
    let holdTimer = 0;
    pile.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, id: e.pointerId, time: Date.now(), moved: false, ghost: null, held: false };
      if (source === 'discard') {
        holdTimer = window.setTimeout(() => {
          if (down && !down.moved) { down.held = true; historySheet(this); }
        }, 420);
      }
    });
    const move = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) > 10) {
        down.moved = true;
        clearTimeout(holdTimer);
        if (this.myTurn && this.game.stage === 'draw') {
          const r = rectOf(pile);
          const top = source === 'discard' ? this.game.discardPile[this.game.discardPile.length - 1] : null;
          const ghost = top && top.kind !== 'skip' ? cardEl(top) : backEl(this.match.back);
          const host = rectOf(this.fxEl);
          ghost.classList.add('flyer', 'drag-ghost');
          ghost.style.cssText += `left:${r.left - host.left}px;top:${r.top - host.top}px;width:${r.width}px;height:${r.height}px`;
          this.fxEl.append(ghost);
          down.ghost = ghost;
          fx('card.drag');
          sfx('dragStart');
        }
      }
      if (down.ghost) {
        const tilt = Math.max(-8, Math.min(8, dx * 0.06));
        down.ghost.style.transform = `translate(${dx}px,${dy}px) scale(1.12) rotate(${tilt}deg)`;
      }
    };
    const up = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      clearTimeout(holdTimer);
      const d = down;
      down = null;
      if (d.ghost) {
        d.ghost.remove();
        const hr = rectOf(this.handEl);
        if (e.clientY > hr.top - this.rem * 2) this.tryDraw(source, pile);
        return;
      }
      if (d.held || d.moved) return;
      this.tryDraw(source, pile);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', () => { down?.ghost?.remove(); down = null; clearTimeout(holdTimer); });
    this.cleanups.push(() => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); });
    pile.addEventListener('click', (e) => {
      if ((e as MouseEvent).detail === 0) this.tryDraw(source, pile);
    });
  }

  cleanups: (() => void)[] = [];

  tryDraw(source: 'pile' | 'discard', pile: HTMLElement): void {
    this.enqueue(async () => {
      if (!this.myTurn) {
        // On her opponent's turn a tap on the discard pile is not an error; it does nothing.
        return;
      }
      if (this.game.stage !== 'draw') {
        if (source === 'discard') invalid(pile, 'You already drew this turn.');
        else invalid(pile, 'You already drew this turn.');
        return;
      }
      await this.doAction({ type: 'draw', source }, pile);
    });
  }

  bindHandDrag(): void {
    let d: null | { id: number; el: HTMLElement; pointer: number; x: number; y: number; moved: boolean; lastX: number; lastT: number; tilt: number; base: { x: number; y: number; r: number }; zone: Element | null; target: number } = null;
    this.handEl.addEventListener('pointerdown', (e) => {
      const el = (e.target as Element).closest<HTMLElement>('.hc');
      if (!el || d) return;
      const id = Number(el.dataset.id);
      const ids = this.displayIds();
      const base = this.fanSpot(ids.indexOf(id), ids.length);
      d = { id, el, pointer: e.pointerId, x: e.clientX, y: e.clientY, moved: false, lastX: e.clientX, lastT: performance.now(), tilt: 0, base, zone: null, target: ids.indexOf(id) };
    });
    const move = (e: PointerEvent) => {
      if (!d || e.pointerId !== d.pointer) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved) {
        if (Math.hypot(dx, dy) < 9) return;
        d.moved = true;
        this.dragging = { id: d.id };
        d.el.classList.add('dragging');
        d.el.style.zIndex = '50';
        fx('card.drag');
        sfx('dragStart');
        this.markZones(d.id, true);
      }
      const now = performance.now();
      const v = (e.clientX - d.lastX) / Math.max(1, now - d.lastT);
      d.lastX = e.clientX;
      d.lastT = now;
      d.tilt += (Math.max(-8, Math.min(8, v * 14)) - d.tilt) * 0.3;
      const lift = d.el.classList.contains('selected') ? -this.rem * 2.4 : 0;
      d.el.style.transform = `translate(${d.base.x + dx}px,${d.base.y + lift + dy}px) rotate(${d.tilt}deg) scale(1.12)`;
      const card = this.cardById(d.id);
      if (card?.kind === 'wild' && Math.random() < 0.35) {
        fx('card.dragWildTrail');
        burst(e.clientX, e.clientY, 1, ['sparkle'], 24);
      }
      const zone = this.zoneAt(e.clientX, e.clientY, d.id);
      if (zone !== d.zone) {
        d.zone?.classList.remove('zone-over');
        zone?.classList.add('zone-over');
        d.zone = zone;
      }
      const hr = rectOf(this.handEl);
      if (!zone && e.clientY > hr.top - this.rem) {
        const ids = this.displayIds().filter((x) => x !== d!.id);
        const n = ids.length + 1;
        const { stepX } = this.fanMetrics(n);
        const rel = e.clientX - (hr.left + hr.width / 2);
        const idx = Math.max(0, Math.min(n - 1, Math.round(rel / stepX + (n - 1) / 2)));
        if (idx !== d.target) {
          d.target = idx;
          this.layoutHand(ids, idx);
        }
      }
    };
    const up = (e: PointerEvent) => {
      if (!d || e.pointerId !== d.pointer) return;
      const drag = d;
      d = null;
      if (!drag.moved) {
        this.toggleSelect(drag.id);
        return;
      }
      this.dragging = null;
      drag.zone?.classList.remove('zone-over');
      this.markZones(drag.id, false);
      drag.el.classList.remove('dragging');
      const zone = this.zoneAt(e.clientX, e.clientY, drag.id);
      fx('card.drop');
      sfx('drop');
      if (zone) {
        this.dropOnZone(zone, drag.id, e.clientX);
        this.renderHand();
      } else {
        const hr = rectOf(this.handEl);
        if (e.clientY > hr.top - this.rem) {
          const ids = this.displayIds().filter((x) => x !== drag.id);
          ids.splice(drag.target, 0, drag.id);
          this.match.ui.order = ids;
          this.match.ui.sort = 'custom';
          this.saveNow();
        }
        this.renderHand();
        this.renderActions();
      }
      this.squash(drag.el);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', () => {
      if (d) { d.el.classList.remove('dragging'); this.markZones(d.id, false); this.dragging = null; d = null; this.renderHand(); }
    });
    this.cleanups.push(() => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); });
    this.handEl.addEventListener('click', (e) => {
      if ((e as MouseEvent).detail !== 0) return;
      const el = (e.target as Element).closest<HTMLElement>('.hc');
      if (el) this.toggleSelect(Number(el.dataset.id));
    });
  }

  squash(el: HTMLElement): void {
    const face = el.querySelector('.card');
    if (face) void animate(face, [{ transform: 'scale(1.06,.94)' }, { transform: 'scale(1)' }], { ms: 120, ease: SPRING, fill: 'none' });
  }

  markZones(id: number, on: boolean): void {
    const card = this.cardById(id);
    const zones = [this.discardEl, ...this.panelEl.querySelectorAll('.slot'), ...this.laidEl.querySelectorAll('.group')];
    if (!on || !card) {
      zones.forEach((z) => z.classList.remove('zone-valid', 'zone-dim', 'zone-over'));
      return;
    }
    const my = this.myTurn && this.game.stage === 'play';
    this.discardEl.classList.toggle('zone-valid', my);
    this.discardEl.classList.toggle('zone-dim', !my);
    this.panelEl.querySelectorAll('.slot').forEach((z) => z.classList.add(this.me.laidDown ? 'zone-dim' : 'zone-valid'));
    this.laidEl.querySelectorAll<HTMLElement>('.group').forEach((z) => {
      const g = this.game.groups.find((x) => x.id === Number(z.dataset.groupId));
      const ok = my && this.me.laidDown && !!g && checkHit(g, card).ok;
      z.classList.toggle('zone-valid', ok);
      z.classList.toggle('zone-dim', !ok);
    });
  }

  zoneAt(x: number, y: number, _id: number): Element | null {
    const inside = (el: Element) => {
      const r = rectOf(el);
      return x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6;
    };
    if (inside(this.discardEl)) return this.discardEl;
    for (const s of this.panelEl.querySelectorAll('.slot')) if (inside(s)) return s;
    for (const g of this.laidEl.querySelectorAll('.group')) if (inside(g)) return g;
    return null;
  }

  dropOnZone(zone: Element, id: number, x: number): void {
    if (zone === this.discardEl) {
      this.selected = [id];
      this.onDiscardRequest(id, zone);
      return;
    }
    if (zone.classList.contains('slot')) {
      if (!this.selected.includes(id)) this.selected = [...this.selected, id];
      this.onSlotTap(Number((zone as HTMLElement).dataset.slot));
      return;
    }
    const gid = Number((zone as HTMLElement).dataset.groupId);
    this.selected = [id];
    this.hitOn(gid, zone, x);
  }

  toggleSelect(id: number): void {
    const i = this.selected.indexOf(id);
    if (i >= 0) this.selected.splice(i, 1);
    else this.selected.push(id);
    const el = this.handEls.get(id);
    if (el) {
      el.classList.toggle('selected', i < 0);
      if (i < 0) {
        fx('card.select');
        sfx('select');
      }
    }
    this.layoutHand();
    this.renderActions();
  }

  cycleSort(): void {
    const order = ['number', 'color', 'custom'] as const;
    const ui = this.match.ui;
    if (ui.sort === 'custom' && ui.order.length === 0) ui.order = this.displayIds();
    if (ui.sort !== 'custom') ui.order = ui.order.length ? ui.order : this.displayIds();
    ui.sort = order[(order.indexOf(ui.sort) + 1) % 3];
    this.saveNow();
    this.renderHand();
    this.renderActions();
    fx('hand.reflow');
    noteToast(ui.sort === 'number' ? 'By number' : ui.sort === 'color' ? 'By color' : 'Custom order');
  }

  onSlotTap(index: number): void {
    const slot = this.panelEl.querySelector<HTMLElement>(`[data-slot="${index}"]`);
    if (!slot) return;
    const ui = this.match.ui;
    if (this.selected.length === 0) {
      if (ui.slots[index].length > 0) {
        ui.slots[index] = [];
        this.saveNow();
        this.renderHand();
        this.renderPanel();
        this.renderActions();
      } else {
        invalid(slot, 'Select some cards first.');
      }
      return;
    }
    const size = PHASES[this.me.phase!][index].size;
    const incoming = [...this.selected];
    if (ui.slots[index].length + incoming.length > size) {
      invalid(slot, `This group only takes ${size} cards.`);
      return;
    }
    const cards = incoming.map((id) => this.cardById(id));
    if (cards.some((c) => c?.kind === 'skip')) {
      invalid(slot, "Skips can't be part of a group.");
      return;
    }
    const from = incoming.map((id) => this.handEls.get(id)).filter(Boolean).map((el) => rectOf(el!));
    ui.slots[index].push(...incoming);
    this.selected = [];
    this.saveNow();
    this.renderHand();
    this.renderPanel();
    this.renderActions();
    fx('group.slotFly');
    sfx('drop');
    const minis = [...slot.querySelectorAll<HTMLElement>('.slot-cards .card')].slice(-incoming.length);
    minis.forEach((mini, i) => {
      const r = rectOf(mini);
      const f = from[i];
      if (!f) return;
      void animate(mini, [
        { transform: `translate(${f.left - r.left}px,${f.top - r.top}px) scale(${f.width / r.width})`, opacity: 1 },
        { transform: 'none', opacity: 1 },
      ], { ms: 260, ease: SPRING, delay: i * 25, fill: 'backwards' });
    });
  }

  suggest(): void {
    const btn = this.panelEl.querySelector('.suggest');
    if (this.me.laidDown || this.me.phase === null) return;
    const plan = findArrangement(this.me.hand, this.me.phase);
    if (!plan) {
      invalid(btn, 'No full arrangement yet.');
      return;
    }
    this.match.ui.slots = plan.map((p) => p.cardIds.slice());
    this.selected = [];
    this.saveNow();
    this.renderHand();
    this.renderPanel();
    this.renderActions();
    fx('group.slotFly');
  }

  onPrimary(): void {
    const mode = this.primaryBtn.dataset.mode;
    if (!this.myTurn) return;
    if (this.game.stage === 'draw') {
      invalid(this.primaryBtn, 'You need to draw first.');
      return;
    }
    if (mode === 'lay') {
      const checks = this.slotChecks();
      const bad = checks.find((c) => !c.check.ok && c.check.reason) ?? checks.find((c) => !c.check.ok);
      if (bad) {
        const reason = !bad.check.ok && bad.check.reason ? bad.check.reason : 'Fill every group first.';
        invalid(this.primaryBtn, reason);
        return;
      }
      const groups = this.match.ui.slots.map((ids) => ({ cardIds: ids.slice() }));
      this.enqueue(() => this.doAction({ type: 'layDown', groups }, this.primaryBtn));
      return;
    }
    const sel = this.selected.length === 1 ? this.selected[0] : null;
    if (sel === null) {
      invalid(this.primaryBtn, 'Select one card first.');
      return;
    }
    if (mode === 'discard') { this.onDiscardRequest(sel, this.primaryBtn); return; }
    const targets = this.hitTargets(this.cardById(sel)!);
    if (targets.length === 1) this.hitOn(targets[0].id, this.laidEl.querySelector(`[data-group-id="${targets[0].id}"]`)!, null);
    else if (targets.length > 1) tooltip(this.laidEl, 'Tap a glowing group.');
    else invalid(this.primaryBtn, "That card can't join any group.");
  }

  onGroupTap(id: number, e: MouseEvent): void {
    const el = this.laidEl.querySelector(`[data-group-id="${id}"]`);
    if (this.game.current !== 0) return;
    if (this.game.stage === 'draw') { invalid(el, 'You need to draw first.'); return; }
    if (!this.me.laidDown) { invalid(el, 'Lay down your phase before hitting.'); return; }
    if (this.selected.length !== 1) { invalid(el, 'Select one card first.'); return; }
    this.hitOn(id, el!, e.clientX);
  }

  hitOn(groupId: number, el: Element, x: number | null): void {
    const cardId = this.selected[0];
    const card = this.cardById(cardId);
    const group = this.game.groups.find((g) => g.id === groupId);
    if (!card || !group) return;
    const action: Action = { type: 'hit', cardId, groupId };
    if (group.type === 'run' && card.kind === 'wild' && x !== null) {
      // A Wild goes on the end nearest the tap, when that end has room.
      const check = checkHit(group, card);
      if (check.ok) {
        const r = rectOf(el);
        const want: 'low' | 'high' = x < r.left + r.width / 2 ? 'low' : 'high';
        action.end = check.ends.includes(want) ? want : check.ends[0];
      }
    }
    this.enqueue(() => this.doAction(action, el));
  }

  onDiscardButton(): void {
    if (!this.myTurn) return;
    if (this.game.stage === 'draw') { invalid(this.discardBtn, 'You need to draw first.'); return; }
    if (this.selected.length !== 1) { invalid(this.discardBtn, 'Select exactly one card to discard.'); return; }
    this.onDiscardRequest(this.selected[0], this.discardBtn);
  }

  onDiscardRequest(id: number, el: Element): void {
    if (!this.myTurn) { invalid(el, "It isn't your turn."); return; }
    if (this.game.stage === 'draw') { invalid(el, 'You need to draw first.'); return; }
    const card = this.cardById(id);
    if (!card) return;
    const go = (target?: number) => this.enqueue(() => this.doAction({ type: 'discard', cardId: id, target }, el));
    const proceed = () => {
      if (card.kind === 'skip' && this.me.hand.length > 1) {
        const eligible = eligibleSkipTargets(this.game, 0);
        if (eligible.length === 0) { go(); return; }
        this.targetPicker(go);
        return;
      }
      go();
    };
    if (app.save.settings.confirmDiscard) confirmSheet('Discard this card?', `${cardEl(card).getAttribute('aria-label')} goes to the discard pile.`, 'Discard', proceed);
    else proceed();
  }

  targetPicker(go: (target: number) => void): void {
    const rows: HTMLElement[] = [];
    const sheet = openSheet(h('div.target-list', { 'data-testid': 'target-picker' }, rows), { title: 'Who do you want to skip?', className: 'target-sheet' });
    this.match.lineup.forEach((bot, i) => {
      const seat = i + 1;
      const p = this.game.players[seat];
      const off = p.pendingSkip;
      const row = h('button.target', { class: off ? 'off' : '', 'data-testid': `target-${seat}`, 'aria-disabled': off ? 'true' : undefined },
        portraitEl(bot, 'small'),
        h('span.t-main', null, h('b', null, BOTS[bot].name), h('small', null, `Phase ${p.phase} · ${p.hand.length} cards${off ? ' · already skipped' : ''}`)),
      );
      row.addEventListener('click', () => {
        if (off) { invalid(row, 'That player is already being skipped.'); return; }
        void sheet.close();
        go(seat);
      });
      sheet.el.querySelector('.target-list')!.append(row);
    });
  }

  saveNow(): void {
    persist();
  }

  /* ---------- Applying actions ---------- */

  async doAction(action: Action, feedbackEl: Element | null): Promise<boolean> {
    const fromRects = this.captureFrom(action);
    const result = step(this.game, action);
    if (!result.ok) {
      invalid(feedbackEl, result.reason);
      return false;
    }
    this.commit(action, result.events);
    this.lastFrom = fromRects;
    await this.play(result.events);
    if (this.alive) await this.pump();
    return true;
  }

  lastFrom = new Map<number, DOMRect>();

  /** Remembers where the moving cards are, before the state changes. */
  captureFrom(action: Action): Map<number, DOMRect> {
    const out = new Map<number, DOMRect>();
    if (action.type === 'discard' || action.type === 'hit') {
      const el = this.handEls.get(action.cardId);
      if (el) out.set(action.cardId, rectOf(el.querySelector('.card')!));
    } else if (action.type === 'layDown') {
      for (const g of action.groups) {
        for (const id of g.cardIds) {
          const mini = this.panelEl.querySelector(`.slot-cards [data-card-id="${id}"]`);
          if (mini) out.set(id, rectOf(mini));
        }
      }
    }
    return out;
  }

  /** Bookkeeping that must happen with the state change, so a force-quit can't lose it. */
  commit(action: Action, events: GameEvent[]): void {
    const ui = this.match.ui;
    if (action.type === 'layDown' && events.some((e) => e.type === 'layDown' && e.seat === 0)) {
      ui.slots = ui.slots.map(() => []);
      this.validSlots.clear();
    }
    if (action.type === 'discard' || action.type === 'hit') {
      if (this.game.players[0].hand.every((c) => c.id !== action.cardId)) this.selected = this.selected.filter((x) => x !== action.cardId);
    }
    for (const e of events) {
      if (e.type === 'draw' && e.seat === 0 && !ui.order.includes(e.card.id)) ui.order.push(e.card.id);
      if (e.type === 'roundStart') { ui.slots = ui.slots.map(() => []); }
    }
    ui.order = ui.order.filter((id) => this.game.players[0].hand.some((c) => c.id === id));
    this.syncSlotShape();
    const earned = applyEvents(app.save, this.match, events);
    persist();
    earned.forEach((c) => charmToast(c));
  }

  syncSlotShape(): void {
    const phase = this.game.players[0].phase;
    const size = phase === null || this.game.players[0].laidDown ? 0 : PHASES[phase].length;
    const ui = this.match.ui;
    while (ui.slots.length < size) ui.slots.push([]);
    if (ui.slots.length > size) ui.slots.length = size;
    const hand = new Set(this.game.players[0].hand.map((c) => c.id));
    ui.slots = ui.slots.map((s) => s.filter((id) => hand.has(id)));
  }

  /** Plays out engine events in order, keeping the screen in step. */
  async play(events: GameEvent[]): Promise<void> {
    for (const e of events) {
      if (!this.alive) return;
      await this.present(e);
    }
    this.render();
  }

  async present(e: GameEvent): Promise<void> {
    switch (e.type) {
      case 'roundStart': {
        this.syncSlotShape();
        this.selected = [];
        this.validSlots.clear();
        this.prevPts = this.me.score;
        this.lastActive = -1;
        this.handDimmed = false;
        this.syncTension();
        this.render();
        await dealAnimation(this);
        if (e.startSkip) noteToast('The first card is a Skip.');
        this.nearWinLine();
        break;
      }
      case 'phaseChosen': break;
      case 'turnStart': {
        this.setActiveChip();
        if (e.seat === 0) {
          this.handDimmed = false;
          this.handEl.classList.remove('dim');
          this.ffUntilTurnEnd = false;
          setRate(1);
          this.lastTouch = Date.now();
        }
        this.render();
        break;
      }
      case 'turnSkipped': {
        this.setActiveChip();
        if (e.seat === 0) {
          if (!this.onHerShown) await skipOnHerMoment(this);
          this.onHerShown = false;
          this.handDimmed = true;
          this.handEl.classList.add('dim');
        } else {
          this.say(e.seat, 'skipped');
          this.setFace(e.seat, 'sad');
        }
        this.renderChips();
        await pause(320);
        break;
      }
      case 'draw': await this.presentDraw(e); break;
      case 'reshuffle': await reshuffleMoment(this); break;
      case 'noDraw': noteToast('Nothing to draw.'); break;
      case 'layDown': {
        if (e.seat === 0) {
          await layDownMoment(this, e.phase, e.groupIds);
          this.match.lineup.forEach((_, i) => this.say(i + 1, 'humanLays'));
        } else {
          await otherLayDownMoment(this, e.seat, e.groupIds);
          this.say(e.seat, 'laysDown');
          this.setFace(e.seat, 'happy');
        }
        break;
      }
      case 'hit': await hitMoment(this, e.seat, e.card, e.groupId); break;
      case 'discard': await this.presentDiscard(e); break;
      case 'skipPlayed': {
        if (e.seat === 0) {
          await skipOnBotMoment(this, e.target);
          this.say(e.target, 'skipped');
          this.setFace(e.target, 'sad');
        } else {
          this.say(e.seat, 'playsSkip');
          this.setFace(e.seat, 'smug');
          if (e.target === 0) {
            this.onHerShown = true;
            await skipOnHerMoment(this);
            this.handDimmed = true;
          } else {
            await skipOnBotMoment(this, e.target);
          }
        }
        this.renderChips();
        break;
      }
      case 'skipNoTarget': noteToast('No one to skip'); break;
      case 'goOut': {
        await outMoment(this, e.seat, e.by);
        if (e.seat === 0) this.match.lineup.forEach((_, i) => this.say(i + 1, 'humanGoesOut'));
        else { this.say(e.seat, 'goesOut'); this.setFace(e.seat, 'happy'); }
        break;
      }
      case 'roundEnd': await roundEndMoment(this, e.result); break;
      case 'matchEnd': break;
    }
  }

  onHerShown = false;

  setActiveChip(): void {
    this.renderChips();
  }

  async presentDraw(e: Extract<GameEvent, { type: 'draw' }>): Promise<void> {
    const source = e.source === 'pile' ? this.drawEl : this.discardEl;
    const from = rectOf(source);
    const opening = e.source === 'discard' ? from : from;
    if (e.seat === 0) {
      fx(e.source === 'pile' ? 'card.draw' : 'card.takeDiscard');
      sfx(e.source === 'pile' ? 'draw' : 'takeDiscard');
      if (e.source === 'discard') {
        burst(from.left + from.width / 2, from.top + from.height / 2, 7, ['petal'], 60);
        this.match.lineup.forEach((_, i) => this.say(i + 1, 'humanTakesDiscard'));
      }
      this.renderPiles();
      this.renderHand();
      fx('hand.reflow');
      const el = this.handEls.get(e.card.id);
      if (!el) return;
      el.classList.add('incoming');
      const to = this.handSpotRect(e.card.id);
      await flyCard(this, e.card, opening, to, e.source === 'pile', e.source === 'pile' ? 340 : 280);
      el.classList.remove('incoming');
      this.squash(el);
      fx('card.drop');
      this.renderActions();
      this.tutorial.check();
    } else {
      this.renderPiles();
      const to = rectOf(this.chips[e.seat]);
      const target = { left: to.left + to.width / 2 - from.width * 0.25, top: to.top + to.height / 2 - from.height * 0.25, width: from.width * 0.5, height: from.height * 0.5 };
      if (e.source === 'discard') sfx('takeDiscard', { quiet: 0.6 });
      else sfx('draw', { quiet: 0.5 });
      fx(e.source === 'pile' ? 'card.draw' : 'card.takeDiscard');
      await flyCard(this, e.source === 'discard' ? e.card : null, from, target, false, 240);
      this.renderChips();
    }
  }

  handSpotRect(id: number): { left: number; top: number; width: number; height: number } {
    const ids = this.displayIds();
    const spot = this.fanSpot(ids.indexOf(id), ids.length);
    const hr = rectOf(this.handEl);
    const el = this.handEls.get(id);
    const width = el?.offsetWidth ?? this.fanMetrics(ids.length).cw;
    const height = el?.offsetHeight ?? width * 1.5;
    return { left: hr.left + hr.width / 2 + spot.x - width / 2, top: hr.top + (el?.offsetTop ?? 0) + spot.y, width, height };
  }

  async presentDiscard(e: Extract<GameEvent, { type: 'discard' }>): Promise<void> {
    fx('card.discard');
    sfx('discard', e.seat === 0 ? {} : { quiet: 0.7 });
    const to = rectOf(this.discardEl);
    let from: { left: number; top: number; width: number; height: number };
    const saved = this.lastFrom.get(e.card.id);
    if (e.seat === 0 && saved) from = saved;
    else {
      const c = rectOf(this.chips[e.seat] ?? this.handEl);
      from = { left: c.left + c.width / 2 - to.width * 0.25, top: c.top + c.height / 2 - to.height * 0.25, width: to.width * 0.5, height: to.height * 0.5 };
    }
    this.renderHand();
    this.renderChips();
    fx('hand.reflow');
    // The new top card stays hidden until it lands; the old one slides under.
    const rot = this.discardRotation(e.card.id);
    await flyCard(this, e.card, from, to, false, 300, rot, true);
    this.renderPiles();
    const top = this.discardEl.querySelector<HTMLElement>('.card:last-child');
    if (top) void animate(top, [{ transform: `rotate(${rot}deg) scale(1.05,.94)` }, { transform: `rotate(${rot}deg)` }], { ms: 150, ease: SPRING, fill: 'none' });
  }

  /* ---------- Game flow ---------- */

  /** Runs bot turns until it is her move or the round ends. */
  async pump(): Promise<void> {
    while (this.alive) {
      const g = this.game;
      if (g.stage === 'matchOver') { await this.endMatch(); return; }
      if (g.stage === 'roundOver') { this.render(); showRoundEnd(this); this.autoHook?.(); return; }
      if (g.stage === 'choose') {
        const pendingBot = g.players.findIndex((p, i) => i > 0 && p.phase === null);
        if (g.players[0].phase === null) { this.render(); this.choosePhaseSheet(); this.autoHook?.(); return; }
        if (pendingBot > 0) {
          const res = step(g, decide(this.match.lineup[pendingBot - 1], observe(g, pendingBot), this.botDice));
          if (!res.ok) throw new Error(res.reason);
          this.commit({ type: 'choosePhase', seat: pendingBot, phase: 0 }, res.events);
          await this.play(res.events);
        }
        continue;
      }
      if (g.current === 0) {
        this.render();
        this.scheduleBreathing();
        this.autoHook?.();
        return;
      }
      await this.botTurn();
    }
  }

  choosePhaseSheet(): void {
    const open = phaseSequence(this.game.variant).filter((p) => !this.me.completed.includes(p));
    const list = h('div.phase-choices', { 'data-testid': 'phase-choices' });
    const sheet = openSheet(list, { title: 'Choose your phase', dismissable: false });
    for (const p of open) {
      const row = h('button.phase-choice', { 'data-testid': `choose-${p}` }, h('span.medallion.small', null, h('span', null, p)), h('span', null, phaseText(p)));
      row.addEventListener('click', () => {
        void sheet.close();
        this.enqueue(async () => {
          const res = step(this.game, { type: 'choosePhase', seat: 0, phase: p });
          if (!res.ok) return;
          this.syncSlotShape();
          this.commit({ type: 'choosePhase', seat: 0, phase: p }, res.events);
          await this.play(res.events);
          await this.pump();
        });
      });
      list.append(row);
    }
  }

  scheduleBreathing(): void {
    if (motion.reduced) return;
    const turn = this.game.round * 1000 + this.game.history.length;
    setTimeout(() => {
      if (!this.alive || !this.myTurn || this.breathing || this.game.round * 1000 + this.game.history.length !== turn) return;
      if (Date.now() - this.lastTouch < IDLE_BREATH_MS - 100) { this.scheduleBreathing(); return; }
      fx('ambient.handBreathing');
      this.breathing = this.handEl.animate([{ transform: 'scale(.985)' }, { transform: 'scale(1.015)' }], { duration: 2000, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
    }, IDLE_BREATH_MS);
  }

  async botWait(ms: number): Promise<void> {
    const end = performance.now() + ms * motion.testScale;
    while (performance.now() < end && this.alive) {
      const left = end - performance.now();
      await wait(Math.min(left / (this.ffUntilTurnEnd ? 2.5 : 1), 60));
      if (this.ffUntilTurnEnd && performance.now() >= end - ms * motion.testScale * 0.6) return;
    }
  }

  async botTurn(): Promise<void> {
    const seat = this.game.current;
    const bot = this.match.lineup[seat - 1];
    const [lo, hi] = SPEED[app.save.settings.botSpeed];
    const budget = lo + Math.random() * (hi - lo);
    this.botBudget = budget;
    this.animatingBot = true;
    this.match.botTurns[seat] = (this.match.botTurns[seat] ?? 0) + 1;
    this.render();
    await this.botWait(budget * 0.32);
    let moves = 0;
    while (this.alive && this.game.current === seat && (this.game.stage === 'draw' || this.game.stage === 'play') && moves++ < 80) {
      const before = this.game.stage;
      const action = decide(bot, observe(this.game, seat), this.botDice);
      const res = step(this.game, action);
      if (!res.ok) throw new Error(`Bot move rejected: ${res.reason}`);
      this.commit(action, res.events);
      await this.play(res.events);
      if (before === 'draw') await this.botWait(budget * 0.22);
    }
    this.animatingBot = false;
    if (this.ffUntilTurnEnd && this.game.current !== 0) {
      this.ffUntilTurnEnd = false;
      setRate(1);
    }
  }

  async endMatch(): Promise<void> {
    if (!this.alive) return;
    const summary: MatchSummary = finishMatch(app.save, this.match);
    if (this.game.winners.includes(0) && this.match.boss) await bossDefeatMoment(this);
    const finished = this.match;
    app.save.match = null;
    persist();
    // The bots say their last lines before the end screen covers the table.
    finished.lineup.forEach((bot, i) => {
      const seat = i + 1;
      const won = this.game.winners.includes(seat);
      this.setFace(seat, won ? 'happy' : 'sad');
      if (bot === 'nightshade') this.say(seat, won ? 'wins' : 'loses', true);
      else this.say(seat, won ? 'wins' : 'loses', won);
    });
    await pause(finished.boss ? 1600 : 700);
    if (!this.alive) return;
    showMatchEnd(this, finished, summary);
    this.autoHook?.();
  }

  beginNextRound(): void {
    this.enqueue(async () => {
      if (this.game.stage !== 'roundOver') return;
      const events = nextRound(this.game);
      this.commit({ type: 'draw', source: 'pile' }, events);
      this.root.querySelector('.laid')?.setAttribute('data-sig', '__');
      await this.play(events);
      await this.pump();
    });
  }

  syncTension(): void {
    if (!this.match.boss) return;
    const on = this.game.players.some((p) => p.phase !== null && p.phase >= 9);
    this.root.classList.toggle('tense', on);
    if (on) fx('boss.tension');
    setTension(on);
  }

  nearWinLine(): void {
    const seq = phaseSequence(this.game.variant);
    const left = seq.filter((p) => !this.me.completed.includes(p));
    if (left.length === 1) this.match.lineup.forEach((_, i) => this.say(i + 1, 'humanNearWin'));
  }

  /* ---------- Bots' personality ---------- */

  setFace(seat: number, expression: Expression): void {
    const p = this.portraits[seat];
    if (!p) return;
    setExpression(p, expression);
    clearTimeout(this.expressionTimers.get(seat));
    this.expressionTimers.set(seat, window.setTimeout(() => {
      if (this.alive) setExpression(p, 'neutral');
    }, 2000));
  }

  say(seat: number, trigger: LineTrigger, always = false): void {
    if (!this.alive) return;
    const bot: BotId = this.match.lineup[seat - 1];
    const line = LINES[bot][trigger];
    if (!line) return;
    if (!always) {
      if (this.bubbleEl) return;
      const turns = this.match.botTurns[seat] ?? 0;
      const last = this.lastSaid.get(seat);
      if (last !== undefined && turns - last < 3) return;
      if (Math.random() >= 0.4) return;
    }
    this.lastSaid.set(seat, this.match.botTurns[seat] ?? 0);
    this.showBubble(seat, line);
  }

  lastSaid = new Map<number, number>();

  showBubble(seat: number, line: string): void {
    this.bubbleEl?.remove();
    const chip = rectOf(this.chips[seat]);
    const host = rectOf(this.fxEl);
    const bubble = h('button.bubble', { 'data-testid': 'bubble' }, line);
    this.bubbleEl = bubble;
    this.root.append(bubble);
    const w = bubble.offsetWidth;
    bubble.style.left = `${Math.max(8, Math.min(host.width - w - 8, chip.left - host.left + chip.width / 2 - w / 2))}px`;
    bubble.style.top = `${chip.bottom - host.top + 6}px`;
    const done = () => {
      if (this.bubbleEl === bubble) this.bubbleEl = null;
      bubble.remove();
    };
    bubble.addEventListener('click', done);
    void animate(bubble, [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1)' }], { ms: 180, ease: SPRING, ambient: true });
    setTimeout(() => {
      void animate(bubble, [{ opacity: 1 }, { opacity: 0 }], { ms: 180, ambient: true }).then(done);
    }, 2020);
  }

  /* ---------- Menus ---------- */

  pauseMenu(): void {
    const sheet = openSheet(h('div.menu-list', null,
      h('button.btn.primary', { onclick: () => void sheet.close(), 'data-testid': 'resume' }, 'Resume'),
      h('button.btn.secondary', { onclick: () => { void sheet.close(); howToPlay(() => {}); } }, 'How to Play'),
      h('button.btn.secondary', { onclick: () => { void sheet.close(); settingsScreen(true); } }, 'Settings'),
      h('button.btn.ghost', { 'data-testid': 'forfeit', onclick: () => { void sheet.close(); this.forfeit(); } }, 'Forfeit Match'),
    ), { title: 'Paused' });
  }

  forfeit(): void {
    confirmSheet('Forfeit this match?', 'It will count as a loss.', 'Forfeit', () => {
      finishMatch(app.save, this.match, true);
      app.save.match = null;
      persist();
      closeAllSheets();
      show(journey(), 'map');
    }, 'Keep playing');
  }

  reviewLast(): void {
    if (!this.game.lastRound) {
      tooltip(this.root.querySelector('[data-testid="review"]'), 'Nothing to review until a round ends.');
      return;
    }
    reviewSheet(this, this.game.lastRound);
  }
}

/** One card's flight, with a 3D flip when it comes off the draw pile face-down. */
export async function flyCard(
  t: Table,
  card: Card | null,
  from: { left: number; top: number; width: number; height: number },
  to: { left: number; top: number; width: number; height: number },
  flip: boolean,
  ms: number,
  endRotate = 0,
  arc = false,
): Promise<void> {
  const host = rectOf(t.fxEl);
  const shell = h('div.flyer');
  shell.style.cssText = `left:${from.left - host.left}px;top:${from.top - host.top}px;width:${to.width}px;height:${to.height}px`;
  if (card && flip) {
    const inner = h('div.flip3d', null, h('div.face.front', null, cardEl(card)), h('div.face.backside', null, backEl(t.match.back)));
    shell.append(inner);
    void animate(inner, [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], { ms: 300, ease: 'ease-in-out' });
  } else if (card) {
    shell.append(cardEl(card));
  } else {
    shell.append(backEl(t.match.back));
  }
  t.fxEl.append(shell);
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const s0 = from.width / to.width;
  const midY = dy / 2 - (arc ? t.rem * 3 : t.rem * 0.8);
  await animate(shell, [
    { transform: `translate(0,0) scale(${s0})`, transformOrigin: 'top left' },
    { transform: `translate(${dx / 2}px,${midY}px) scale(${(s0 + 1) / 2 + 0.06}) rotate(${endRotate / 2}deg)`, transformOrigin: 'top left', offset: 0.55 },
    { transform: `translate(${dx}px,${dy}px) scale(1) rotate(${endRotate}deg)`, transformOrigin: 'top left' },
  ], { ms, ease: 'cubic-bezier(.3,.7,.4,1)' });
  shell.remove();
}

