// The Learning Center's provider: starts lessons, decides which browser tab runs the active one,
// shows the welcome to new users, and renders the running lesson (TourRunner) in the owning tab.
// Progress lives in Settings.tutorial; practice lessons use the separate practice dataset.

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, MonitorSmartphone } from 'lucide-react';
import { store, useAppState } from '../data/store';
import { scannerEnabled } from '../ai/config';
import { pauseLesson, startLesson, type ActiveLesson } from './progress';
import { lessonById, pathFor } from './lessons';
import type { StaticEnv } from './types';
import { ADOPT_AFTER_MS, TAB_ID, claimLesson, hasLocks, holdsLesson, releaseLesson, subscribeOwnership, waitUntilLessonFree } from './session';
import { TourContext, saveProgress, useTour, type StartOptions, type TourApi } from './tourContext';
import { TourRunner } from './TourRunner';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';

export { useTour } from './tourContext';

const counts = (): ActiveLesson['baseline'] => {
  const d = store.getState().data;
  return { items: d.items.length, sales: d.sales.length, lots: d.lots.length, bidPlans: d.bidPlans.length };
};

export function TourProvider({ children }: { children: ReactNode }) {
  const settings = useAppState((s) => s.settings);
  const toast = useToast();
  const navigate = useNavigate();
  const progress = settings.tutorial;
  const staticEnv: StaticEnv = useMemo(() => ({ settings, scannerEnabled }), [settings]);
  const held = useSyncExternalStore(subscribeOwnership, holdsLesson, holdsLesson);
  const resumed = useRef<string | null>(null);

  const start = useCallback(
    async (lessonId: string, opts: StartOptions = {}) => {
      const lesson = lessonById(lessonId);
      if (!lesson) return;
      const reason = lesson.unavailable?.({ settings: store.getState().settings, scannerEnabled });
      if (reason) {
        toast.error(reason);
        return;
      }
      // Starting or continuing here takes the lesson over from any other StockPilot tab.
      await claimLesson(true);
      let p = store.getState().settings.tutorial;
      if (p.active && p.active.lessonId !== lessonId) p = pauseLesson(p);
      const resuming = Boolean(opts.resume && (lessonId in p.resume || p.active?.lessonId === lessonId));
      const from = resuming ? (p.active?.lessonId === lessonId ? p.active.step : p.resume[lessonId]) : 0;
      if (lesson.practice) {
        // A fresh start empties the practice records, so replaying never piles up duplicates. Resuming,
        // or going straight on from another practice lesson, keeps them (e.g. the product you just added).
        await store.enterPractice(!resuming && !opts.keepPractice);
        if (lesson.setup && store.getState().dataset === 'practice') store.update(lesson.setup);
      } else if (store.getState().dataset === 'practice') {
        await store.exitPractice();
      }
      resumed.current = resuming ? lessonId : null;
      saveProgress(startLesson(p, lessonId, counts(), from, TAB_ID));
    },
    [toast],
  );

  const api: TourApi = useMemo(
    () => ({
      progress,
      start,
      showWelcome: () => {
        saveProgress({ ...store.getState().settings.tutorial, welcome: 'pending' });
        navigate('/');
      },
      takeResumed: (lessonId) => {
        const was = resumed.current === lessonId;
        resumed.current = null;
        return was;
      },
    }),
    [progress, start, navigate],
  );

  const active = progress.active;
  const lesson = active ? lessonById(active.lessonId) : undefined;
  const mine = Boolean(active && active.owner === TAB_ID && held);

  // Which tab runs the lesson (see session.ts): hold the lock while it's ours, give it up when it
  // isn't, and adopt a lesson whose tab has gone away (closed, not just refreshing).
  const owner = active?.owner;
  const activeId = active?.lessonId;
  useEffect(() => {
    if (!activeId) {
      releaseLesson();
      return;
    }
    if (owner === TAB_ID) {
      // Ours (e.g. after a refresh of this tab): take the lock back, retrying briefly in case
      // another tab is just checking whether it's free.
      let stop = false;
      void (async () => {
        for (let i = 0; i < 8 && !stop && !(await claimLesson(false)); i++) await new Promise((r) => setTimeout(r, 150));
      })();
      return () => {
        stop = true;
      };
    }
    releaseLesson();
    if (!hasLocks()) return; // Without Web Locks: the notice offers "Continue here".
    const ctrl = new AbortController();
    void (async () => {
      for (;;) {
        await waitUntilLessonFree(ctrl.signal);
        if (ctrl.signal.aborted) return;
        // A tab that's refreshing takes its lesson straight back; one that closed doesn't.
        await new Promise((r) => setTimeout(r, ADOPT_AFTER_MS));
        if (ctrl.signal.aborted) return;
        if (!(await claimLesson(false))) continue;
        const p = store.getState().settings.tutorial;
        if (p.active && p.active.lessonId === activeId && p.active.owner !== TAB_ID) {
          saveProgress({ ...p, active: { ...p.active, owner: TAB_ID } });
        } else {
          releaseLesson();
        }
        return;
      }
    })();
    return () => ctrl.abort();
  }, [activeId, owner]);

  return (
    <TourContext.Provider value={api}>
      {children}
      {active && lesson ? (
        mine ? (
          <TourRunner key={lesson.id} lesson={lesson} active={active} staticEnv={staticEnv} />
        ) : active.owner === TAB_ID ? null /* this tab's lesson, taking its lock back (e.g. after a refresh) */ : (
          <OtherTabNotice title={lesson.title} onContinue={() => void start(lesson.id, { resume: true })} />
        )
      ) : (
        progress.welcome === 'pending' && <Welcome staticEnv={staticEnv} />
      )}
    </TourContext.Provider>
  );
}

/** Shown in every other StockPilot tab while a lesson runs in one of them. */
function OtherTabNotice({ title, onContinue }: { title: string; onContinue: () => void }) {
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(84px+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3 text-sm text-ink shadow-pop lg:bottom-4"
      data-testid="tour-other-tab"
    >
      <MonitorSmartphone className="size-4 shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1">
        The lesson <strong>“{title}”</strong> is running in another StockPilot tab. It stays where it is there.
      </span>
      <Button size="sm" onClick={onContinue} data-testid="tour-continue-here">
        Continue it here
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------------------------

function Welcome({ staticEnv }: { staticEnv: StaticEnv }) {
  const { start } = useTour();
  const toast = useToast();
  const first = pathFor(staticEnv)[0];
  const collector = staticEnv.settings.mode === 'collector';
  const skip = () => {
    saveProgress({ ...store.getState().settings.tutorial, welcome: 'skipped' });
    toast.info('You can start a lesson any time from the Learning Center.');
  };
  return (
    <Dialog
      open
      onClose={skip}
      title="Welcome to StockPilot!"
      description={
        collector
          ? 'Let’s show you how to catalog your collection, keep track of what you paid and what it may be worth, and record sales if you make them.'
          : 'Let’s show you how to manage inventory, track sales, and understand your business’s profits.'
      }
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
              saveProgress({ ...store.getState().settings.tutorial, welcome: 'started' });
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
        The tour points at the real buttons and fields, one step at a time. Practice steps use sample records, so your own {collector ? 'collection is' : 'data is'} never changed.
        You can leave whenever you like (Esc or Exit) and pick up later from the Learning Center.
      </p>
    </Dialog>
  );
}
