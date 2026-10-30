// Coach marks for the first match. Each appears when it becomes relevant, anchored to the UI it describes.
import { persist, app } from '../app.ts';
import { h, rectOf } from '../dom.ts';
import { SPRING, animate } from '../fx/motion.ts';
import type { Table } from './table.ts';

type Step = { text: string; anchor: () => Element | null; ready: () => boolean };

export class Tutorial {
  t: Table;
  el: HTMLElement | null = null;
  current = -1;
  steps: Step[];

  constructor(t: Table) {
    this.t = t;
    const g = () => t.game;
    const myPlay = () => t.myTurn && g().stage === 'play';
    this.steps = [
      { text: 'Your goal this round: Phase 1 — two Sets of 3.', anchor: () => t.panelEl, ready: () => true },
      { text: 'Start your turn by drawing — tap the draw pile or the discard.', anchor: () => t.root.querySelector('.piles'), ready: () => t.myTurn && g().stage === 'draw' },
      { text: 'Tap cards, then tap a slot to build each group.', anchor: () => t.panelEl.querySelector('.slots') ?? t.handEl, ready: () => myPlay() && !t.me.laidDown },
      { text: 'When both groups are ready, lay them down!', anchor: () => t.primaryBtn, ready: () => myPlay() && !t.me.laidDown && t.allSlotsReady() },
      { text: 'End every turn by discarding one card.', anchor: () => t.discardEl, ready: () => myPlay() },
      { text: "Once your phase is down, you can add cards to any group on the table. That's a Hit.", anchor: () => t.laidEl, ready: () => myPlay() && t.me.laidDown && t.me.hand.some((c) => t.hitTargets(c).length > 0) },
      { text: 'Skips make someone miss a turn. Wilds can be anything.', anchor: () => t.handEl, ready: () => t.me.hand.some((c) => c.kind !== 'num') },
    ];
  }

  get active(): boolean {
    const s = app.save.tutorial;
    return this.t.match.mode.kind === 'campaign' && this.t.match.mode.stop === 0 && !s.done;
  }

  /** Called whenever the table changes. Shows the next relevant tip, or moves the current one on. */
  check(): void {
    if (!this.active || !this.t.alive || this.t.dragging || this.t.dealing) return;
    if (this.el) {
      // A tip that describes an action clears itself once that action's moment has passed.
      const step = this.steps[this.current];
      if (step && !step.ready() && this.current !== 0) this.dismissStep();
      return;
    }
    const seen = app.save.tutorial.seen;
    for (let i = 0; i < this.steps.length; i++) {
      if (seen.includes(i)) continue;
      // The first five appear strictly in order; the last two wait for their moment.
      if (i <= 4 && seen.filter((x) => x <= 4).length !== i) continue;
      if (this.steps[i].ready()) { this.show(i); return; }
      if (i <= 4) continue;
    }
  }

  show(i: number): void {
    this.current = i;
    const step = this.steps[i];
    const anchor = step.anchor();
    const host = this.t.root;
    const hr = rectOf(host);
    const spot = h('div.coach-spot');
    const bubble = h('div.coach-bubble', { 'data-testid': 'coach', role: 'status' },
      h('p', null, step.text),
      h('div.coach-actions', null,
        h('button.link-btn', { 'data-testid': 'coach-skip', onclick: () => this.skipAll() }, 'Skip tips'),
        h('button.btn.primary.small', { 'data-testid': 'coach-next', onclick: () => this.dismissStep() }, 'Got it'),
      ),
    );
    const wrap = h('div.coach', null, spot, bubble);
    host.append(wrap);
    this.el = wrap;
    if (anchor) {
      const r = rectOf(anchor);
      spot.style.cssText = `left:${r.left - hr.left - 6}px;top:${r.top - hr.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px`;
      const below = r.top - hr.top < hr.height * 0.45;
      const bh = bubble.offsetHeight;
      bubble.style.top = `${below ? r.bottom - hr.top + 14 : r.top - hr.top - bh - 14}px`;
    }
    void animate(bubble, [{ opacity: 0, transform: 'translateY(8px) scale(.95)' }, { opacity: 1, transform: 'none' }], { ms: 260, ease: SPRING, ambient: true });
  }

  dismissStep(): void {
    if (this.current >= 0 && !app.save.tutorial.seen.includes(this.current)) app.save.tutorial.seen.push(this.current);
    this.el?.remove();
    this.el = null;
    this.current = -1;
    if (app.save.tutorial.seen.length >= this.steps.length) app.save.tutorial.done = true;
    persist();
    queueMicrotask(() => this.check());
  }

  skipAll(): void {
    this.el?.remove();
    this.el = null;
    this.current = -1;
    app.save.tutorial.done = true;
    persist();
  }
}
