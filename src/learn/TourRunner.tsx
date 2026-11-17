// A running lesson, in the tab that owns it: dims the page, highlights the real control(s), shows
// the lesson box, and moves on only when the step's own check passes (a click on the highlighted
// control, a valid answer, a verified result, or Next on a look-only step).
//
// While a step is shown, the rest of the page can't be used by pointer (the dimmed overlay) or
// keyboard (Tab only moves between the highlighted control and the lesson box). Escape, Exit and
// Skip lesson always work.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { GraduationCap, X } from 'lucide-react';
import { store, useAppState } from '../data/store';
import { scannerEnabled } from '../ai/config';
import { completeLesson, goToStep, pauseLesson, skipLesson, type ActiveLesson } from './progress';
import { nextUnfinished, pathFor, practiceDetailParent, stepsFor } from './lessons';
import { FOCUSABLE, isVisible, resolveTargets, valueElement } from './targets';
import { TAB_ID } from './session';
import { saveProgress, useTour } from './tourContext';
import type { Lesson, LessonEnv, LessonStep, StaticEnv, Text } from './types';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useToast } from '../ui/Toast';
import { cn } from '../ui/cn';

const PAD = 6;
const MISSING_MS = 4000;
const OPTIONAL_MS = 700;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The smallest box around all highlighted controls (the lesson box is placed against all of them). */
function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const top = Math.min(...boxes.map((b) => b.top));
  const left = Math.min(...boxes.map((b) => b.left));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  return { top, left, width: right - left, height: bottom - top };
}

const sameBoxes = (a: Box[], b: Box[]) =>
  a.length === b.length && a.every((x, i) => x.top === b[i].top && x.left === b[i].left && x.width === b[i].width && x.height === b[i].height);

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function textOf(t: Text, env: LessonEnv): string {
  return typeof t === 'function' ? t(env) : t;
}

/** The page a step opens (some depend on the records, e.g. Monthly Close's month). */
function routeOf(step: LessonStep, env: LessonEnv): string | undefined {
  return typeof step.route === 'function' ? step.route(env) : step.route;
}

