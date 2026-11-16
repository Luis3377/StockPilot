// Finds the element a lesson step points at (see TargetSpec): a CSS selector, a form control by
// its label, or a button/link by its text, optionally inside another element. Only visible
// elements count (the desktop and phone menus both exist; the one on screen is used).

import type { TargetSpec } from './types';

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').replace(/\*/g, '').trim().toLowerCase();

export function isVisible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function byLabel(scope: ParentNode, text: string): HTMLElement[] {
  const wanted = text.split('|').map(norm);
  return [...scope.querySelectorAll('label')].flatMap((label) => {
    const t = norm(label.textContent);
    if (!wanted.some((w) => t === w || t.startsWith(w))) return [];
    const id = label.getAttribute('for');
    const control = id ? document.getElementById(id) : label.querySelector('input,select,textarea,button');
    return control ? [control as HTMLElement] : [];
  });
}

function byText(scope: ParentNode, text: string): HTMLElement[] {
  const wanted = text.split('|').map(norm);
  return [...scope.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')].filter(
    (el) => wanted.includes(norm(el.textContent)) || wanted.includes(norm(el.getAttribute('aria-label'))),
  );
}

function resolveOne(spec: string, root: ParentNode): HTMLElement[] {
  const [first, ...rest] = spec.split(' >> ');
  if (rest.length) {
    return [...root.querySelectorAll(first)].filter(isVisible).flatMap((scope) => resolveOne(rest.join(' >> '), scope));
  }
  if (spec.startsWith('label:')) return byLabel(root, spec.slice(6));
  if (spec.startsWith('button:')) return byText(root, spec.slice(7));
  try {
    return [...root.querySelectorAll<HTMLElement>(spec)];
  } catch {
    return [];
  }
}

/** The first visible element matching the spec (alternatives in order), or null. */
export function resolveTarget(spec: TargetSpec | undefined, root: ParentNode = document): HTMLElement | null {
  if (!spec) return null;
  for (const s of Array.isArray(spec) ? spec : [spec]) {
    const el = resolveOne(s, root).find(isVisible);
    if (el) return el;
  }
  return null;
}
