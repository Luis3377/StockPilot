import type { ReactNode } from 'react';
import { cn } from './cn';
import { Badge, type Tone } from './Badge';

interface StatTileProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tag?: { label: string; tone: Tone };
  tone?: 'default' | 'good' | 'bad' | 'warn';
  className?: string;
  testId?: string;
}

const valueTone = { default: 'text-ink', good: 'text-good-text', bad: 'text-bad-text', warn: 'text-warn-text' };

export function StatTile({ label, value, sub, icon, tag, tone = 'default', className, testId }: StatTileProps) {
  return (
    <div className={cn('rounded-2xl border border-line bg-surface p-4 shadow-card', className)} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 items-start gap-2 text-sm leading-5 text-ink-2">
          {icon && <span className="mt-0.5 text-muted">{icon}</span>}
          <span>{label}</span>
        </div>
        {tag && <Badge tone={tag.tone}>{tag.label}</Badge>}
      </div>
      <div className={cn('mt-2 text-2xl font-semibold tracking-tight', valueTone[tone])} data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

export const REALIZED = { label: 'Realized', tone: 'good' as Tone };
export const PROJECTED = { label: 'Projected', tone: 'warn' as Tone };
export const ESTIMATED = { label: 'Estimated', tone: 'accent' as Tone };

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
