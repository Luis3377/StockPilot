// Small pieces shared by the bulk lot dialogs and pages.

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { parseMoneyInput, unitCentSplit } from '../../domain/money';
import { useMoney } from '../../lib/hooks';
import { cn } from '../../ui/cn';

export const EXTRA_COST_SUGGESTIONS = ['Shipping / freight', 'Buyer’s premium', 'Auction fees', 'Sales tax', 'Travel', 'Other'];

/** Parses a typed amount: null when empty, and an error message when it isn't a number. */
export function readMoney(text: string): { value: number | null; error?: string } {
  const v = parseMoneyInput(text);
  if (v !== null && Number.isNaN(v)) return { value: null, error: 'Enter an amount like 12.50' };
  return { value: v };
}

/** Parses a typed whole number: null when empty. */
export function readWhole(text: string): { value: number | null; error?: string } {
  if (text.trim() === '') return { value: null };
  const n = Number(text);
  if (!Number.isInteger(n)) return { value: n, error: 'Enter a whole number' };
  return { value: n };
}

/** A typed amount shown back in a field without exponents or float noise. */
export function moneyInputText(n: number | null): string {
  if (n === null) return '';
  const s = String(n);
  return s.includes('e') ? n.toFixed(8).replace(/\.?0+$/, '') : s;
}

/**
 * Cost per unit for a line total. When it doesn't divide into whole cents it shows the range
 * and exactly how the cents fall, e.g. "$3.33–$3.34 each · 1 × $3.34 + 2 × $3.33".
 */
export function UnitCost({ total, quantity, className }: { total: number; quantity: number; className?: string }) {
  const { money } = useMoney();
  const split = unitCentSplit(total, quantity);
  if (split.highUnits === 0) return <span className={className}>{money(split.low)} each</span>;
  return (
    <span className={className}>
      {money(split.low)}–{money(split.high)} each
      <span className="block text-xs text-muted">
        {split.highUnits} × {money(split.high)} + {split.lowUnits} × {money(split.low)}
      </span>
    </span>
  );
}

/** The visual "every cent is assigned" check. */
export function SplitCheck({ allocated, total, testId = 'split-check' }: { allocated: number; total: number; testId?: string }) {
  const { money } = useMoney();
  const ok = Math.round(allocated * 100) === Math.round(total * 100);
  return (
    <div
      className={cn('flex items-start gap-2.5 rounded-2xl p-3 text-sm', ok ? 'bg-good-soft text-good-text' : 'bg-bad-soft text-bad-text')}
      data-testid={testId}
      data-balanced={ok}
      role="status"
    >
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <p>
        <strong className="font-semibold">
          {money(allocated)} of {money(total)} split
        </strong>
        {ok ? ' — every cent is assigned to an item. Nothing left over, nothing added.' : ' — the split doesn’t add up. Nothing will be saved until it does.'}
      </p>
    </div>
  );
}

export function Row({ label, value, strong, className, testId }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; className?: string; testId?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1.5 text-sm', strong && 'font-semibold text-ink', className)} data-testid={testId}>
      <span className={strong ? 'text-ink' : 'text-ink-2'}>{label}</span>
      <span className="tabular text-right text-ink">{value}</span>
    </div>
  );
}
