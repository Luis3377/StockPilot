// Finds the element(s) a lesson step points at (see TargetSpec): a CSS selector, a form control
// by its label, a whole form field (label, control, its extra buttons and hint) by its label, or
// a button/link by its text, optionally inside another element. Only visible elements count (the
// desktop and phone menus both exist; the one on screen is used).

import type { TargetSpec } from './types';

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').replace(/\*/g, '').trim().toLowerCase();

/** What keyboard focus can land on (kept in step with the dialog's own list). */
export const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function isVisible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function byLabel(scope: ParentNode, text: string): HTMLElement[] {
  const wanted = text.split('|').map(norm);
  // Exact label matches first ("Quantity" before "Quantity sold"), then labels that start with it.
  const labels = [...scope.querySelectorAll('label')];
  const exact = labels.filter((l) => wanted.includes(norm(l.textContent)));
  const loose = labels.filter((l) => !exact.includes(l) && wanted.some((w) => norm(l.textContent).startsWith(w)));
  return [...exact, ...loose].flatMap((label) => {
    const id = label.getAttribute('for');
    const control = id ? document.getElementById(id) : label.querySelector('input,select,textarea,button');
    return control ? [control as HTMLElement] : [];
  });
}

function byText(scope: ParentNode, text: string): HTMLElement[] {
  const wanted = text.split('|').map(norm);
  const els = [...scope.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')];
  const exact = els.filter((el) => wanted.includes(norm(el.textContent)) || wanted.includes(norm(el.getAttribute('aria-label'))));
  // A button with a sub-line ("More details · Condition, location…") matches by how it starts.
  return exact.length ? exact : els.filter((el) => wanted.some((w) => norm(el.textContent).startsWith(w)));
}

function resolveOne(spec: string, root: ParentNode): HTMLElement[] {
  const [first, ...rest] = spec.split(' >> ');
  if (rest.length) {
    return [...root.querySelectorAll(first)].filter(isVisible).flatMap((scope) => resolveOne(rest.join(' >> '), scope));
  }
  if (spec.startsWith('label:')) return byLabel(root, spec.slice(6));
  // The whole field: the control plus anything that belongs to it (−/+ buttons, a unit toggle).
  if (spec.startsWith('field:')) return byLabel(root, spec.slice(6)).map((c) => c.closest<HTMLElement>('[data-field]') ?? c);
  if (spec.startsWith('button:')) return byText(root, spec.slice(7));
  try {
    return [...root.querySelectorAll<HTMLElement>(spec)];
  } catch {
    return [];
  }
}

/** The first visible element matching the spec (alternatives in order), or null. */
export function resolveTarget(spec: TargetSpec | undefined, root: ParentNode = document): HTMLElement | null {
  return resolveTargets(spec, false, root)[0] ?? null;
}

/**
 * Visible elements matching the spec. With `all`, every visible match of every alternative
 * (e.g. the page's "Add item" and the phone's round + button both start a new item).
 */
export function resolveTargets(spec: TargetSpec | undefined, all: boolean, root: ParentNode = document): HTMLElement[] {
  if (!spec) return [];
  const found: HTMLElement[] = [];
  for (const s of Array.isArray(spec) ? spec : [spec]) {
    for (const el of resolveOne(s, root)) {
      if (!isVisible(el) || found.some((f) => f === el || f.contains(el) || el.contains(f))) continue;
      found.push(el);
      if (!all) return found;
    }
  }
  return found;
}

/** The form control a field step reads: the element itself, or the first control inside a field group. */
export function valueElement(el: HTMLElement | null): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null {
  if (!el) return null;
  if (el.matches('input,select,textarea')) return el as HTMLInputElement;
  return el.querySelector<HTMLInputElement>('input:not([type="hidden"]):not([type="file"]),select,textarea');
}
