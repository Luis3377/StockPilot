// The Learning Center: your learning path for this mode, every lesson grouped by topic (start,
// resume, replay, with what's done), and a searchable glossary. Lessons run with the same
// guided-tour engine on the real app.

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, CirclePlay, GraduationCap, RotateCcw } from 'lucide-react';
import { useAppState } from '../data/store';
import { scannerEnabled } from '../ai/config';
import { modeInfo } from '../lib/modes';
import { lessonsFor, pathFor, stepsFor } from '../learn/lessons';
import { HELP_TOPICS } from '../learn/help';
import { lessonStatus } from '../learn/progress';
import { GROUP_LABELS, type Lesson, type LessonGroup, type StaticEnv } from '../learn/types';
import { useTour } from '../learn/TourProvider';
import { Card, PageHeader, SectionHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Fields';
import { cn } from '../ui/cn';

const GROUPS: LessonGroup[] = ['basics', 'sales', 'buying', 'insights', 'reporting'];

export function LearnPage() {
  const settings = useAppState((s) => s.settings);
  const { progress, start, showWelcome } = useTour();
  const [params] = useSearchParams();
  const [query, setQuery] = useState('');
  const env = useMemo(() => ({ settings, scannerEnabled }), [settings]);
  const lessons = lessonsFor(env);
  const path = pathFor(env);
  const q = query.trim().toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);
  const shownLessons = lessons.filter((l) => match(`${l.title} ${l.summary} ${GROUP_LABELS[l.group]}`));
  const topics = HELP_TOPICS.filter((t) => match(`${t.term} ${t.text} ${t.keywords ?? ''}`));
  const focusTopic = params.get('topic');
  const done = path.filter((l) => l.id in progress.completed).length;

  // Opened from a help icon: show that topic (after the page's own scroll-to-top) and move focus to it.
  useEffect(() => {
    if (!focusTopic) return;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`topic-${focusTopic}`);
      el?.scrollIntoView({ block: 'center' });
      el?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusTopic]);

  return (
    <>
      <PageHeader
        title="Learning Center"
        description="Short, hands-on lessons that point at the real buttons and fields. Practice lessons use sample records, so your own data is never changed."
        actions={
          <Button icon={<RotateCcw className="size-4" />} onClick={showWelcome} data-testid="learn-welcome">
            Show the welcome again
          </Button>
        }
      />

      <Card className="mb-4 p-4 sm:p-5" data-testid="learn-path">
        <SectionHeader
          title={`Your path: ${modeInfo(settings.mode).name}`}
          description={`${done} of ${path.length} lessons done. Lessons are suggested for your mode; you can take any of them, in any order.`}
        />
        <ol className="mt-3 space-y-2">
          {path.map((l, i) => (
            <LessonRow key={l.id} lesson={l} number={i + 1} env={env} />
          ))}
        </ol>
      </Card>

      <div className="mb-4 max-w-md">
        <TextField label="Search lessons and help topics" type="search" value={query} onChange={setQuery} placeholder="e.g. profit, backup, bulk lot" data-testid="learn-search" />
      </div>

      {GROUPS.map((g) => {
        const inGroup = shownLessons.filter((l) => l.group === g);
        if (!inGroup.length) return null;
        return (
          <Card key={g} className="mb-4 p-4 sm:p-5" data-testid={`learn-group-${g}`}>
            <SectionHeader title={GROUP_LABELS[g]} />
            <ul className="mt-3 space-y-2">
              {inGroup.map((l) => (
                <LessonRow key={l.id} lesson={l} env={env} />
              ))}
            </ul>
          </Card>
        );
      })}
      {!shownLessons.length && q && <p className="mb-4 text-sm text-ink-2">No lessons match “{query}”.</p>}

      <Card className="mb-4 p-4 sm:p-5" data-testid="learn-topics">
        <SectionHeader title="Help topics" description="What StockPilot’s figures mean and how they’re worked out." />
        {topics.length ? (
          <dl className="mt-3 divide-y divide-line">
            {topics.map((t) => (
              <div key={t.id} id={`topic-${t.id}`}
                tabIndex={-1} className={cn('scroll-mt-24 py-2.5 outline-none', focusTopic === t.id && 'rounded-lg bg-accent-soft/40 px-2')} data-testid="learn-topic">
                <dt className="text-sm font-semibold text-ink">{t.term}</dt>
                <dd className="mt-0.5 text-sm text-ink-2">
                  {t.text}
                  {t.lesson && lessons.some((l) => l.id === t.lesson) && (
                    <button type="button" className="ml-1 font-medium text-accent-text underline" onClick={() => void start(t.lesson!)}>
                      Show me
                    </button>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 text-sm text-ink-2">No help topics match “{query}”.</p>
        )}
      </Card>
    </>
  );
}

function LessonRow({ lesson, number, env }: { lesson: Lesson; number?: number; env: StaticEnv }) {
  const { progress, start } = useTour();
  const status = lessonStatus(progress, lesson.id);
  const total = stepsFor(lesson, env).length;
  const reason = lesson.unavailable?.(env) ?? null;
  const at = progress.active?.lessonId === lesson.id ? progress.active.step : progress.resume[lesson.id];
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3" data-testid="learn-lesson" data-lesson={lesson.id} data-status={status}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
          {number !== undefined && <span className="text-muted">{number}.</span>}
          {lesson.title}
          {lesson.practice && <Badge tone="demo">Practice</Badge>}
          {lesson.id in progress.completed && (
            <Badge tone="good" icon={<CheckCircle2 className="size-3" />}>
              Completed
            </Badge>
          )}
          {status === 'in_progress' && (
            <Badge tone="accent">
              In progress · step {(at ?? 0) + 1} of {total}
            </Badge>
          )}
          {status === 'skipped' && <Badge tone="neutral">Skipped</Badge>}
        </p>
        <p className="text-xs text-ink-2">
          {lesson.summary} · about {lesson.minutes} min
        </p>
        {reason && <p className="mt-0.5 text-xs text-warn-text">{reason}</p>}
      </div>
      <div className="flex gap-2">
        {status === 'in_progress' && (
          <Button
            size="sm"
            variant="primary"
            icon={<CirclePlay className="size-4" />}
            onClick={() => void start(lesson.id, { resume: true })}
            disabled={!!reason}
            data-testid="learn-resume"
          >
            Resume
          </Button>
        )}
        <Button
          size="sm"
          variant={status === 'in_progress' ? 'secondary' : 'primary'}
          icon={status === 'completed' ? <RotateCcw className="size-4" /> : <GraduationCap className="size-4" />}
          onClick={() => void start(lesson.id)}
          disabled={!!reason}
          aria-label={`${status === 'completed' ? 'Replay' : status === 'in_progress' ? 'Start over' : 'Start'}: ${lesson.title}`}
          data-testid="learn-start"
        >
          {status === 'completed' ? 'Replay' : status === 'in_progress' ? 'Start over' : 'Start'}
        </Button>
      </div>
    </li>
  );
}
