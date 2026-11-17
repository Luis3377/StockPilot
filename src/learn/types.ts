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
  /** The text of an element on screen (e.g. a figure the step explains), or ''. */
  text: (selector: string) => string;
}

/** Wording that can depend on the mode, or use the person's own practice numbers. */
export type Text = string | ((env: LessonEnv) => string);

/**
 * Where a step points. A CSS selector, `label:Item name` (the form control with that label),
 * `field:Quantity` (that whole field: label, control, its −/+ buttons and hint), or
 * `button:Add item|Add your first item` (a button or link with that text). Prefix `<css> >> `
 * to search inside an element. Several alternatives: the first visible one wins, unless the step
 * sets `targetAll`.
 */
export type TargetSpec = string | string[];

export type StepAdvance =
  /**
   * Explanations: the user presses Next. The highlighted control is shown, not usable. `ready`:
   * Next appears only once it's true (e.g. a result is on screen).
   */
  | { kind: 'next'; ready?: (env: LessonEnv) => boolean }
  /** The user clicks the highlighted control (a click elsewhere never counts). `orNext`: the action is optional. */
  | { kind: 'click'; orNext?: boolean }
  /** Something the app can verify happened (a dialog opened, an item was saved, a page opened). */
  | { kind: 'when'; check: (env: LessonEnv) => boolean }
  /**
   * A form field: Tab, Enter or Next with a valid value moves on; an invalid one explains why.
   * `invalid` may look at the value to say what's wrong with it.
   */
  | { kind: 'field'; valid: (value: string) => boolean; invalid: string | ((value: string) => string) };

export interface LessonStep {
  id: string;
  title: Text;
  /** Plain English: what to do, and why it matters. */
  body: Text;
  /**
   * The page this step is on. The tour opens it when the step starts (if the user isn't there
   * already). May depend on the records, e.g. Monthly Close opening the practice records' month;
   * a query string is opened too, but only the path decides whether you're "on" the page.
   */
  route?: string | ((env: LessonEnv) => string);
  /** Leave out for a message in the middle of the screen. */
  target?: TargetSpec;
  /** Highlight every visible match (e.g. two buttons that both start the same thing); any of them works. */
  targetAll?: boolean;
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
  /** Extra words people might search for ("restore", "export"…). */
  keywords?: string;
  group: LessonGroup;
  /** Modes it's made for (it's on their path; other modes can still take it if the feature is there). */
  modes: UserMode[];
  /** Runs on the practice dataset (sample records only). */
  practice: boolean;
  minutes: number;
  steps: LessonStep[];
  /** Why it can't run right now (e.g. sales tracking is off), or null. */
  unavailable?: (env: StaticEnv) => string | null;
  /** Started straight after another practice lesson, it keeps that lesson's practice records (e.g. the product just added). */
  continuesPractice?: boolean;
  /**
   * Prepares the practice records when the lesson is opened part-way through (a help topic's
   * "Lesson" link opening the step that explains that figure). Only ever runs on practice data.
   */
  jumpSetup?: (data: AppData) => AppData;
  /** Prepares the practice dataset (e.g. a sample item to sell). Only ever runs on practice data. */
  setup?: (data: AppData) => AppData;
}

export type { UserMode };
