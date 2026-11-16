// Which browser tab runs the Learning Center lesson. Progress is shared by every StockPilot tab
// (it's in the saved settings), so only one tab — the owner — may move a lesson forward or back.
// Without this, a second tab that doesn't have the lesson's form open would decide "the form was
// closed" and rewind the lesson, the first tab would move it on again, and so on.
//
// - Each tab has an id that survives a refresh of that tab (sessionStorage).
// - The owner holds a Web Lock while its lesson runs; the browser releases it when the tab closes.
// - Other tabs wait for the lock to come free, give a refreshing owner a moment to take it back,
//   then adopt the lesson (one write). They never write progress otherwise.
// - Starting or continuing a lesson in a tab takes it over (steals the lock) on purpose.
// Browsers without Web Locks fall back to "the tab that started it", with a Continue-here button.

const TAB_KEY = 'stockpilot-tab-id';
export const LESSON_LOCK = 'stockpilot-learning-center-lesson';
/** How long a lesson owned by a tab that just went away waits before another tab adopts it. */
export const ADOPT_AFTER_MS = 1500;

function readTabId(): string {
  const fresh = Math.random().toString(36).slice(2, 12);
  try {
    const saved = sessionStorage.getItem(TAB_KEY);
    if (saved && /^[a-z0-9]{4,20}$/.test(saved)) return saved;
    sessionStorage.setItem(TAB_KEY, fresh);
  } catch {
    // Storage blocked: an id for this page load only.
  }
  return fresh;
}

export const TAB_ID = typeof window === 'undefined' ? 'server' : readTabId();

interface LockManagerLike {
  request(name: string, options: { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => unknown): Promise<unknown>;
}

function locks(): LockManagerLike | null {
  const l = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }).locks : undefined;
  return l ?? null;
}

export const hasLocks = () => locks() !== null;

let held = false;
let releaseHeld: (() => void) | null = null;
let pending: Promise<boolean> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function subscribeOwnership(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Whether this tab holds the lesson lock right now. */
export const holdsLesson = () => held;

/**
 * Takes the lesson lock for this tab. `steal` takes it from another tab on purpose (the person
 * started or continued the lesson here); otherwise it only succeeds when no tab holds it.
 */
export function claimLesson(steal: boolean): Promise<boolean> {
  if (held) return Promise.resolve(true);
  if (pending && !steal) return pending;
  pending = claim(steal).finally(() => {
    pending = null;
  });
  return pending;
}

function claim(steal: boolean): Promise<boolean> {
  const lm = locks();
  if (!lm) {
    held = true;
    notify();
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    lm.request(LESSON_LOCK, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(false);
        return undefined;
      }
      held = true;
      notify();
      resolve(true);
      return new Promise<void>((done) => {
        releaseHeld = done;
      });
    }).then(
      () => {
        held = false;
        releaseHeld = null;
        notify();
      },
      // Another tab took the lesson over.
      () => {
        held = false;
        releaseHeld = null;
        notify();
        resolve(false);
      },
    );
  });
}

/** Gives the lesson lock up (the lesson ended here, or another tab owns it now). */
export function releaseLesson(): void {
  if (!held) return;
  const done = releaseHeld;
  held = false;
  releaseHeld = null;
  notify();
  done?.();
}

/** Resolves once no tab holds the lesson lock (immediately if none does). */
export function waitUntilLessonFree(signal: AbortSignal): Promise<void> {
  const lm = locks();
  if (!lm) return Promise.resolve();
  return lm
    .request(LESSON_LOCK, { signal }, () => undefined)
    .then(
      () => undefined,
      () => undefined,
    );
}
