// The Max Bid result: the estimate, how each scenario compares, the line-by-line breakdown, what
// drives it, and how a budget or planned bid fits. Every figure comes from calculateBid.

import { useState } from 'react';
import { AlertTriangle, Calculator, Info, Lightbulb } from 'lucide-react';
import { SCENARIO_KEYS, SCENARIO_LABELS, type BidCalcResult, type BidCalculation, type BidCosts, type ScenarioResult } from '../../domain/bids';
import type { BidScenarioKey } from '../../domain/types';
import { formatPercent } from '../../domain/money';
import { useMoney } from '../../lib/hooks';
import { Card } from '../../ui/Card';
import { useRadioGroup } from '../../ui/useRadioGroup';
import { cn } from '../../ui/cn';

const pct = (n: number) => `${Number(n.toFixed(2))}%`;

export function BidResults({ result, heading = 'Maximum bid estimate', note }: { result: BidCalcResult; heading?: string; note?: React.ReactNode }) {
  const [scenario, setScenario] = useState<BidScenarioKey>('expected');
  if (!result.ok) {
    return (
      <Card className="p-4 sm:p-5" data-testid="bid-results">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <Calculator className="size-4 text-accent" aria-hidden /> {heading}
        </h2>
        <p className="mt-2 text-sm text-ink-2">To calculate it:</p>
        <ul className="mt-1 space-y-1 text-sm text-ink" data-testid="bid-missing">
          {[...new Set(Object.values(result.missing))].map((m) => (
            <li key={m} className="flex gap-1.5">
              <span aria-hidden>•</span>
              <span className="min-w-0">{m}</span>
            </li>
          ))}
        </ul>
      </Card>
    );
  }
  const s = result.scenarios[scenario];
  return (
    <Card className="p-4 sm:p-5" data-testid="bid-results">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
        <Calculator className="size-4 text-accent" aria-hidden /> {heading}
      </h2>
      {note}
      <Headline calc={result} />
      <ScenarioTable calc={result} />
      <div className="mt-4">
        <ScenarioTabs value={scenario} onChange={setScenario} />
        <Breakdown s={s} calc={result} />
      </div>
      {scenario === 'expected' && result.drivers.length > 0 && (
        <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm" data-testid="bid-drivers">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-ink">
            <Lightbulb className="size-4 shrink-0 text-accent" aria-hidden /> What drives this
          </p>
          <ol className="list-decimal space-y-0.5 pl-5 text-ink-2">
            {result.drivers.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ol>
        </div>
      )}
      <BudgetAndPlan calc={result} />
      {result.warnings.length > 0 && (
        <ul className="mt-3 space-y-1.5" data-testid="bid-warnings">
          {result.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 rounded-xl bg-warn-soft p-2.5 text-sm text-warn-text">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0">{w}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        An estimate from your own assumptions, not a guaranteed profitable price. Real prices, fees and sell-through will differ.
      </p>
    </Card>
  );
}

function Headline({ calc }: { calc: BidCalculation }) {
  const { money } = useMoney();
  const e = calc.scenarios.expected;
  if (e.maxBid === null) {
    return (
      <div className="mt-3 rounded-xl bg-bad-soft p-3 text-sm text-bad-text" role="status" data-testid="bid-no-bid">
        <p className="font-semibold">No sensible bid in the expected scenario</p>
        <p className="mt-0.5">{e.noBidReason}</p>
      </div>
    );
  }
  return (
    <div className="mt-3" data-testid="bid-headline">
      <p className="text-xs text-muted">Expected scenario · {pct(calc.targetRoiPct)} target return</p>
      <p className="tabular text-3xl font-semibold tracking-tight text-ink" data-testid="bid-max">
        {money(e.maxBid)}
      </p>
      <p className="text-sm text-ink-2">
        Maximum bid estimate.{' '}
        {e.atMaxBid!.allIn !== e.atMaxBid!.bid ? `With buying costs, you’d pay ${money(e.atMaxBid!.allIn)} in total` : `You’d pay ${money(e.atMaxBid!.allIn)} in total`}, for a potential profit of{' '}
        {money(e.atMaxBid!.profit)} ({formatPercent(e.atMaxBid!.roiPct)} ROI) if your estimates hold.
      </p>
      {e.limitedBy === 'budget' && e.recommendedBid !== null && (
        <p className="mt-2 rounded-xl bg-accent-soft/60 p-2.5 text-sm text-ink" data-testid="bid-budget-limited">
          Your budget of {money(calc.budget!)} allows a bid of up to <strong>{money(e.recommendedBid)}</strong>, below the maximum.
        </p>
      )}
      {calc.budget !== null && e.budgetBid === null && (
        <p className="mt-2 rounded-xl bg-warn-soft p-2.5 text-sm text-warn-text">Your budget of {money(calc.budget)} doesn’t cover the fixed buying costs, so it leaves nothing to bid.</p>
      )}
    </div>
  );
}

function ScenarioTable({ calc }: { calc: BidCalculation }) {
  const { money } = useMoney();
  const rows: [string, (s: ScenarioResult) => string, string?][] = [
    ['Resale value', (s) => pct(s.resalePct), 'of your estimate'],
    ['Unsold', (s) => pct(s.unsoldPct)],
    ['Selling fees', (s) => pct(s.sellingFeePct)],
    ['Expected sale proceeds', (s) => money(s.expectedSales)],
    ['Selling expenses', (s) => money(s.sellingExpenses)],
    ['Net proceeds', (s) => money(s.netProceeds)],
    ['Max all-in cost', (s) => money(s.maxAllIn)],
    ['Max bid', (s) => (s.maxBid === null ? 'None' : money(s.maxBid))],
    ['Potential profit', (s) => (s.atMaxBid ? money(s.atMaxBid.profit) : '—')],
    ['ROI', (s) => (s.atMaxBid ? formatPercent(s.atMaxBid.roiPct) : '—')],
  ];
  return (
    <div className="mt-4 overflow-x-auto" data-testid="bid-scenarios">
      <table className="w-full text-sm">
        <caption className="sr-only">Maximum bid by scenario</caption>
        <thead>
          <tr className="text-left text-xs text-muted">
            <th scope="col" className="py-1 pr-2 font-medium">
              <span className="sr-only">Figure</span>
            </th>
            {SCENARIO_KEYS.map((k) => (
              <th key={k} scope="col" className={cn('px-1.5 py-1 text-right font-medium', k === 'expected' && 'text-ink')}>
                {SCENARIO_LABELS[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map(([label, value, hint]) => (
            <tr key={label} className={cn('border-t border-line', label === 'Max bid' && 'font-semibold text-ink')} data-testid={`bid-row-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
              <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink-2">
                {label}
                {hint && <span className="block text-[11px] text-muted">{hint}</span>}
              </th>
              {SCENARIO_KEYS.map((k) => (
                <td key={k} className={cn('px-1.5 py-1.5 text-right whitespace-nowrap', k === 'expected' ? 'text-ink' : 'text-ink-2')}>
                  {value(calc.scenarios[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScenarioTabs({ value, onChange }: { value: BidScenarioKey; onChange: (k: BidScenarioKey) => void }) {
  const radio = useRadioGroup(SCENARIO_KEYS, value, onChange);
  return (
    <div role="radiogroup" aria-label="Breakdown for scenario" className="flex rounded-xl bg-surface-2 p-1 text-xs">
      {SCENARIO_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          {...radio(k)}
          onClick={() => onChange(k)}
          className={cn('flex-1 rounded-lg px-2 py-1.5 font-medium', value === k ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink')}
        >
          {SCENARIO_LABELS[k]}
        </button>
      ))}
    </div>
  );
}

function Line({ label, value, op, strong, sub, testId }: { label: React.ReactNode; value: string; op?: string; strong?: boolean; sub?: boolean; testId?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1', strong && 'border-t border-line pt-1.5 font-semibold text-ink', sub && 'pl-3 text-xs text-muted')} data-testid={testId}>
      <span className={cn('min-w-0', !strong && !sub && 'text-ink-2')}>{label}</span>
      <span className="tabular shrink-0">
        {op && !/^\$?0\.00$|^[^0-9]*0\.00$/.test(value) && <span aria-hidden>{op} </span>}
        {value}
      </span>
    </div>
  );
}

function Breakdown({ s, calc }: { s: ScenarioResult; calc: BidCalculation }) {
  const { money } = useMoney();
  const at = s.atMaxBid;
  return (
    <div className="mt-2 text-sm" data-testid="bid-breakdown">
      <Line label="Your resale estimate" value={money(s.estimatedResale)} />
      {s.resalePct !== 100 && <Line label={`At ${pct(s.resalePct)} of your estimate`} value={money(s.scenarioResale)} />}
      <Line label={`Not expected to sell (${pct(s.unsoldPct)})`} value={money(s.unsoldValue)} op="−" />
      <Line label="Expected sale proceeds" value={money(s.expectedSales)} strong testId="bid-expected-sales" />
      <Line label={`Selling fees (${pct(s.sellingFeePct)} of sales)`} value={money(s.sellingFees)} op="−" />
      <Line label="Outbound shipping" value={money(s.shipping)} op="−" />
      <Line label="Net proceeds" value={money(s.netProceeds)} strong testId="bid-net" />
      <Line label={`Max all-in cost (÷ ${Number((1 + calc.targetRoiPct / 100).toFixed(4))} for a ${pct(calc.targetRoiPct)} return)`} value={money(s.maxAllIn)} strong testId="bid-max-all-in" />
      {at ? (
        <>
          {at.fixedCosts > 0 && <Line label="Fixed buying costs" value={money(at.fixedCosts)} op="−" />}
          {at.buyerPremium > 0 && <Line label="Buyer’s premium at this bid" value={money(at.buyerPremium)} op="−" />}
          {at.salesTax > 0 && <Line label="Sales tax at this bid" value={money(at.salesTax)} op="−" />}
          <Line label="Max bid" value={money(at.bid)} strong testId="bid-breakdown-max" />
          <Line label="All-in cost at this bid" value={money(at.allIn)} sub />
          <Line label="Potential profit (net proceeds − all-in cost)" value={money(at.profit)} sub />
          <Line label="ROI (profit ÷ all-in cost)" value={formatPercent(at.roiPct)} sub />
        </>
      ) : (
        <p className="mt-2 rounded-xl bg-bad-soft p-2.5 text-sm text-bad-text">{s.noBidReason}</p>
      )}
    </div>
  );
}

function costsText(c: BidCosts, money: (n: number) => string): string {
  const parts = [`${money(c.bid)} bid`];
  if (c.buyerPremium > 0) parts.push(`${money(c.buyerPremium)} premium`);
  if (c.salesTax > 0) parts.push(`${money(c.salesTax)} tax`);
  if (c.fixedCosts > 0) parts.push(`${money(c.fixedCosts)} fixed costs`);
  return parts.join(' + ');
}

function BudgetAndPlan({ calc }: { calc: BidCalculation }) {
  const { money } = useMoney();
  const e = calc.scenarios.expected;
  const planned = e.atPlannedBid;
  if (!planned) return null;
  const over = e.recommendedBid === null || planned.bid > e.recommendedBid;
  const overBudget = calc.budget !== null && planned.allIn > calc.budget;
  return (
    <div className={cn('mt-4 rounded-xl p-3 text-sm', over || overBudget ? 'bg-warn-soft text-warn-text' : 'bg-good-soft text-good-text')} data-testid="bid-planned">
      <p className="font-semibold">
        Your planned bid of {money(planned.bid)}{' '}
        {e.recommendedBid === null
          ? 'has no sensible maximum to compare with.'
          : over
            ? `is ${money(planned.bid - e.recommendedBid)} above the ${e.limitedBy === 'budget' ? 'bid your budget allows' : 'maximum bid estimate'}.`
            : `is within the ${e.limitedBy === 'budget' ? 'bid your budget allows' : 'maximum bid estimate'}.`}
      </p>
      <p className="mt-0.5">
        All-in: {money(planned.allIn)} ({costsText(planned, money)}).{calc.budget !== null && ` Budget: ${money(calc.budget)}${overBudget ? ', which it exceeds' : ''}.`}
      </p>
      <p className="mt-0.5">
        Potential profit if each scenario holds:{' '}
        {SCENARIO_KEYS.map((k) => {
          const p = calc.scenarios[k].atPlannedBid!;
          return `${SCENARIO_LABELS[k].toLowerCase()} ${money(p.profit)} (${formatPercent(p.roiPct)} ROI)`;
        }).join(' · ')}
      </p>
    </div>
  );
}
