// Shapes of Learning Center lessons. A lesson is data: the tour engine reads it, highlights the
// real control on the real page, and moves on only when the step's own check passes.

import type { AppData, Settings, UserMode } from '../domain/types';
import type { ActiveLesson } from './progress';

export interface LessonEnv {
  data: AppData;
  settings: Settings;
  /** Current route, e.g. "/inventory". */
  path: string;
  /** Practice-dataset counts when the lesson started. */
  baseline: ActiveLesson['baseline'];
  scannerEnabled: boolean;
  /** Whether an element is on screen (e.g. a dialog opened). */
  has: (selector: string) => boolean;
}

/**
 * Where a step points. A CSS selector, or `label:Item name` (the form control with that label),
 * or `button:Add item|Add your first item` (a button or link with that text). Prefix
 * `<css> >> ` to search inside an element. Several alternatives: the first visible one wins.
 */
export type TargetSpec = string | string[];

export type StepAdvance =
  /** Explanations: the user presses Next. */
  | { kind: 'next' }
  /** The user clicks the highlighted control (a click elsewhere never counts). `orNext`: the action is optional. */
  | { kind: 'click'; orNext?: boolean }
  /** Something the app can verify happened (a dialog opened, an item was saved, a page opened). */
  | { kind: 'when'; check: (env: LessonEnv) => boolean }
  /** A form field: Next becomes available once the value is valid; leaving the field with a valid value moves on. */
  | { kind: 'field'; valid: (value: string) => boolean; invalid: string };

export interface LessonStep {
  id: string;
  title: string;
  /** Plain English: what to do, and why it matters. */
  body: string;
  /** The page this step is on. The tour opens it when the step starts (if the user isn't there already). */
  route?: string;
  /** Leave out for a message in the middle of the screen. */
  target?: TargetSpec;
  advance: StepAdvance;
  /** If the page was refreshed on this step (its dialog is gone), restart from this step id. */
  resumeAt?: string;
  /** Skip without a fuss when the target isn't on screen (a field only some modes show). */
  optional?: boolean;
  /** Already done (e.g. the form was submitted early): move past this step. */
  skipIf?: (env: LessonEnv) => boolean;
  /** Only in some situations (a mode, the AI scanner being available). */
  include?: (env: StaticEnv) => boolean;
  /** Example figures: marked "Illustrative example" so no one mistakes them for their own numbers. */
  illustrative?: boolean;
}

/** What a lesson can know before it starts: the settings and whether the AI scanner exists in this build. */
export type StaticEnv = Pick<LessonEnv, 'settings' | 'scannerEnabled'>;

export type LessonGroup = 'basics' | 'sales' | 'buying' | 'insights' | 'reporting';

export const GROUP_LABELS: Record<LessonGroup, string> = {
  basics: 'Basic inventory',
  sales: 'Sales',
  buying: 'Buying intelligence',
  insights: 'Business insights',
  reporting: 'Financial reporting',
};

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  group: LessonGroup;
  /** Modes it's offered in. */
  modes: UserMode[];
  /** Runs on the practice dataset (sample records only). */
  practice: boolean;
  minutes: number;
  steps: LessonStep[];
  /** Why it can't run right now (e.g. sales tracking is off), or null. */
  unavailable?: (env: StaticEnv) => string | null;
  /** Prepares the practice dataset (e.g. a sample item to sell). Only ever runs on practice data. */
  setup?: (data: AppData) => AppData;
}
