// "Learn from your results": a suggested expected scenario from the user's completed lots, with
// the lots, the sample size and the arithmetic shown. Nothing changes unless the user applies it,
// and an applied change keeps the original values (with Undo).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Undo2 } from 'lucide-react';
import { suggestAdjustments } from '../../insights/performance';
import { calculateBid } from '../../domain/bids';
import { formatDate } from '../../domain/dates';
import { newId } from '../../domain/ids';
import type { BidAdjustment, BidScenarioInputs } from '../../domain/types';
import { useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { Card, SectionHeader } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { readPercent, toBidInput, type BidDraft } from './bidDraft';

const pct = (n: number | null) => (n === null ? '—' : `${n}%`);

export function LearnCard({ draft, locked, onApply, onUndo }: { draft: BidDraft; locked: boolean; onApply: (record: BidAdjustment) => void; onUndo: (record: BidAdjustment) => void }) {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const { money } = useMoney();
  const [dismissed, setDismissed] = useState(false);
  const current: BidScenarioInputs = {
    resalePct: readPercent(draft.scenarios.expected.resalePct).value,
    unsoldPct: readPercent(draft.scenarios.expected.unsoldPct).value,
    sellingFeePct: readPercent(draft.scenarios.expected.sellingFeePct).value,
  };
  const applied = draft.adjustments;

  if (locked) {
    if (!applied.length) return null;
    return (
      <Card className="p-4" data-testid="bid-learn">
        <SectionHeader title="Adjusted from your history" />
        <AppliedList applied={applied} />
      </Card>
    );
  }

  const r = suggestAdjustments(data, settings, draft.kind, current);
  const unchanged = r.ok && r.fields.every((f) => f.suggested === f.current);
  const bidWith = (expected: BidScenarioInputs) => {
    const input = toBidInput(draft).input;
    const c = calculateBid({ ...input.assumptions, scenarios: { ...input.assumptions.scenarios, expected } });
    return c.ok ? c.scenarios.expected.maxBid : null;
  };

  return (
    <Card className="p-4" data-testid="bid-learn">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <GraduationCap className="size-4 text-accent" aria-hidden /> Learn from your results
          </span>
        }
        description="Your completed lots, compared with what you predicted for them. Past results don’t guarantee future ones."
      />
      {applied.length > 0 && <AppliedList applied={applied} onUndo={onUndo} />}
      {!r.ok ? (
        <p className="mt-2 text-sm text-ink-2" data-testid="bid-learn-insufficient">
          {r.reason}
        </p>
      ) : dismissed ? (
        <p className="mt-2 text-sm text-ink-2">Suggestion hidden for now. Your assumptions are unchanged.</p>
      ) : (
        <div className="mt-2 space-y-3 text-sm" data-testid="bid-learn-suggestion">
          <p className="text-ink">{r.summary}</p>
          {!r.consistent && <p className="text-xs text-warn-text">These lots varied a lot, so they count for half as much.</p>}
          <table className="w-full text-sm">
            <caption className="sr-only">Suggested expected scenario</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="py-1 font-medium">
                  Expected scenario
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Now
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Your lots
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Suggested
                </th>
              </tr>
            </thead>
            <tbody className="tabular">
              {r.fields.map((f) => (
                <tr key={f.field} className="border-t border-line" data-testid={`bid-learn-${f.field}`}>
                  <th scope="row" className="py-1 text-left font-normal text-ink-2">
                    {f.label}
                  </th>
                  <td className="py-1 text-right">{pct(f.current)}</td>
                  <td className="py-1 text-right text-ink-2">{pct(f.historical)}</td>
                  <td className={cn('py-1 text-right font-semibold', f.suggested !== f.current ? 'text-ink' : 'text-ink-2')}>{pct(f.suggested)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details className="text-xs text-ink-2">
            <summary className="cursor-pointer font-medium text-accent-text">How this was calculated ({r.sampleSize} lots)</summary>
            <p className="mt-1">
              Weight = {r.sampleSize} ÷ ({r.sampleSize} + 3) = {r.weight}
              {!r.consistent && ', halved because the lots disagree'}: the more completed lots, the more they count. Lower values need 3 lots; raising an estimate needs 5 consistent lots, and changes are
              capped.
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {r.fields.map((f) => (
                <li key={f.field}>{f.explanation}</li>
              ))}
            </ul>
            <p className="mt-2 font-medium text-ink">Lots used</p>
            <ul className="mt-0.5 space-y-0.5" data-testid="bid-learn-lots">
              {r.lots.map((l) => (
                <li key={l.lotId}>
                  <Link to={`/inventory/lots/${l.lotId}/performance`} className="text-accent-text hover:underline">
                    {l.name}
                  </Link>{' '}
                  ({formatDate(l.date)}): sold for {pct(l.priceRatioPct)} of the plan’s prices, {l.sellThroughPct}% sold (expected {l.predictedSellThroughPct}%), net proceeds {l.netErrorPct === null ? '—' : `${l.netErrorPct > 0 ? '+' : ''}${l.netErrorPct}%`} vs predicted
                </li>
              ))}
            </ul>
          </details>
          {unchanged ? (
            <p className="text-ink-2">Your results support this plan’s current expected scenario. Nothing to change.</p>
          ) : (
            <>
              <p className="text-ink-2" data-testid="bid-learn-effect">
                Max bid estimate with these values: <span className="font-semibold text-ink">{fmtBid(bidWith(r.suggested), money)}</span> (now {fmtBid(bidWith(current), money)}).
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => onApply({ id: newId(), at: new Date().toISOString(), basis: r.basis, sampleSize: r.sampleSize, lotIds: r.lots.map((l) => l.lotId), before: current, after: r.suggested })}
                  data-testid="bid-learn-apply"
                >
                  Use these values
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDismissed(true)} data-testid="bid-learn-dismiss">
                  Not now
                </Button>
              </div>
              <p className="text-xs text-muted">Applying changes only this plan’s expected scenario (not your resale estimates). You can still edit every value, and Undo restores the original ones.</p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

const fmtBid = (n: number | null | undefined, money: (n: number) => string) => (n === null || n === undefined ? 'no sensible bid' : money(n));

function AppliedList({ applied, onUndo }: { applied: BidAdjustment[]; onUndo?: (r: BidAdjustment) => void }) {
  return (
    <ul className="mt-2 space-y-1.5" data-testid="bid-learn-applied">
      {applied.map((a, i) => (
        <li key={a.id} className="rounded-xl bg-surface-2 p-2.5 text-xs text-ink-2">
          <p>
            <span className="font-medium text-ink">Adjusted from {a.basis}</span> on {formatDate(a.at.slice(0, 10))}: resale {pct(a.before.resalePct)} → {pct(a.after.resalePct)}, unsold{' '}
            {pct(a.before.unsoldPct)} → {pct(a.after.unsoldPct)}, fees {pct(a.before.sellingFeePct)} → {pct(a.after.sellingFeePct)}.
          </p>
          {onUndo && i === applied.length - 1 && (
            <Button size="sm" variant="ghost" className="mt-1" icon={<Undo2 className="size-3.5" />} onClick={() => onUndo(a)} data-testid="bid-learn-undo">
              Undo: back to {pct(a.before.resalePct)} / {pct(a.before.unsoldPct)} / {pct(a.before.sellingFeePct)}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
