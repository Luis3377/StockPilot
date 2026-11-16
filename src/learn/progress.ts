// Tutorial progress: which lessons are done or skipped, where an unfinished one stopped, and
// whether the welcome was seen. Kept in Settings (so it's in backups), never in the financial
// records. Pure functions: the tour engine and the Learning Center only call these.

export type WelcomeState = 'pending' | 'started' | 'skipped' | 'seen';

export interface ActiveLesson {
  lessonId: string;
  step: number;
  /** Counts in the practice dataset when the lesson started, so "you added an item" means a new one. */
  baseline: { items: number; sales: number; lots: number; bidPlans: number };
  /** The browser tab running it: only that tab moves it on (see session.ts). Missing in older saves. */
  owner?: string;
}

export interface TutorialProgress {
  welcome: WelcomeState;
  /** lessonId → when it was completed (ISO). */
  completed: Record<string, string>;
  /** Lessons the user chose to skip (not shown as "to do" in the welcome path). */
  skipped: string[];
  /** Where unfinished lessons stopped (lessonId → step index), for "Resume". */
  resume: Record<string, number>;
  /** The lesson running now (survives a page refresh). */
  active: ActiveLesson | null;
}

export function defaultTutorial(onboarded = false): TutorialProgress {
  // People who used StockPilot before the Learning Center existed aren't shown the welcome again.
  return {
    welcome: onboarded ? 'seen' : 'pending',
    completed: {},
    skipped: [],
    resume: {},
    active: null,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const WELCOME: WelcomeState[] = ['pending', 'started', 'skipped', 'seen'];
const ID = /^[a-z0-9-]{1,60}$/;

export function sanitizeTutorial(raw: unknown, onboarded: boolean): TutorialProgress {
  if (!isObj(raw)) return defaultTutorial(onboarded);
  const completed: Record<string, string> = {};
  if (isObj(raw.completed)) for (const [k, v] of Object.entries(raw.completed)) if (ID.test(k) && typeof v === 'string') completed[k] = v.slice(0, 40);
  const resume: Record<string, number> = {};
  if (isObj(raw.resume))
    for (const [k, v] of Object.entries(raw.resume)) if (ID.test(k) && Number.isInteger(v) && (v as number) >= 0 && (v as number) < 200) resume[k] = v as number;
  const a = raw.active;
  const b = isObj(a) && isObj(a.baseline) ? a.baseline : {};
  const n = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);
  const active: ActiveLesson | null =
    isObj(a) && typeof a.lessonId === 'string' && ID.test(a.lessonId) && Number.isInteger(a.step) && (a.step as number) >= 0
      ? {
          lessonId: a.lessonId,
          step: a.step as number,
          baseline: {
            items: n(b.items),
            sales: n(b.sales),
            lots: n(b.lots),
            bidPlans: n(b.bidPlans),
          },
          ...(typeof a.owner === 'string' && /^[a-z0-9]{1,20}$/.test(a.owner) ? { owner: a.owner } : {}),
        }
      : null;
  return {
    welcome: WELCOME.includes(raw.welcome as WelcomeState) ? (raw.welcome as WelcomeState) : onboarded ? 'seen' : 'pending',
    completed,
    skipped: Array.isArray(raw.skipped) ? [...new Set(raw.skipped.filter((x): x is string => typeof x === 'string' && ID.test(x)))].slice(0, 100) : [],
    resume,
    active,
  };
}

export function startLesson(p: TutorialProgress, lessonId: string, baseline: ActiveLesson['baseline'], fromStep = 0, owner?: string): TutorialProgress {
  return {
    ...p,
    active: { lessonId, step: fromStep, baseline, ...(owner ? { owner } : {}) },
    skipped: p.skipped.filter((x) => x !== lessonId),
  };
}

export function goToStep(p: TutorialProgress, step: number): TutorialProgress {
  return p.active ? { ...p, active: { ...p.active, step: Math.max(0, step) } } : p;
}

/** Stops the running lesson, remembering where it was so it can be resumed. */
export function pauseLesson(p: TutorialProgress): TutorialProgress {
  if (!p.active) return p;
  return {
    ...p,
    active: null,
    resume: { ...p.resume, [p.active.lessonId]: p.active.step },
  };
}

export function completeLesson(p: TutorialProgress, at: string): TutorialProgress {
  if (!p.active) return p;
  const { [p.active.lessonId]: _done, ...resume } = p.resume;
  void _done;
  return {
    ...p,
    active: null,
    resume,
    completed: { ...p.completed, [p.active.lessonId]: at },
  };
}

/** The user chose to skip this lesson: it ends, and isn't offered as "next" again. */
export function skipLesson(p: TutorialProgress): TutorialProgress {
  if (!p.active) return p;
  const id = p.active.lessonId;
  const { [id]: _r, ...resume } = p.resume;
  void _r;
  return {
    ...p,
    active: null,
    resume,
    skipped: [...new Set([...p.skipped, id])],
  };
}

export type LessonStatus = 'completed' | 'in_progress' | 'skipped' | 'not_started';

export function lessonStatus(p: TutorialProgress, lessonId: string): LessonStatus {
  if (p.active?.lessonId === lessonId || lessonId in p.resume) return 'in_progress';
  if (lessonId in p.completed) return 'completed';
  if (p.skipped.includes(lessonId)) return 'skipped';
  return 'not_started';
}
