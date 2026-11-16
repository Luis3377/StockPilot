// The guided-tour engine. It runs one lesson at a time on top of the real app: dims the page,
// highlights the real control, shows a small popover with what to do and why, and moves on only
// when the step's own check passes (a click on the highlighted control, a verified result such
// as "the item was saved", or Next). Practice lessons switch to the separate practice dataset;
// leaving, skipping or finishing switches back. Progress lives in Settings.tutorial.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { GraduationCap, X } from 'lucide-react';
import { store, useAppState } from '../data/store';
import { scannerEnabled } from '../ai/config';
import { completeLesson, goToStep, pauseLesson, skipLesson, startLesson, type ActiveLesson, type TutorialProgress } from './progress';
import { lessonById, pathFor, practiceDetailParent, stepsFor } from './lessons';
import { resolveTarget } from './targets';
import type { Lesson, LessonEnv, LessonStep, StaticEnv } from './types';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useToast } from '../ui/Toast';
import { cn } from '../ui/cn';

interface TourApi {
  progress: TutorialProgress;
  /** Starts a lesson from the beginning, or resumes it where it stopped. */
  start: (lessonId: string, opts?: { resume?: boolean }) => Promise<void>;
  /** Shows the welcome again (Learning Center → "Show the welcome tour"). */
  showWelcome: () => void;
}

const TourContext = createContext<TourApi | null>(null);

export function useTour(): TourApi {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour outside TourProvider');
  return ctx;
}

const saveProgress = (t: TutorialProgress) => store.updateSettings({ tutorial: t });
const counts = (): ActiveLesson['baseline'] => {
  const d = store.getState().data;
  return {
    items: d.items.length,
    sales: d.sales.length,
    lots: d.lots.length,
    bidPlans: d.bidPlans.length,
  };
};

