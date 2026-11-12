// Small pieces shared by the Performance pages: signed amounts, difference colors, comparison bars.

import type { ReactNode } from 'react';
import { STAGE_LABELS, type LotStage, type PerfRow } from '../../insights/performance';
import { formatMoney } from '../../domain/money';
import type { Tone } from '../../ui/Badge';
import { cn } from '../../ui/cn';

export const STAGE_TONES: Record<LotStage, Tone> = { not_selling: 'neutral', partial: 'accent', sold_out: 'good', closed: 'warn' };
export { STAGE_LABELS };

export function signedMoney(n: number, currency: string): string {
  if (Math.round(n * 100) === 0) return formatMoney(0, currency);
  return `${n > 0 ? '+' : '−'}${formatMoney(Math.abs(n), currency)}`;
}

export function signedPct(n: number | null, unit = '%'): string {
  if (n === null) return '—';
  if (Math.round(n * 100) === 0) return `0${unit}`;
  return `${n > 0 ? '+' : '−'}${Math.abs(n)}${unit}`;
}

export const pctText = (n: number | null) => (n === null ? '—' : `${n}%`);

/** Green when the difference is good for the user, red when bad, neutral when zero. */
export function diffTone(row: Pick<PerfRow, 'better' | 'difference'>): string {
  if (row.difference === null || Math.round(row.difference * 100) === 0) return 'text-ink-2';
  const good = row.better === 'higher' ? row.difference > 0 : row.difference < 0;
  return good ? 'text-good-text' : 'text-bad-text';
}

/** Two bars, predicted and actual (or projected), scaled to the larger. Decorative: the numbers are in the text. */
export function CompareBars({ predicted, actual, actualLabel }: { predicted: number; actual: number; actualLabel: string }) {
  const max = Math.max(Math.abs(predicted), Math.abs(actual), 0.01);
  const w = (n: number) => `${Math.max(2, (Math.abs(n) / max) * 100)}%`;
  return (
    <div className="mt-1 space-y-1" aria-hidden>
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[10px] text-muted">Predicted</span>
        <div className="h-2 flex-1 rounded-full bg-surface-2">
          <div className="h-2 rounded-full bg-muted/60" style={{ width: w(predicted) }} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[10px] text-muted">{actualLabel}</span>
        <div className="h-2 flex-1 rounded-full bg-surface-2">
          <div className={cn('h-2 rounded-full', actual < 0 ? 'bg-bad' : 'bg-accent')} style={{ width: w(actual) }} />
        </div>
      </div>
    </div>
  );
}

export function Figure({ label, value, sub, testId, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; testId?: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 p-3" data-testid={testId}>
      <div className="text-xs text-ink-2">{label}</div>
      <div className={cn('tabular mt-0.5 text-lg font-semibold break-words', tone === 'bad' ? 'text-bad-text' : tone === 'good' ? 'text-good-text' : 'text-ink')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}
