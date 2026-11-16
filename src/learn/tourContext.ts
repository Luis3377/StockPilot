// The Learning Center's shared state for the tour engine and its pages.

import { createContext, useContext } from 'react';
import { store } from '../data/store';
import type { TutorialProgress } from './progress';

export interface StartOptions {
  /** Pick up where it stopped (otherwise it starts over, with clean practice records). */
  resume?: boolean;
  /** Continuing straight from another practice lesson: keep its practice records (e.g. the product you just added). */
  keepPractice?: boolean;
}

export interface TourApi {
  progress: TutorialProgress;
  /** Starts a lesson from the beginning, or resumes it where it stopped. Takes the lesson over in this tab. */
  start: (lessonId: string, opts?: StartOptions) => Promise<void>;
  /** Shows the welcome again (Learning Center → "Show the welcome again"). */
  showWelcome: () => void;
  /** Whether the running lesson was just resumed from the Learning Center (not a page refresh); asked once. */
  takeResumed: (lessonId: string) => boolean;
}

export const TourContext = createContext<TourApi | null>(null);

export function useTour(): TourApi {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour outside TourProvider');
  return ctx;
}

export const saveProgress = (t: TutorialProgress) => store.updateSettings({ tutorial: t });
