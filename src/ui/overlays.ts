// Things that float above a screen: sheets, tooltips, toasts, speech bubbles.
import { CHARMS, type CharmId } from '../content.ts';
import { sfx } from './audio/audio.ts';
import { icon } from './art.ts';
import { h } from './dom.ts';
import { SOFT, SPRING, animate, fx, shake } from './fx/motion.ts';

function top(): HTMLElement {
  return document.getElementById('overlays')!;
}

export type Sheet = { el: HTMLElement; close: () => Promise<void> };

const openSheets: Sheet[] = [];

export function closeAllSheets(): void {
  for (const s of [...openSheets]) void s.close();
}

export function sheetOpen(): boolean {
  return openSheets.length > 0;
}

/** A bottom sheet that springs up over a fading plum backdrop. */
export function openSheet(content: Node | Node[], opts: { title?: string; onClose?: () => void; dismissable?: boolean; className?: string } = {}): Sheet {
  fx('ui.sheet');
  const body = h('div.sheet-body');
  body.append(...(Array.isArray(content) ? content : [content]));
  const panel = h(`div.sheet${opts.className ? `.${opts.className}` : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title ?? 'Sheet' },
    h('div.sheet-handle'),
    opts.title ? h('h2.sheet-title', null, opts.title) : null,
    body,
  );
  const backdrop = h('div.backdrop');
  const wrap = h('div.sheet-wrap', null, backdrop, panel);
  top().append(wrap);
  void animate(backdrop, [{ opacity: 0 }, { opacity: 1 }], { ms: 220, ease: 'linear' });
  void animate(panel, [{ transform: 'translateY(100%)' }, { transform: 'translateY(-1.5%)', offset: 0.75 }, { transform: 'translateY(0)' }], { ms: 380, ease: SOFT, fill: 'backwards' });
  let closed = false;
  const sheet: Sheet = {
    el: panel,
    close: async () => {
      if (closed) return;
      closed = true;
      openSheets.splice(openSheets.indexOf(sheet), 1);
      wrap.style.pointerEvents = 'none';
      void animate(backdrop, [{ opacity: 1 }, { opacity: 0 }], { ms: 180, ease: 'linear' });
      await animate(panel, [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], { ms: 220, ease: 'ease-in' });
      wrap.remove();
      opts.onClose?.();
    },
  };
  if (opts.dismissable !== false) backdrop.addEventListener('click', () => void sheet.close());
  openSheets.push(sheet);
  return sheet;
}

export function confirmSheet(title: string, text: string, confirmLabel: string, onConfirm: () => void, cancelLabel = 'Cancel'): Sheet {
  const content = [
    h('p.sheet-text', null, text),
    h('div.sheet-actions', null,
      h('button.btn.secondary', { onclick: () => void s.close(), 'data-testid': 'confirm-cancel' }, cancelLabel),
      h('button.btn.primary', { onclick: () => { void s.close(); onConfirm(); }, 'data-testid': 'confirm-ok' }, confirmLabel),
    ),
  ];
  const s = openSheet(content, { title });
  return s;
}

/* ---------- Tooltips ---------- */

let tipEl: HTMLElement | null = null;
let tipTimer = 0;

export function tooltip(near: Element | null, text: string): void {
  tipEl?.remove();
  clearTimeout(tipTimer);
  fx('invalid.tooltip');
  const tip = h('div.tooltip', { role: 'status', 'data-testid': 'tooltip' }, text);
  top().append(tip);
  tipEl = tip;
  const host = top().getBoundingClientRect();
  const r = near?.getBoundingClientRect() ?? { left: host.width / 2, top: host.height / 2, width: 0, height: 0 };
  const w = tip.offsetWidth;
  const x = Math.min(host.width - w - 10, Math.max(10, r.left - host.left + r.width / 2 - w / 2));
  let y = r.top - host.top - tip.offsetHeight - 10;
  if (y < 50) y = r.top - host.top + r.height + 10;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
  void animate(tip, [{ opacity: 0, transform: 'translateY(6px) scale(.94)' }, { opacity: 1, transform: 'none' }], { ms: 160, ease: SPRING });
  tipTimer = window.setTimeout(() => {
    tip.remove();
    if (tipEl === tip) tipEl = null;
  }, 2000);
}

/** The invalid-action feedback: a shake, a bonk, and one short sentence. */
export function invalid(el: Element | null, reason: string): void {
  fx('invalid.shake');
  sfx('invalid');
  if (el) void shake(el);
  tooltip(el, reason);
}

/* ---------- Toasts ---------- */

/** Slides down from the top without blocking input. */
export function charmToast(id: CharmId): void {
  fx('ui.charmToast');
  sfx('charm');
  const charm = CHARMS.find((c) => c.id === id)!;
  const toast = h('div.toast.charm-toast', { 'data-testid': 'charm-toast' },
    h('span.pendant', { html: icon('sparkle') }),
    h('span', null, h('b', null, charm.name), h('small', null, 'Charm earned')),
    h('i.shine'),
  );
  top().append(toast);
  void animate(toast, [{ transform: 'translateY(-160%)' }, { transform: 'translateY(0)' }], { ms: 340, ease: SPRING }).then(async () => {
    await new Promise((r) => setTimeout(r, 2500));
    await animate(toast, [{ transform: 'translateY(0)' }, { transform: 'translateY(-160%)' }], { ms: 240, ease: 'ease-in' });
    toast.remove();
  });
}

export function noteToast(text: string, onTap?: () => void, sticky = false): HTMLElement {
  const toast = h(onTap ? 'button.toast.note-toast' : 'div.toast.note-toast', { onclick: onTap, role: 'status' }, text);
  top().append(toast);
  void animate(toast, [{ opacity: 0, transform: 'translateY(-60%)' }, { opacity: 1, transform: 'none' }], { ms: 220, ease: SPRING });
  if (!sticky) {
    setTimeout(() => {
      void animate(toast, [{ opacity: 1 }, { opacity: 0 }], { ms: 200 }).then(() => toast.remove());
    }, 2000);
  }
  return toast;
}
