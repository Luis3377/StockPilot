// The Learning Center: your learning path for this mode, every lesson grouped by topic (start,
// resume, replay, with what's done), lessons made for other modes, a searchable glossary, and
// what happens to practice records. Lessons run with the same guided-tour engine on the real app.

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, CirclePlay, GraduationCap, PartyPopper, RotateCcw, Trash2 } from 'lucide-react';
import { store, useAppState } from '../data/store';
import { scannerEnabled } from '../ai/config';
import { MODES, modeInfo, salesEnabled } from '../lib/modes';
import { lessonById, lessonSearchText, lessonsFor, otherModeLessons, pathFor, stepsFor } from '../learn/lessons';
import { HELP_TOPICS } from '../learn/help';
import { lessonStatus } from '../learn/progress';
import { GROUP_LABELS, type Lesson, type LessonGroup, type StaticEnv } from '../learn/types';
import { useTour } from '../learn/TourProvider';
import { Card, PageHeader, SectionHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Fields';
import { useConfirm } from '../ui/Confirm';
import { useToast } from '../ui/Toast';
import { cn } from '../ui/cn';

const GROUPS: LessonGroup[] = ['basics', 'sales', 'buying', 'insights', 'reporting'];

export function LearnPage() {
  const settings = useAppState((s) => s.settings);
  const practicing = useAppState((s) => s.dataset === 'practice');
  const { progress, start, showWelcome } = useTour();
  const confirm = useConfirm();
  const toast = useToast();
  const [params] = useSearchParams();
  const [query, setQuery] = useState('');
  const env = useMemo(() => ({ settings, scannerEnabled }), [settings]);
  const lessons = lessonsFor(env);
  const others = otherModeLessons(env);
  const path = pathFor(env);
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  // Every word has to appear somewhere in the lesson (title, summary, keywords or any step).
  const match = (s: string) => {
    const t = s.toLowerCase();
    return words.every((w) => t.includes(w));
  };
  const search = useMemo(() => new Map([...lessons, ...others].map((l) => [l.id, lessonSearchText(l, env)])), [lessons, others, env]);
  const shown = (l: Lesson) => !q || match(search.get(l.id) ?? '');
  const shownLessons = lessons.filter(shown);
  const shownOthers = others.filter(shown);
  const topics = HELP_TOPICS.filter((t) => !q || match(`${t.term} ${t.text} ${t.keywords ?? ''}`));
  const focusTopic = params.get('topic');
  const done = path.filter((l) => l.id in progress.completed).length;
  const pathComplete = path.length > 0 && done === path.length;
  // Unfinished lessons, most useful first: the one on your path that comes next.
  const unfinished = Object.keys(progress.resume)
    .map(lessonById)
    .filter((l): l is Lesson => !!l)
    .sort((a, b) => path.indexOf(a) - path.indexOf(b));

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

  const clearPractice = async () => {
    const ok = await confirm({
      title: 'Delete practice records?',
      message: 'This deletes the sample items, sales and plans made in Learning Center lessons. Your own records and the demo aren’t affected. Your lesson progress is kept.',
      confirmLabel: 'Delete practice records',
    });
    if (!ok) return;
    try {
      await store.clearPractice();
      toast.success('Practice records deleted.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The practice records could not be deleted.');
    }
  };

  return (
    <>
      <PageHeader
        title="Learning Center"
        description="Short, hands-on lessons that point at the real buttons and fields, and explain what the results mean. Practice lessons use sample records, so your own data is never changed."
        actions={
          <Button icon={<RotateCcw className="size-4" />} onClick={showWelcome} data-testid="learn-welcome">
            Show the welcome again
          </Button>
        }
      />

      {unfinished.length > 0 && !progress.active && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-accent/40 p-4" data-testid="learn-resume-card">
          <p className="min-w-0 text-sm text-ink">
            <strong>Pick up where you left off:</strong> {unfinished[0].title} (step {(progress.resume[unfinished[0].id] ?? 0) + 1} of {stepsFor(unfinished[0], env).length})
            {unfinished.length > 1 && <span className="text-ink-2"> · {unfinished.length - 1} more unfinished below</span>}
          </p>
          <Button variant="primary" icon={<CirclePlay className="size-4" />} onClick={() => void start(unfinished[0].id, { resume: true })} data-testid="learn-resume-top">
            Resume
          </Button>
        </Card>
      )}

      <Card className="mb-4 p-4 sm:p-5" data-testid="learn-path">
        <SectionHeader
          title={`Your path: ${modeInfo(settings.mode).name}`}
          description={`${done} of ${path.length} lessons done. Suggested for your mode; take them in any order.`}
        />
        {pathComplete && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-good-soft p-3 text-sm text-good-text" role="status" data-testid="learn-path-complete">
            <PartyPopper className="mt-0.5 size-4 shrink-0" aria-hidden />
            You’ve finished every lesson on your path — nicely done. Replay any lesson whenever you like, or try the ones made for other modes below.
          </p>
        )}
        <ol className="mt-3 space-y-2">
          {path.map((l, i) => (
            <LessonRow key={l.id} lesson={l} number={i + 1} env={env} />
          ))}
        </ol>
      </Card>

      <div className="mb-4 max-w-md">
        <TextField
          label="Search lessons and help topics"
          type="search"
          value={query}
          onChange={setQuery}
          placeholder="e.g. profit, backup, restore, bulk lot"
          data-testid="learn-search"
        />
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

      {shownOthers.length > 0 && (
        <Card className="mb-4 p-4 sm:p-5" data-testid="learn-other-modes">
          <SectionHeader
            title="Lessons made for other modes"
            description="You can take these too. Starting one never changes your mode; a lesson that needs a feature your setup doesn’t have says why."
          />
          <ul className="mt-3 space-y-2">
            {shownOthers.map((l) => (
              <LessonRow key={l.id} lesson={l} env={env} other />
            ))}
          </ul>
        </Card>
      )}
      {!shownLessons.length && !shownOthers.length && q && (
        <p className="mb-4 text-sm text-ink-2" data-testid="learn-no-lessons">
          No lessons match “{query}”.
        </p>
      )}

      <Card className="mb-4 p-4 sm:p-5" data-testid="learn-topics">
        <SectionHeader title="Help topics" description="What StockPilot’s figures mean and how they’re worked out." />
        {topics.length ? (
          <dl className="mt-3 divide-y divide-line">
            {topics.map((t) => {
              const lesson = t.lesson ? lessonById(t.lesson) : undefined;
              const canSee = t.where && (!t.where.needsSales || salesEnabled(settings));
              return (
                <div
                  key={t.id}
                  id={`topic-${t.id}`}
                  tabIndex={-1}
                  className={cn('scroll-mt-24 py-2.5 outline-none', focusTopic === t.id && 'rounded-lg bg-accent-soft/40 px-2')}
                  data-testid="learn-topic"
                >
                  <dt className="text-sm font-semibold text-ink">{t.term}</dt>
                  <dd className="mt-0.5 text-sm text-ink-2">
                    {t.text}
                    {(canSee || lesson) && (
                      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        {canSee && (
                          <Link to={`${t.where!.route}?help=${t.id}`} className="font-medium text-accent-text underline" data-testid="learn-topic-see">
                            See it in StockPilot
                          </Link>
                        )}
                        {lesson && !lesson.unavailable?.(env) && (
                          <button type="button" className="font-medium text-accent-text underline" onClick={() => void start(lesson.id)} data-testid="learn-topic-lesson">
                            Lesson: {lesson.title}
                          </button>
                        )}
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <p className="mt-2 text-sm text-ink-2">No help topics match “{query}”.</p>
        )}
      </Card>

      <Card className="mb-4 p-4 sm:p-5" data-testid="learn-practice-records">
        <SectionHeader title="Practice records" />
        <p className="mt-2 text-sm text-ink-2">
          Practice lessons use a separate set of sample records on this device. They stay stored after you leave a lesson (so you can resume it), are cleared each time you start a
          practice lesson over, and never appear in your own records, reports or backups.
        </p>
        <Button
          className="mt-3"
          size="sm"
          variant="ghost"
          icon={<Trash2 className="size-4" />}
          onClick={() => void clearPractice()}
          disabled={practicing}
          data-testid="learn-clear-practice"
        >
          Delete practice records
        </Button>
      </Card>
    </>
  );
}

function LessonRow({ lesson, number, env, other }: { lesson: Lesson; number?: number; env: StaticEnv; other?: boolean }) {
  const { progress, start } = useTour();
  const status = lessonStatus(progress, lesson.id);
  const total = stepsFor(lesson, env).length;
  const reason = lesson.unavailable?.(env) ?? null;
  const at = progress.active?.lessonId === lesson.id ? progress.active.step : progress.resume[lesson.id];
  const completed = lesson.id in progress.completed;
  const madeFor = other ? lesson.modes.map((m) => MODES.find((x) => x.id === m)?.name ?? m).join(', ') : null;
  const label = completed && status !== 'in_progress' ? 'Replay' : status === 'in_progress' ? 'Start over' : 'Start';
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"
      data-testid="learn-lesson"
      data-lesson={lesson.id}
      data-status={status}
      data-available={reason ? 'false' : 'true'}
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
          {number !== undefined && <span className="text-muted">{number}.</span>}
          {lesson.title}
          {lesson.practice && <Badge tone="demo">Practice</Badge>}
          {completed && (
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
          {madeFor && <Badge tone="neutral">For {madeFor} mode</Badge>}
        </p>
        <p className="text-xs text-ink-2">
          {lesson.summary} · about {lesson.minutes} min
        </p>
        {reason && (
          <p className="mt-0.5 text-xs text-warn-text" data-testid="learn-unavailable">
            Not available: {reason}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
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
          icon={completed ? <RotateCcw className="size-4" /> : <GraduationCap className="size-4" />}
          onClick={() => void start(lesson.id)}
          disabled={!!reason}
          aria-label={`${label}: ${lesson.title}`}
          data-testid="learn-start"
        >
          {label}
        </Button>
      </div>
    </li>
  );
}
