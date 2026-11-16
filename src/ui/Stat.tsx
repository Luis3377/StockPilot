import { useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { cn } from './cn';
import { Badge, type Tone } from './Badge';
import { helpTopic } from '../learn/help';
import { useHelpParam } from '../learn/HelpTip';

interface StatTileProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tag?: { label: string; tone: Tone };
  tone?: 'default' | 'good' | 'bad' | 'warn';
  /** What the number means and how it's calculated; shown on request. */
  info?: string;
  /** A Learning Center help topic (src/learn/help.ts) explained by a "?" beside the label. */
  help?: string;
  className?: string;
  testId?: string;
}

const valueTone = { default: 'text-ink', good: 'text-good-text', bad: 'text-bad-text', warn: 'text-warn-text' };

/** A small "ⓘ" button that shows a definition inline (works with touch, keyboard and screen readers). */
export function InfoButton({ label, open, onToggle, controls, testId }: { label: string; open: boolean; onToggle: () => void; controls: string; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`What is ${label}?`}
      className="-m-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted hover:text-ink"
      data-testid={testId}
    >
      <Info className="size-3.5" />
    </button>
  );
}

export function StatTile({ label, value, sub, icon, tag, tone = 'default', info, help, className, testId }: StatTileProps) {
  const [open, setOpen] = useState(false);
  const infoId = useId();
  const ref = useRef<HTMLDivElement>(null);
  // A help topic shows the same way as a definition: the same ⓘ, opening in the tile, plus a Learning Center link.
  const topic = help ? helpTopic(help) : null;
  useHelpParam(help, () => setOpen(true), ref);
  return (
    <div ref={ref} className={cn('min-w-0 rounded-2xl border border-line bg-surface p-4 shadow-card', className)} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 items-start gap-2 text-sm leading-5 text-ink-2">
          {icon && <span className="mt-0.5 text-muted">{icon}</span>}
          <span className="min-w-0">{label}</span>
          {(info || topic) && (
            <InfoButton label={topic ? topic.term.toLowerCase() : label} open={open} onToggle={() => setOpen((v) => !v)} controls={infoId} testId={topic ? `help-${topic.id}` : undefined} />
          )}
        </div>
        {tag && <Badge tone={tag.tone}>{tag.label}</Badge>}
      </div>
      <div className={cn('mt-2 text-2xl font-semibold tracking-tight break-words', valueTone[tone])} data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-2">{sub}</div>}
      {info && !topic && (
        <p id={infoId} hidden={!open} className="mt-2 rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-ink-2" data-testid={testId ? `${testId}-info` : undefined}>
          {info}
        </p>
      )}
      {topic && (
        <div id={infoId} hidden={!open} className="mt-2 rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-ink-2" data-testid={`help-${topic.id}-text`}>
          {topic.text}{' '}
          <Link to={`/learn?topic=${topic.id}`} className="font-medium text-accent-text underline">
            More in the Learning Center
          </Link>
        </div>
      )}
    </div>
  );
}

export const REALIZED = { label: 'Realized', tone: 'good' as Tone };
export const PROJECTED = { label: 'Projected', tone: 'warn' as Tone };
export const ESTIMATED = { label: 'Estimated', tone: 'accent' as Tone };
/** A point-in-time figure (what's in stock now), as opposed to a figure for a period. */
export const CURRENT = { label: 'Today', tone: 'neutral' as Tone };

/** Signed change vs. a named earlier period, colored by whether up is good. */
export function Delta({ current, previous, format, label }: { current: number; previous: number; format: (n: number) => string; label: string }) {
  const diff = current - previous;
  if (Math.abs(diff) < 0.005) return <span className="text-ink-2">No change vs. {label}</span>;
  const up = diff > 0;
  return (
    <span className={up ? 'text-good-text' : 'text-bad-text'}>
      <span aria-hidden>{up ? '▲' : '▼'}</span> {format(Math.abs(diff))} {up ? 'more' : 'less'} than {label}
    </span>
  );
}