export function TourRunner({ lesson, active, staticEnv }: { lesson: Lesson; active: ActiveLesson; staticEnv: StaticEnv }) {
  const steps = useMemo(() => stepsFor(lesson, staticEnv), [lesson, staticEnv]);
  const index = Math.min(active.step, steps.length - 1);
  const step = steps[index];
  const data = useAppState((s) => s.data);
  const dataset = useAppState((s) => s.dataset);
  const progress = useAppState((s) => s.settings.tutorial);
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { start, takeResumed } = useTour();
  // The elements found for *this* step (never ones found for the previous step, so a stale field
  // can't complete the next step).
  const stepKey = `${lesson.id}:${index}`;
  const [found, setFound] = useState<{ key: string; els: HTMLElement[] }>({ key: '', els: [] });
  const els = useMemo(() => (found.key === stepKey ? found.els : []), [found, stepKey]);
  const el = els[0] ?? null;
  // Measured for this step only (a box from the previous step would place the lesson box wrongly).
  const [measured, setBoxes] = useState<{ key: string; boxes: Box[] }>({ key: '', boxes: [] });
  const boxes = measured.key === stepKey ? measured.boxes : [];
  const [missing, setMissing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [touched, setTouched] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  // Leaving would close a form with typing in it: ask first (L13).
  const [confirmLeave, setConfirmLeave] = useState(false);
  const formDirty = useRef(false);
  const missingSince = useRef<number | null>(null);
  const scrolledFor = useRef<{ key: string; count: number; at: number } | null>(null);
  const navigatedFor = useRef<string | null>(null);
  const firstRun = useRef(true);
  const carryHint = useRef<{ index: number; text: string } | null>(null);
  const keyboardFlow = useRef(false);

  const env = useCallback(
    (): LessonEnv => ({
      data: store.getState().data,
      settings: store.getState().settings,
      path: location.pathname,
      baseline: active.baseline,
      scannerEnabled,
      has: (sel) => !!document.querySelector(sel),
      text: (sel) => document.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    }),
    [location.pathname, active.baseline],
  );

  /** Moves from step `from` (ignored if the lesson already moved on, or this tab no longer owns it). */
  const go = useCallback(
    (from: number, to: number) => {
      const p = store.getState().settings.tutorial;
      if (!p.active || p.active.step !== from || p.active.owner !== TAB_ID) return;
      saveProgress(goToStep(p, Math.max(0, Math.min(to, steps.length - 1))));
    },
    [steps.length],
  );

  const leave = useCallback(
    async (how: 'pause' | 'skip' | 'finish', then?: string) => {
      const p = store.getState().settings.tutorial;
      if (!p.active || p.active.owner !== TAB_ID) return;
      saveProgress(how === 'pause' ? pauseLesson(p) : how === 'skip' ? skipLesson(p) : completeLesson(p, new Date().toISOString()));
      if (lesson.practice) {
        await store.exitPractice();
        // A practice record's page (e.g. a practice Max Bid plan) doesn't exist in your own records.
        const parent = practiceDetailParent(location.pathname);
        if (parent && !then) navigate(parent);
      }
      if (then) navigate(then);
      const stored = lesson.practice ? ' The practice records stay stored on this device until you start a practice lesson over or delete them in the Learning Center.' : '';
      if (how === 'pause') toast.info(`Lesson paused. Resume it any time from the Learning Center.${stored}`);
      if (how === 'skip') toast.info(`Lesson skipped. It stays in the Learning Center whenever you want it.`);
      if (how === 'finish') toast.success(`Lesson complete: ${lesson.title}.`);
    },
    [lesson, toast, location.pathname, navigate],
  );

  // Typing in an open form (Add item, Record sale…) is remembered until the form closes, so leaving
  // the lesson never throws it away without asking.
  useEffect(() => {
    const MODAL = '[role="dialog"][aria-modal="true"]';
    const onInput = (ev: Event) => {
      if (ev.target instanceof Element && ev.target.closest(MODAL)) formDirty.current = true;
    };
    const obs = new MutationObserver(() => {
      if (!document.querySelector(MODAL)) formDirty.current = false;
    });
    obs.observe(document.body, { childList: true });
    document.addEventListener('input', onInput, true);
    return () => {
      obs.disconnect();
      document.removeEventListener('input', onInput, true);
    };
  }, []);
  const formHasTyping = () => formDirty.current && !!document.querySelector('[role="dialog"][aria-modal="true"]');
  /** Exit (✕, Exit, Escape): straight away, unless that would throw away typing in an open form. */
  const requestExit = useCallback(() => {
    if (formHasTyping()) setConfirmLeave(true);
    else void leave('pause');
  }, [leave]);

  // A practice lesson only ever runs on the practice records (e.g. after a refresh).
  useEffect(() => {
    if (lesson.practice && dataset !== 'practice') void store.enterPractice(false);
  }, [lesson.practice, dataset]);

  // First render after a refresh or a Resume: a step inside a form that isn't open goes back to the
  // step that opens it, saying which of the two happened.
  useEffect(() => {
    if (!firstRun.current) return;
    firstRun.current = false;
    const resumed = takeResumed(lesson.id);
    const formGone = step.resumeAt && resolveTargets(step.target, false).length === 0;
    const to = formGone ? steps.findIndex((s) => s.id === step.resumeAt) : -1;
    if (to >= 0 && to < index) {
      carryHint.current = {
        index: to,
        text: resumed
          ? 'Picking up where you left off. Open the form again to carry on (anything typed but not saved needs typing again).'
          : 'The page reloaded and the form closed. Open it again to carry on (anything typed but not saved needs typing again).',
      };
      go(index, to);
    } else if (resumed && index > 0) {
      // Shown by the step effect below (it runs next and would otherwise clear it).
      carryHint.current = { index, text: `Welcome back — picking up at step ${index + 1} of ${steps.length}.` };
    }
  }, [step, steps, index, go, lesson.id, takeResumed]);

  // Each step opens its page once when it starts; after that the user can go anywhere.
  useEffect(() => {
    if (carryHint.current?.index === index) {
      setHint(carryHint.current.text);
      carryHint.current = null;
    } else setHint(null);
    setMissing(false);
    setTouched(false);
    setConfirmSkip(false);
    setConfirmLeave(false);
    missingSince.current = null;
    const route = routeOf(step, env());
    if (route && navigatedFor.current !== stepKey) {
      navigatedFor.current = stepKey;
      if (`${location.pathname}${location.search}` !== route && location.pathname !== route) navigate(route);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  // Find the target(s), follow them as the page scrolls or resizes, and notice when they're missing.
  useEffect(() => {
    let raf = 0;
    // The highlighted element carries the step's id (for tests and assistive tech), set here so it
    // never sits on the previous step's element.
    let marked: HTMLElement[] = [];
    const mark = (now: HTMLElement[]) => {
      if (marked.length === now.length && marked.every((m, i) => m === now[i])) return;
      for (const m of marked) {
        if (now.includes(m)) continue;
        m.removeAttribute('data-tour-active');
        m.style.scrollMarginTop = '';
        m.style.scrollMarginBottom = '';
      }
      for (const n of now) n.setAttribute('data-tour-active', step.id);
      marked = now;
    };
    const measure = () => {
      const now = resolveTargets(step.target, Boolean(step.targetAll));
      mark(now);
      setFound((prev) => (prev.key === stepKey && prev.els.length === now.length && prev.els.every((e, i) => e === now[i]) ? prev : { key: stepKey, els: now }));
      if (!step.target) {
        setBoxes((b) => (b.key === stepKey && !b.boxes.length ? b : { key: stepKey, boxes: [] }));
        return;
      }
      if (now.length) {
        missingSince.current = null;
        setMissing(false);
        const next = now.map((n) => {
          const r = n.getBoundingClientRect();
          return { top: r.top, left: r.left, width: r.width, height: r.height };
        });
        setBoxes((b) => (b.key === stepKey && sameBoxes(b.boxes, next) ? b : { key: stepKey, boxes: next }));
        // Off screen, or under the sticky header or the phone's tab bar: bring it to the middle.
        // Checked when the step starts and once more a moment later (a page still loading, or the
        // browser restoring the scroll position after a refresh, can move it).
        const first = now[0];
        const r = first.getBoundingClientRect();
        const tries = scrolledFor.current?.key === stepKey ? scrolledFor.current : { key: stepKey, count: 0, at: 0 };
        if (tries.count < 2 && Date.now() - tries.at > 600) {
          const inView = (el: HTMLElement) => {
            const b = el.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + Math.min(b.height, 40) / 2);
            return b.top >= 0 && b.bottom <= window.innerHeight && !!hit && (el.contains(hit) || !!hit.closest('[data-tour-popover], [data-tour-overlay]'));
          };
          // A control taller than most of the screen (a long checklist) is shown from its top, under
          // the sticky header, rather than scrolled to its middle.
          const tall = r.height > window.innerHeight * 0.6;
          const topHidden = r.top < 56 || r.top > window.innerHeight * 0.4;
          // With several highlighted controls (either one works), one already on screen is enough:
          // never scroll away from the one the person has scrolled to.
          const hidden = tall ? topHidden : !now.some(inView);
          scrolledFor.current = { key: stepKey, count: hidden ? tries.count + 1 : tries.count === 0 ? 1 : 2, at: Date.now() };
          if (hidden) {
            if (tall) first.style.scrollMarginTop = '80px';
            first.scrollIntoView({ block: tall ? 'start' : 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
          }
        }
      } else {
        setBoxes((b) => (b.key === stepKey && !b.boxes.length ? b : { key: stepKey, boxes: [] }));
        missingSince.current ??= Date.now();
        const waited = Date.now() - missingSince.current;
        const back = step.resumeAt ? steps.findIndex((s) => s.id === step.resumeAt) : -1;
        // Only while this tab is the one on screen: a tab in the background never decides a form "closed".
        if (document.visibilityState === 'hidden') return;
        if (step.optional && waited > OPTIONAL_MS) go(index, index + 1);
        else if (back >= 0 && back < index && waited > OPTIONAL_MS) {
          carryHint.current = { index: back, text: 'The form was closed. Open it again to carry on.' };
          go(index, back);
        } else if (waited > MISSING_MS) setMissing(true);
      }
    };
    const onFrame = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    measure();
    const timer = window.setInterval(measure, 250);
    window.addEventListener('scroll', onFrame, true);
    window.addEventListener('resize', onFrame);
    return () => {
      mark([]);
      window.clearInterval(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onFrame, true);
      window.removeEventListener('resize', onFrame);
    };
  }, [step, steps, stepKey, index, go]);

  // Verified progress: "when" checks and "already done" checks, on every change that matters.
  useEffect(() => {
    const e = env();
    if (step.skipIf?.(e)) go(index, index + 1);
    else if (step.advance.kind === 'when' && step.advance.check(e)) go(index, index + 1);
  }, [data, location.pathname, tick, step, index, env, go]);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const obs = new MutationObserver(bump);
    obs.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('input', bump, true);
    document.addEventListener('change', bump, true);
    return () => {
      obs.disconnect();
      document.removeEventListener('input', bump, true);
      document.removeEventListener('change', bump, true);
    };
  }, []);

  // A click on a highlighted control completes a click step. Nothing else does.
  useEffect(() => {
    if (step.advance.kind !== 'click' || !els.length) return;
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Node && els.some((t) => t.contains(e.target as Node))) window.setTimeout(() => go(index, index + 1), 0);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [step, els, index, go]);

  // Field steps: the value is read from the field (or the control inside a highlighted field group).
  const input = step.advance.kind === 'field' ? valueElement(el) : null;
  void tick;
  const value = input ? String(input.value ?? '') : '';
  const fieldOk = step.advance.kind === 'field' ? step.advance.valid(value) : true;
  const invalidText = step.advance.kind === 'field' ? (typeof step.advance.invalid === 'function' ? step.advance.invalid(value) : step.advance.invalid) : '';
  const tryField = useCallback((): boolean => {
    if (step.advance.kind !== 'field') return false;
    const v = input ? String(input.value ?? '') : '';
    if (step.advance.valid(v)) {
      go(index, index + 1);
      return true;
    }
    setTouched(true);
    return false;
  }, [step, input, index, go]);

  useEffect(() => {
    if (step.advance.kind !== 'field' || !input) return;
    const valid = step.advance.valid;
    // Choosing from a list is a complete answer on its own.
    const onChange = () => {
      if (input instanceof HTMLSelectElement && valid(input.value)) window.setTimeout(() => go(index, index + 1), 0);
    };
    input.addEventListener('change', onChange);
    // Focus starts in the field (on phones only when arriving by keyboard, so the on-screen keyboard
    // doesn't pop up uninvited).
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (document.activeElement !== input && (!coarse || keyboardFlow.current)) input.focus({ preventScroll: true });
    keyboardFlow.current = false;
    return () => input.removeEventListener('change', onChange);
  }, [step, input, index, go]);

  // Keyboard: Tab moves only between the highlighted control(s) and the lesson box; Tab or Enter in a
  // field with a valid answer moves on; Escape always exits (and keeps the place).
  const lookOnly = step.advance.kind === 'next';
  useEffect(() => {
    const popover = () => document.querySelector<HTMLElement>('[data-tour-popover]');
    const roots = () => [...(lookOnly ? [] : els), popover()].filter((r): r is HTMLElement => !!r);
    const inRoots = (n: EventTarget | null) => n instanceof Node && roots().some((r) => r.contains(n));
    const focusables = () =>
      roots()
        .flatMap((r) => [...(r.matches(FOCUSABLE) ? [r] : []), ...r.querySelectorAll<HTMLElement>(FOCUSABLE)])
        .filter((f) => isVisible(f));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Escape never closes the form underneath (that would lose what was typed). In a dropdown
        // or date field it's left to the browser (closing the list or picker); otherwise it cancels
        // an open question, or asks to leave the lesson, confirming first if a form has typing in it.
        e.stopPropagation();
        const t = e.target;
        if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && /^(date|time|datetime-local|month|week)$/.test(t.type))) return;
        e.preventDefault();
        if (confirmLeave) setConfirmLeave(false);
        else if (confirmSkip) setConfirmSkip(false);
        else requestExit();
        return;
      }
      const fieldInput = step.advance.kind === 'field' && input && e.target === input;
      if (e.key === 'Enter' && fieldInput && !(input instanceof HTMLTextAreaElement)) {
        // Enter answers the step instead of submitting the whole form.
        e.preventDefault();
        e.stopPropagation();
        keyboardFlow.current = tryField();
        return;
      }
      if (e.key !== 'Tab') return;
      e.preventDefault();
      e.stopPropagation();
      if (fieldInput && !e.shiftKey) {
        if (tryField()) {
          keyboardFlow.current = true;
          return;
        }
        // Not valid yet: the reason is shown, and Tab goes on to the lesson box (never a trap).
      }
      const list = focusables();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i < 0 ? 0 : (i + 1) % list.length;
      list[next].focus();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (inRoots(e.target)) return;
      // Something else took focus (a form opening, a page changing): bring it back to the lesson.
      const target = !lookOnly && els[0] && focusables().find((f) => els[0].contains(f));
      (target || popover()?.querySelector<HTMLElement>('h2'))?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, [els, lookOnly, step, input, tryField, requestExit, confirmLeave, confirmSkip]);

  const e = env();
  const title = textOf(step.title, e);
  const body = textOf(step.body, e);
  const isLast = index === steps.length - 1;
  const path = pathFor(staticEnv);
  const nextLesson = isLast ? nextUnfinished(staticEnv, progress, lesson.id) : undefined;
  // Finishing the last unfinished lesson on the path: say so.
  const pathDone = isLast && path.some((l) => l.id === lesson.id) && path.every((l) => l.id === lesson.id || l.id in progress.completed);
  const route = routeOf(step, e);
  const offRoute = Boolean(route && location.pathname !== route.split('?')[0] && navigatedFor.current === stepKey);
  const canNext =
    (step.advance.kind === 'next' && (!step.advance.ready || step.advance.ready(e))) || (step.advance.kind === 'click' && step.advance.orNext) || step.advance.kind === 'field';
  const onMaskClick = () =>
    setHint(
      step.target
        ? 'That part of the screen is paused during this step. Use the highlighted area, or Exit the lesson.'
        : 'Use the buttons in this box to continue, or Exit the lesson.',
    );
  const shown = step.target ? boxes : [];

  return createPortal(
    <>
      <Overlay boxes={shown} onClick={onMaskClick} onLookClick={lookOnly ? () => setHint('This step only shows where this is. Press Next to continue.') : undefined} />
      <Popover
        lesson={lesson}
        step={step}
        title={title}
        body={body}
        index={index}
        total={steps.length}
        box={unionBox(shown)}
        boxes={shown}
        missing={missing}
        offRoute={offRoute}
        hint={step.advance.kind === 'field' && touched && !fieldOk ? invalidText : hint}
        canNext={canNext}
        isLast={isLast}
        nextLesson={nextLesson}
        pathDone={pathDone}
        confirmSkip={confirmSkip}
        confirmLeave={confirmLeave}
        formTyping={confirmSkip && formHasTyping()}
        onBack={() => go(index, index - 1)}
        onNext={() => {
          if (!canNext) return;
          if (isLast) void leave('finish');
          else if (step.advance.kind === 'field') tryField();
          else go(index, index + 1);
        }}
        onSkipStep={() => go(index, index + 1)}
        onRetry={() => {
          missingSince.current = null;
          setMissing(false);
          if (route) navigate(route);
          else {
            const to = step.resumeAt ? steps.findIndex((s) => s.id === step.resumeAt) : -1;
            if (to >= 0) go(index, to);
          }
        }}
        onReturn={() => route && navigate(route)}
        onFocusTarget={() => {
          el?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
          const f = el && (el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE));
          f?.focus({ preventScroll: true });
        }}
        onCovered={(pop) => {
          // On a phone the lesson box can sit over the control: scroll the control into the free part.
          if (!el) return;
          const vh = window.innerHeight;
          if (pop.top > vh / 2) {
            el.style.scrollMarginTop = '72px';
            el.style.scrollMarginBottom = `${vh - pop.top + 12}px`;
          } else {
            el.style.scrollMarginTop = `${pop.bottom + 12}px`;
            el.style.scrollMarginBottom = '96px';
          }
          el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
        }}
        onExit={requestExit}
        onLeaveAnyway={() => void leave('pause')}
        onCancelLeave={() => setConfirmLeave(false)}
        onAskSkip={() => setConfirmSkip(true)}
        onCancelSkip={() => setConfirmSkip(false)}
        onSkipLesson={() => void leave('skip')}
        onBackToLearn={() => void leave('finish', '/learn')}
        onNextLesson={async () => {
          await leave('finish');
          if (nextLesson) void start(nextLesson.id, { keepPractice: lesson.practice && Boolean(nextLesson.continuesPractice) });
        }}
      />
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------------------------------------
// Overlay: one shape with a hole per highlighted control (no seams), and the highlight rings.
// ---------------------------------------------------------------------------------------------

function useViewport() {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vp;
}

function holePath(b: Box): string {
  const x = b.left - PAD;
  const y = b.top - PAD;
  const w = b.width + PAD * 2;
  const h = b.height + PAD * 2;
  const r = Math.min(12, w / 2, h / 2);
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

function Overlay({ boxes, onClick, onLookClick }: { boxes: Box[]; onClick: () => void; onLookClick?: () => void }) {
  const vp = useViewport();
  const d = `M0 0H${vp.w}V${vp.h}H0Z ${boxes.map(holePath).join(' ')}`;
  return (
    <div aria-hidden data-testid="tour-mask" data-tour-overlay>
      <svg className="pointer-events-none fixed inset-0 z-[60] h-full w-full" width={vp.w} height={vp.h}>
        <path d={d} fillRule="evenodd" className="pointer-events-auto fill-black/50 dark:fill-black/75" onClick={onClick} />
      </svg>
      {boxes.map((b, i) => (
        <div key={i}>
          {onLookClick && (
            <div
              className="fixed z-[60]"
              style={{ top: b.top - PAD, left: b.left - PAD, width: b.width + PAD * 2, height: b.height + PAD * 2 }}
              onClick={onLookClick}
              data-testid="tour-look-shield"
            />
          )}
          <div
            className="pointer-events-none fixed z-[61] rounded-xl ring-4 ring-accent motion-safe:transition-all motion-safe:duration-150 dark:outline dark:outline-2 dark:outline-offset-4 dark:outline-white/80"
            style={{ top: b.top - PAD, left: b.left - PAD, width: b.width + PAD * 2, height: b.height + PAD * 2 }}
            data-testid={i === 0 ? 'tour-highlight' : undefined}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The lesson box
// ---------------------------------------------------------------------------------------------

interface PopoverProps {
  lesson: Lesson;
  step: LessonStep;
  title: string;
  body: string;
  index: number;
  total: number;
  box: Box | null;
  /** Each highlighted control on its own (box is all of them together). */
  boxes: Box[];
  missing: boolean;
  offRoute: boolean;
  hint: string | null;
  canNext: boolean;
  isLast: boolean;
  nextLesson: Lesson | undefined;
  pathDone: boolean;
  confirmSkip: boolean;
  /** "Leave the lesson? What you typed will be lost." */
  confirmLeave: boolean;
  /** Skipping would also close a form with typing in it. */
  formTyping: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkipStep: () => void;
  onRetry: () => void;
  onReturn: () => void;
  onFocusTarget: () => void;
  /** The box ended up over the highlighted control (phones): the runner scrolls it clear. */
  onCovered: (popover: DOMRect) => void;
  onExit: () => void;
  onLeaveAnyway: () => void;
  onCancelLeave: () => void;
  onAskSkip: () => void;
  onCancelSkip: () => void;
  onSkipLesson: () => void;
  onBackToLearn: () => void;
  onNextLesson: () => void;
}

type Side = 'below' | 'above' | 'right' | 'left' | 'corner';
const GAP = PAD + 12;
/** The app's dark-mode accent is too light for white text (3.6:1); the lesson box's primary buttons use a deeper blue (5.7:1). */
const PRIMARY_DARK = 'dark:bg-[#2563c4] dark:hover:bg-[#1d4f9e]';

const overlap = (a: { top: number; left: number; bottom: number; right: number }, b: { top: number; left: number; bottom: number; right: number }) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Where the box goes beside the control: not over it, inside the screen, and over as few figures as possible. */
function placeBox(box: Box, w: number, h: number, vw: number, vh: number, keep: Side | null): Side {
  const tb = { top: box.top - PAD, left: box.left - PAD, bottom: box.top + box.height + PAD, right: box.left + box.width + PAD };
  const figures = [...document.querySelectorAll<HTMLElement>('[data-testid$="-value"], [data-figure]')].map((f) => f.getBoundingClientRect()).filter((r) => r.width && r.height);
  const rectFor = (side: Side) => {
    const left = side === 'right' ? tb.right + 12 : side === 'left' ? tb.left - 12 - w : Math.min(Math.max(8, box.left), vw - w - 8);
    const top = side === 'below' ? tb.bottom + 12 : side === 'above' ? tb.top - 12 - h : Math.min(Math.max(8, box.top), vh - h - 8);
    return { top, left, bottom: top + h, right: left + w };
  };
  const score = (side: Side) => {
    const r = rectFor(side);
    const off = r.top < 8 || r.left < 8 || r.bottom > vh - 8 || r.right > vw - 8;
    return (off ? 1e9 : 0) + overlap(r, tb) * 1000 + figures.reduce((n, f) => n + overlap(r, f), 0);
  };
  const sides: Side[] = ['below', 'above', 'right', 'left'];
  // Stay put while the current side still works (no jumping about as hints come and go).
  if (keep && keep !== 'corner' && score(keep) < 1e9 && overlap(rectFor(keep), tb) === 0) return keep;
  const best = sides.reduce((b, x) => (score(x) < score(b) ? x : b), sides[0]);
  // A control bigger than the screen leaves no room beside it: the bottom corner, over its lower part.
  return score(best) >= 1e9 ? 'corner' : best;
}

function Popover(p: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [size, setSize] = useState({ w: 352, h: 240 });
  const vp = useViewport();
  const side = useRef<{ index: number; side: Side; sheet: 'top' | 'bottom' } | null>(null);
  const coveredFor = useRef<string | null>(null);

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r && (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1)) setSize({ w: r.width, h: r.height });
    const key = `${p.index}:${p.hint ? 1 : 0}`;
    if (r && p.boxes.length && coveredFor.current !== key) {
      // Covered only when it sits over every highlighted control: with two (either one works), the
      // one left free is enough, and the page isn't scrolled away from it.
      const over = (b: Box) => r.top < b.top + b.height && r.bottom > b.top && r.left < b.left + b.width && r.right > b.left;
      if (p.boxes.every(over)) {
        coveredFor.current = key;
        p.onCovered(r);
      }
    }
  });
  // Asking "Skip this lesson?": focus goes to the answer, not back to the page.
  useEffect(() => {
    if (p.confirmSkip) ref.current?.querySelector<HTMLElement>('[data-testid="tour-skip-yes"]')?.focus();
  }, [p.confirmSkip]);
  // Asking "Leave the lesson?": focus starts on Keep going, the safe answer.
  useEffect(() => {
    if (p.confirmLeave) ref.current?.querySelector<HTMLElement>('[data-testid="tour-leave-no"]')?.focus();
  }, [p.confirmLeave]);
  // Each new step is announced, and focus moves here unless the step is about typing in a field.
  useEffect(() => {
    if (p.step.advance.kind !== 'field') titleRef.current?.focus({ preventScroll: true });
  }, [p.index, p.step.advance.kind]);

  const phone = vp.w < 640;
  let style: CSSProperties;
  let anchoredBottom = false;
  if (!p.box) {
    style = phone ? { left: 12, right: 12, bottom: 12 } : { left: (vp.w - size.w) / 2, top: Math.max(16, (vp.h - size.h) / 2) };
    anchoredBottom = phone;
  } else if (phone) {
    // A sheet at the top or bottom, whichever leaves more room, kept for the whole step.
    const roomAbove = p.box.top;
    const roomBelow = vp.h - (p.box.top + p.box.height);
    if (side.current?.index !== p.index) {
      // Stay at the same end of the screen as the last step unless that would cover this control,
      // so the box doesn't jump between top and bottom from one step to the next.
      const was = side.current?.sheet;
      const fitsTop = p.box.top >= 12 + size.h + 8;
      const fitsBottom = p.box.top + p.box.height <= vp.h - 12 - size.h - 8;
      const sheet = was === 'top' && fitsTop ? 'top' : was === 'bottom' && fitsBottom ? 'bottom' : roomAbove > roomBelow ? 'top' : 'bottom';
      side.current = { index: p.index, side: 'below', sheet };
    }
    style = side.current.sheet === 'top' ? { left: 12, right: 12, top: 12 } : { left: 12, right: 12, bottom: 12 };
    anchoredBottom = side.current.sheet === 'bottom';
  } else {
    const keep = side.current?.index === p.index ? side.current.side : null;
    const chosen = placeBox(p.box, size.w, size.h, vp.w, vp.h, keep);
    side.current = { index: p.index, side: chosen, sheet: 'bottom' };
    const b = p.box;
    const clampLeft = (x: number) => Math.min(Math.max(8, x), vp.w - size.w - 8);
    const clampTop = (y: number) => Math.min(Math.max(8, y), vp.h - size.h - 8);
    if (chosen === 'below') style = { top: b.top + b.height + GAP, left: clampLeft(b.left) };
    else if (chosen === 'above') {
      // Anchored by its bottom edge, so it grows away from the control and its buttons stay put.
      style = { bottom: vp.h - (b.top - GAP), left: clampLeft(b.left) };
      anchoredBottom = true;
    } else if (chosen === 'right') style = { top: clampTop(b.top), left: b.left + b.width + GAP };
    else if (chosen === 'left') style = { top: clampTop(b.top), left: b.left - GAP - size.w };
    else {
      style = { bottom: 16, right: 16 };
      anchoredBottom = true;
    }
  }

  const titleId = `tour-title-${p.index}`;
  const bodyId = `tour-body-${p.index}`;
  // The hint sits on the side that grows, so the buttons never move under the pointer.
  const hintEl = p.hint ? (
    <p role="alert" className={cn('rounded-lg bg-warn-soft p-2 text-xs text-warn-text', anchoredBottom ? 'mb-2' : 'mt-2')} data-testid="tour-hint">
      {p.hint}
    </p>
  ) : null;
  // The closing words match the buttons: the next unfinished lesson when there is one, "path
  // complete" only when there isn't.
  const doneText = !p.isLast
    ? ''
    : p.nextLesson
      ? ` Next on your path: “${p.nextLesson.title}”.`
      : p.pathDone
        ? ' That’s every lesson on your path — nicely done. The Learning Center has the other lessons and all the help topics whenever you need them.'
        : '';
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-tour-popover
      data-testid="tour-popover"
      data-step={p.step.id}
      data-target-found={p.box ? 'true' : p.step.target ? 'false' : 'none'}
      className={cn(
        'fixed z-[62] rounded-2xl border border-line bg-surface p-4 text-ink shadow-pop',
        phone ? 'max-h-[calc(100dvh-24px)] overflow-y-auto' : 'w-[22rem] max-w-[calc(100vw-1rem)]',
      )}
      style={style}
    >
      {anchoredBottom && hintEl}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-xs font-medium text-ink-2">
          {p.lesson.title}
          {p.lesson.practice && (
            <Badge tone="demo" className="ml-1.5">
              Practice
            </Badge>
          )}
        </p>
        <button
          type="button"
          onClick={p.onExit}
          className="-m-1 shrink-0 rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="Exit the lesson (you can resume it later)"
          data-testid="tour-exit-x"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="h-full rounded-full bg-accent" style={{ width: `${((p.index + 1) / p.total) * 100}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted" data-testid="tour-progress">
        Step {p.index + 1} of {p.total}
      </p>
      <h2 id={titleId} ref={titleRef} tabIndex={-1} className="mt-2 text-base font-semibold outline-none">
        {p.missing ? 'This part of the screen isn’t showing' : p.offRoute ? 'This step is on another page' : p.title}
      </h2>
      <p id={bodyId} className="mt-1 text-sm text-ink-2" data-testid="tour-body">
        {p.missing
          ? 'StockPilot can’t find what this step points at — the page may have changed, or a form was closed. Try again, skip this step, or exit and resume later.'
          : p.offRoute
            ? 'You moved to a different page. Go back to continue the lesson, or exit and resume later.'
            : p.body + doneText}
      </p>
      {p.step.illustrative && !p.missing && (
        <p className="mt-2">
          <Badge tone="neutral">Illustrative example</Badge>
        </p>
      )}
      <div aria-live="polite" className="sr-only">{`Step ${p.index + 1} of ${p.total}: ${p.missing ? 'This part of the screen isn’t showing' : p.title}`}</div>
      {p.box && p.step.advance.kind !== 'next' && !p.missing && (
        <button type="button" onClick={p.onFocusTarget} className="mt-2 text-xs font-medium text-accent-text underline" data-testid="tour-focus-target">
          Go to the highlighted control
        </button>
      )}
      {p.confirmLeave ? (
        <div className="mt-3 rounded-xl bg-warn-soft p-3" role="alertdialog" aria-labelledby={`tour-leave-${p.index}`} data-testid="tour-leave-confirm">
          <p id={`tour-leave-${p.index}`} className="text-sm text-ink">
            Leave the lesson? The form you’re filling in will close and what you’ve typed will be lost. Your place in the lesson is kept, so you can resume it later.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={p.onCancelLeave} className={PRIMARY_DARK} data-testid="tour-leave-no">
              Keep going
            </Button>
            <Button size="sm" onClick={p.onLeaveAnyway} data-testid="tour-leave-yes">
              Leave lesson
            </Button>
          </div>
        </div>
      ) : p.confirmSkip ? (
        <div className="mt-3 rounded-xl bg-surface-2 p-3" data-testid="tour-skip-confirm">
          <p className="text-sm text-ink">
            Skip this lesson? It’s marked as skipped, and you can take it any time from the Learning Center.
            {p.formTyping && ' The form you’re filling in will close and what you’ve typed will be lost.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={p.onSkipLesson} className={PRIMARY_DARK} data-testid="tour-skip-yes" data-autofocus>
              Skip lesson
            </Button>
            <Button size="sm" onClick={p.onCancelSkip} data-testid="tour-skip-no">
              Keep going
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-2">
            {p.index > 0 && (
              <Button size="sm" variant="ghost" onClick={p.onBack} data-testid="tour-back">
                Back
              </Button>
            )}
            {p.isLast ? (
              <>
                <Button size="sm" variant={p.nextLesson ? 'secondary' : 'primary'} onClick={p.onNext} className={p.nextLesson ? undefined : PRIMARY_DARK} data-testid="tour-finish">
                  Finish
                </Button>
                {p.nextLesson && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<GraduationCap className="size-4" />}
                    onClick={p.onNextLesson}
                    className="h-auto min-h-8 py-1 text-left whitespace-normal"
                    data-testid="tour-next-lesson"
                  >
                    Next: {p.nextLesson.title}
                  </Button>
                )}
              </>
            ) : p.missing ? (
              <>
                <Button size="sm" onClick={p.onRetry} data-testid="tour-retry">
                  Try again
                </Button>
                <Button size="sm" onClick={p.onSkipStep} data-testid="tour-skip-step">
                  Skip this step
                </Button>
              </>
            ) : p.offRoute ? (
              <Button size="sm" variant="primary" onClick={p.onReturn} className={PRIMARY_DARK} data-testid="tour-return">
                Take me back
              </Button>
            ) : (
              p.canNext && (
                <Button size="sm" variant="primary" onClick={p.onNext} className={PRIMARY_DARK} data-testid="tour-next">
                  Next
                </Button>
              )
            )}
          </div>
          {p.isLast ? (
            <Button size="sm" variant="ghost" onClick={p.onBackToLearn} data-testid="tour-back-to-learn">
              Back to Learning Center
            </Button>
          ) : (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={p.onAskSkip} data-testid="tour-skip">
                Skip lesson
              </Button>
              <Button size="sm" variant="ghost" onClick={p.onExit} data-testid="tour-exit">
                Exit
              </Button>
            </div>
          )}
        </div>
      )}
      {!anchoredBottom && hintEl}
    </div>
  );
}
