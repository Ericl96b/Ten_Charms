// A tiny DOM helper. The UI is plain elements, with no framework.
type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K];
export function h(tag: string, props?: Props | null, ...children: (Child | Child[])[]): HTMLElement;
export function h(tag: string, props?: Props | null, ...children: (Child | Child[])[]): HTMLElement {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className += `${el.className ? ' ' : ''}${value as string}`;
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      else if (key === 'html') el.innerHTML = value as string;
      else if (key === 'style') el.style.cssText = value as string;
      else if (key === 'disabled' || key === 'value') (el as unknown as Record<string, unknown>)[key] = value;
      else el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: (Child | Child[])[]): void {
  for (const child of children) {
    if (Array.isArray(child)) append(el, child);
    else if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : String(child));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function rectOf(el: Element): DOMRect {
  return el.getBoundingClientRect();
}