export function TourProvider({ children }: { children: ReactNode }) {
  const settings = useAppState((s) => s.settings);
  const toast = useToast();
  const navigate = useNavigate();
  const progress = settings.tutorial;
  const staticEnv: StaticEnv = useMemo(() => ({ settings, scannerEnabled }), [settings]);

  const start = useCallback(
    async (lessonId: string, opts: { resume?: boolean } = {}) => {
      const lesson = lessonById(lessonId);
      if (!lesson) return;
      const reason = lesson.unavailable?.({
        settings: store.getState().settings,
        scannerEnabled,
      });
      if (reason) {
        toast.error(reason);
        return;
      }
      let p = store.getState().settings.tutorial;
      if (p.active && p.active.lessonId !== lessonId) p = pauseLesson(p);
      const resuming = Boolean(opts.resume && lessonId in p.resume);
      const from = resuming ? p.resume[lessonId] : 0;
      if (lesson.practice) {
        // A fresh start empties the practice records, so replaying never piles up duplicates.
        await store.enterPractice(!resuming);
        if (lesson.setup && store.getState().dataset === 'practice') store.update(lesson.setup);
      } else if (store.getState().dataset === 'practice') {
        await store.exitPractice();
      }
      saveProgress(startLesson(p, lessonId, counts(), from));
    },
    [toast],
  );

  const api: TourApi = useMemo(
    () => ({
      progress,
      start,
      showWelcome: () => {
        saveProgress({
          ...store.getState().settings.tutorial,
          welcome: 'pending',
        });
        navigate('/');
      },
    }),
    [progress, start, navigate],
  );

  const active = progress.active;
  const lesson = active ? lessonById(active.lessonId) : undefined;

  return (
    <TourContext.Provider value={api}>
      {children}
      {active && lesson ? (
        <TourRunner key={lesson.id} lesson={lesson} active={active} staticEnv={staticEnv} />
      ) : (
        progress.welcome === 'pending' && <Welcome staticEnv={staticEnv} />
      )}
    </TourContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------------------------

function Welcome({ staticEnv }: { staticEnv: StaticEnv }) {
  const { start } = useTour();
  const toast = useToast();
  const first = pathFor(staticEnv)[0];
  const skip = () => {
    saveProgress({ ...store.getState().settings.tutorial, welcome: 'skipped' });
    toast.info('You can start a lesson any time from the Learning Center.');
  };
  return (
    <Dialog
      open
      onClose={skip}
      title="Welcome to StockPilot!"
      description="Let’s show you how to manage inventory, track sales, and understand your business’s profits."
      testId="tour-welcome"
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          <Button onClick={skip} data-testid="tour-welcome-skip">
            Explore on my own
          </Button>
          <Button
            variant="primary"
            icon={<GraduationCap className="size-4" />}
            onClick={() => {
              saveProgress({
                ...store.getState().settings.tutorial,
                welcome: 'started',
              });
              if (first) void start(first.id);
            }}
            data-testid="tour-welcome-start"
            data-autofocus
          >
            Start guided tour
          </Button>
        </div>
      }
    >
      <p className="text-sm text-ink-2">
        The tour points at the real buttons and fields, one step at a time. Practice steps use sample records, so your own data is never changed. You can leave whenever you like
        and pick up later from the Learning Center.
      </p>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// The running lesson
// ---------------------------------------------------------------------------------------------

const PAD = 6;
const MISSING_MS = 4000;
const OPTIONAL_MS = 700;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function fieldValue(el: HTMLElement | null): string {
  return el && 'value' in el ? String((el as HTMLInputElement).value ?? '') : '';
}

function TourRunner({ lesson, active, staticEnv }: { lesson: Lesson; active: ActiveLesson; staticEnv: StaticEnv }) {
  const steps = useMemo(() => stepsFor(lesson, staticEnv), [lesson, staticEnv]);
  const index = Math.min(active.step, steps.length - 1);
  const step = steps[index];
  const data = useAppState((s) => s.data);
  const dataset = useAppState((s) => s.dataset);
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { start } = useTour();
  // The element found for *this* step (an element found for the previous step is never used,
  // so a stale field can't complete the next step).
  const stepKey = `${lesson.id}:${index}`;
  const [found, setFound] = useState<{ key: string; el: HTMLElement | null }>({ key: '', el: null });
  const el = found.key === stepKey ? found.el : null;
  const [box, setBox] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [touched, setTouched] = useState(false);
  const missingSince = useRef<number | null>(null);
  const scrolledFor = useRef<{ key: string; count: number; at: number } | null>(null);
  const navigatedFor = useRef<string | null>(null);
  const firstRun = useRef(true);
  const carryHint = useRef<{ index: number; text: string } | null>(null);

  const env = useCallback(
    (): LessonEnv => ({
      data: store.getState().data,
      settings: store.getState().settings,
      path: location.pathname,
      baseline: active.baseline,
      scannerEnabled,
      has: (sel) => !!document.querySelector(sel),
    }),
    [location.pathname, active.baseline],
  );

  /** Moves from step `from` (ignored if the lesson has already moved on, so a double trigger is harmless). */
  const go = useCallback(
    (from: number, to: number) => {
      const p = store.getState().settings.tutorial;
      if (!p.active || p.active.step !== from) return;
      saveProgress(goToStep(p, Math.max(0, Math.min(to, steps.length - 1))));
    },
    [steps.length],
  );

  const leave = useCallback(
    async (how: 'pause' | 'skip' | 'finish') => {
      const p = store.getState().settings.tutorial;
      saveProgress(how === 'pause' ? pauseLesson(p) : how === 'skip' ? skipLesson(p) : completeLesson(p, new Date().toISOString()));
      if (lesson.practice) {
        await store.exitPractice();
        // A practice record's page (e.g. a practice Max Bid plan) doesn't exist in your own records.
        const parent = practiceDetailParent(location.pathname);
        if (parent) navigate(parent);
      }
      if (how === 'pause') toast.info('Lesson paused. Resume it any time from the Learning Center.');
      if (how === 'finish') toast.success(`Lesson complete: ${lesson.title}.`);
    },
    [lesson, toast, location.pathname, navigate],
  );

  // A practice lesson only ever runs on the practice records (e.g. after a refresh).
  useEffect(() => {
    if (lesson.practice && dataset !== 'practice') void store.enterPractice(false);
  }, [lesson.practice, dataset]);

  // After a refresh, a step inside a dialog that's gone restarts from the step that opens it.
  useEffect(() => {
    if (!firstRun.current) return;
    firstRun.current = false;
    if (step.resumeAt && !resolveTarget(step.target)) {
      const to = steps.findIndex((s) => s.id === step.resumeAt);
      if (to >= 0 && to < index) {
        carryHint.current = { index: to, text: 'The form closed when the page reloaded. Open it again to carry on — what you saved is still there.' };
        go(index, to);
      }
    }
  }, [step, steps, index, go]);

  // Each step opens its page once when it starts; after that the user can go anywhere.
  useEffect(() => {
    if (carryHint.current?.index === index) {
      setHint(carryHint.current.text);
      carryHint.current = null;
    } else setHint(null);
    setMissing(false);
    setTouched(false);
    missingSince.current = null;
    const key = `${lesson.id}:${index}`;
    if (step.route && navigatedFor.current !== key) {
      navigatedFor.current = key;
      if (location.pathname !== step.route) navigate(step.route);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id, index]);

  // Find the target, follow it as the page scrolls or resizes, and notice when it's missing.
  useEffect(() => {
    let raf = 0;
    // The highlighted element carries the step's id (for tests and assistive tech), set here so
    // it never sits on the previous step's element.
    let marked: HTMLElement | null = null;
    const mark = (found: HTMLElement | null) => {
      if (marked === found) return;
      if (marked) {
        marked.removeAttribute('data-tour-active');
        marked.style.scrollMarginTop = '';
        marked.style.scrollMarginBottom = '';
      }
      found?.setAttribute('data-tour-active', step.id);
      marked = found;
    };
    const key = `${lesson.id}:${index}`;
    const measure = () => {
      const found = resolveTarget(step.target);
      mark(found);
      setFound((prev) => (prev.key === key && prev.el === found ? prev : { key, el: found }));
      if (!step.target) {
        setBox(null);
        return;
      }
      if (found) {
        missingSince.current = null;
        setMissing(false);
        const r = found.getBoundingClientRect();
        setBox((b) =>
          b && b.top === r.top && b.left === r.left && b.width === r.width && b.height === r.height ? b : { top: r.top, left: r.left, width: r.width, height: r.height },
        );
        // Off screen, or under the sticky header or the phone's tab bar: bring it to the middle.
        // Checked when the step starts and once more a moment later (a page that was still
        // loading, or the browser restoring the scroll position after a refresh, can move it).
        const tries = scrolledFor.current?.key === key ? scrolledFor.current : { key, count: 0, at: 0 };
        if (tries.count < 2 && Date.now() - tries.at > 600) {
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height, 40) / 2);
          const hidden = r.top < 0 || r.bottom > window.innerHeight || !hit || !(found.contains(hit) || hit.closest('[data-tour-popover], [data-testid="tour-mask"]'));
          scrolledFor.current = { key, count: hidden ? tries.count + 1 : tries.count === 0 ? 1 : 2, at: Date.now() };
          if (hidden) found.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
        }
      } else {
        setBox(null);
        missingSince.current ??= Date.now();
        const waited = Date.now() - missingSince.current;
        const back = step.resumeAt ? steps.findIndex((s) => s.id === step.resumeAt) : -1;
        if (step.optional && waited > OPTIONAL_MS) go(index, index + 1);
        else if (back >= 0 && back < index && waited > OPTIONAL_MS) {
          // The form this step is in was closed: back to the step that opens it.
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
      mark(null);
      window.clearInterval(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onFrame, true);
      window.removeEventListener('resize', onFrame);
    };
  }, [step, steps, lesson.id, index, go]);


  // Escape exits the lesson when nothing else uses it (open dialogs and menus handle their own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const a = document.activeElement;
      if (!a || a === document.body || a.closest('[data-tour-popover]')) void leave('pause');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [leave]);

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

  // A click on the highlighted control completes a click step. Nothing else does.
  useEffect(() => {
    if (step.advance.kind !== 'click' || !el) return;
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Node && el.contains(e.target)) window.setTimeout(() => go(index, index + 1), 0);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [step, el, index, go]);

  // Field steps: leaving the field with a valid value moves on; focus starts in the field.
  const fieldOk = step.advance.kind === 'field' ? step.advance.valid(fieldValue(el)) : true;
  void tick;
  useEffect(() => {
    if (step.advance.kind !== 'field' || !el) return;
    const valid = step.advance.valid;
    // Moving on to another field (Tab, or a click on it) advances. Focus going to the lesson's own
    // box, or nowhere (a tap on the dimmed page, Safari button clicks), doesn't: Next does that,
    // so one action never counts twice.
    const onBlur = (e: FocusEvent) => {
      setTouched(true);
      const to = e.relatedTarget;
      if (!(to instanceof HTMLElement) || to.closest('[data-tour-popover]')) return;
      if (valid(fieldValue(el))) go(index, index + 1);
    };
    // Choosing from a list is a complete answer on its own.
    const onChange = () => {
      if (el instanceof HTMLSelectElement && valid(el.value)) window.setTimeout(() => go(index, index + 1), 0);
    };
    el.addEventListener('blur', onBlur);
    el.addEventListener('change', onChange);
    if (document.activeElement !== el && !window.matchMedia('(pointer: coarse)').matches) el.focus({ preventScroll: true });
    return () => {
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('change', onChange);
    };
  }, [step, el, index, go]);

  const isLast = index === steps.length - 1;
  const path = pathFor(staticEnv);
  const nextLesson = isLast ? path[path.findIndex((l) => l.id === lesson.id) + 1] : undefined;
  const offRoute = Boolean(step.route && location.pathname !== step.route && navigatedFor.current === `${lesson.id}:${index}`);
  const canNext = step.advance.kind === 'next' || (step.advance.kind === 'click' && step.advance.orNext) || (step.advance.kind === 'field' && fieldOk);
  // "Look" steps only point at something: the highlighted control can't be used from here, so an
  // explanation lesson never saves, imports, closes or deletes anything.
  const lookOnly = step.advance.kind === 'next';
  const onLookClick = () => setHint('This step only shows where this is. Press Next to continue.');
  const onMaskClick = () =>
    setHint(
      step.target
        ? 'That part of the screen is paused during this step. Use the highlighted area, or Exit the lesson.'
        : 'Use the buttons in this box to continue, or Exit the lesson.',
    );

  return createPortal(
    <>
      <Mask box={step.target ? box : null} onClick={onMaskClick} onLookClick={lookOnly ? onLookClick : undefined} />
      <Popover
        lesson={lesson}
        step={step}
        index={index}
        total={steps.length}
        box={step.target ? box : null}
        missing={missing}
        offRoute={offRoute}
        hint={hint}
        invalid={step.advance.kind === 'field' && touched && !fieldOk ? step.advance.invalid : null}
        canNext={canNext}
        isLast={isLast}
        nextLesson={nextLesson}
        onBack={() => go(index, index - 1)}
        onNext={() => (isLast ? void leave('finish') : step.advance.kind === 'field' && !fieldOk ? setTouched(true) : go(index, index + 1))}
        onSkipStep={() => go(index, index + 1)}
        onRetry={() => {
          missingSince.current = null;
          setMissing(false);
          if (step.route) navigate(step.route);
          else {
            const to = step.resumeAt ? steps.findIndex((s) => s.id === step.resumeAt) : -1;
            if (to >= 0) go(index, to);
          }
        }}
        onReturn={() => step.route && navigate(step.route)}
        onFocusTarget={() => {
          el?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
          el?.focus({ preventScroll: true });
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
        onExit={() => void leave('pause')}
        onSkipLesson={() => void leave('skip')}
        onNextLesson={async () => {
          await leave('finish');
          if (nextLesson) void start(nextLesson.id);
        }}
      />
    </>,
    document.body,
  );
}

function Mask({ box, onClick, onLookClick }: { box: Box | null; onClick: () => void; onLookClick?: () => void }) {
  const cls = 'fixed z-[60] bg-black/45';
  if (!box) return <div className={cn(cls, 'inset-0')} onClick={onClick} aria-hidden data-testid="tour-mask" />;
  const t = Math.max(0, box.top - PAD);
  const l = Math.max(0, box.left - PAD);
  const b = box.top + box.height + PAD;
  const r = box.left + box.width + PAD;
  return (
    <div aria-hidden data-testid="tour-mask">
      <div className={cls} style={{ top: 0, left: 0, right: 0, height: t }} onClick={onClick} />
      <div className={cls} style={{ top: b, left: 0, right: 0, bottom: 0 }} onClick={onClick} />
      <div className={cls} style={{ top: t, left: 0, width: l, height: b - t }} onClick={onClick} />
      <div className={cls} style={{ top: t, left: r, right: 0, height: b - t }} onClick={onClick} />
      {onLookClick && <div className="fixed z-[60]" style={{ top: t, left: l, width: r - l, height: b - t }} onClick={onLookClick} data-testid="tour-look-shield" />}
      <div
        className="pointer-events-none fixed z-[61] rounded-xl ring-4 ring-accent motion-safe:transition-all motion-safe:duration-150"
        style={{ top: t, left: l, width: r - l, height: b - t }}
        data-testid="tour-highlight"
      />
    </div>
  );
}

interface PopoverProps {
  lesson: Lesson;
  step: LessonStep;
  index: number;
  total: number;
  box: Box | null;
  missing: boolean;
  offRoute: boolean;
  hint: string | null;
  invalid: string | null;
  canNext: boolean;
  isLast: boolean;
  nextLesson: Lesson | undefined;
  onBack: () => void;
  onNext: () => void;
  onSkipStep: () => void;
  onRetry: () => void;
  onReturn: () => void;
  onFocusTarget: () => void;
  /** The box ended up over the highlighted control (phones): the runner scrolls it clear. */
  onCovered: (popover: DOMRect) => void;
  onExit: () => void;
  onSkipLesson: () => void;
  onNextLesson: () => void;
}

function Popover(p: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [size, setSize] = useState({ w: 340, h: 220 });
  const [vw, setVw] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () => setVw({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const coveredFor = useRef<number | null>(null);
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r && (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1)) setSize({ w: r.width, h: r.height });
    const b = p.box;
    if (r && b && coveredFor.current !== p.index) {
      const overlaps = r.top < b.top + b.height && r.bottom > b.top && r.left < b.left + b.width && r.right > b.left;
      if (overlaps) {
        coveredFor.current = p.index;
        p.onCovered(r);
      }
    }
  });
  // Each new step is announced, and focus moves here unless the step is about typing in a field.
  useEffect(() => {
    if (p.step.advance.kind !== 'field') titleRef.current?.focus({ preventScroll: true });
  }, [p.index, p.step.advance.kind]);

  const phone = vw.w < 640;
  let style: React.CSSProperties;
  if (!p.box) style = phone ? { left: 12, right: 12, bottom: 12 } : { left: (vw.w - size.w) / 2, top: Math.max(16, (vw.h - size.h) / 2) };
  else if (phone) style = p.box.top > vw.h - (p.box.top + p.box.height) ? { left: 12, right: 12, top: 12 } : { left: 12, right: 12, bottom: 12 };
  else {
    const below = p.box.top + p.box.height + PAD + 12;
    const above = p.box.top - PAD - 12 - size.h;
    const top = below + size.h < vw.h - 8 ? below : above > 8 ? above : Math.max(8, vw.h - size.h - 8);
    const left = Math.min(Math.max(8, p.box.left), vw.w - size.w - 8);
    style = { top, left };
  }

  const titleId = `tour-title-${p.index}`;
  const bodyId = `tour-body-${p.index}`;
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
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          p.onExit();
        }
      }}
      className={cn('fixed z-[62] rounded-2xl border border-line bg-surface p-4 text-ink shadow-pop', phone ? '' : 'w-[22rem] max-w-[calc(100vw-1rem)]')}
      style={style}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-ink-2">
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
          className="-m-1 rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="Exit the lesson (you can resume it later)"
          data-testid="tour-exit-x"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-1 flex items-center gap-2" aria-hidden>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent" style={{ width: `${((p.index + 1) / p.total) * 100}%` }} />
        </div>
      </div>
      <p className="mt-1 text-xs text-muted" data-testid="tour-progress">
        Step {p.index + 1} of {p.total}
      </p>
      <h2 id={titleId} ref={titleRef} tabIndex={-1} className="mt-2 text-base font-semibold outline-none">
        {p.missing ? 'This part of the screen isn’t showing' : p.offRoute ? 'This step is on another page' : p.step.title}
      </h2>
      <p id={bodyId} className="mt-1 text-sm text-ink-2" data-testid="tour-body">
        {p.missing
          ? 'StockPilot can’t find what this step points at — the page may have changed, or a form was closed. Try again, skip this step, or exit and resume later.'
          : p.offRoute
            ? 'You moved to a different page. Go back to continue the lesson, or exit and resume later.'
            : p.step.body}
      </p>
      {p.step.illustrative && !p.missing && (
        <p className="mt-2">
          <Badge tone="neutral">Illustrative example</Badge>
        </p>
      )}
      <div aria-live="polite" className="sr-only">{`Step ${p.index + 1} of ${p.total}: ${p.step.title}`}</div>
      {(p.hint || p.invalid) && (
        <p role="alert" className="mt-2 rounded-lg bg-warn-soft p-2 text-xs text-warn-text" data-testid="tour-hint">
          {p.invalid ?? p.hint}
        </p>
      )}
      {p.box && p.step.advance.kind !== 'next' && !p.missing && (
        <button type="button" onClick={p.onFocusTarget} className="mt-2 text-xs font-medium text-accent-text underline" data-testid="tour-focus-target">
          Go to the highlighted control
        </button>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {p.index > 0 && (
            <Button size="sm" variant="ghost" onClick={p.onBack} data-testid="tour-back">
              Back
            </Button>
          )}
          {p.isLast ? (
            <>
              <Button size="sm" variant={p.nextLesson ? 'secondary' : 'primary'} onClick={p.onNext} data-testid="tour-finish">
                Finish
              </Button>
              {p.nextLesson && (
                <Button size="sm" variant="primary" onClick={p.onNextLesson} data-testid="tour-next-lesson">
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
            <Button size="sm" variant="primary" onClick={p.onReturn} data-testid="tour-return">
              Take me back
            </Button>
          ) : (
            (p.canNext || p.step.advance.kind === 'field') && (
              <Button size="sm" variant="primary" onClick={p.onNext} data-testid="tour-next">
                Next
              </Button>
            )
          )}
        </div>
        {!p.isLast && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={p.onSkipLesson} data-testid="tour-skip">
              Skip lesson
            </Button>
            <Button size="sm" variant="ghost" onClick={p.onExit} data-testid="tour-exit">
              Exit
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
