// Inventory → Lots → a lot → Performance: what you predicted when you bought it (the frozen Max Bid
// estimate), what actually happened (recorded sales, costs and stock), and why they differ.

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Calculator, ChevronDown, Info, Lock, LockOpen, TrendingUp } from 'lucide-react';
import { lotPerformance, stageText, type LotPerformance, type PerfRow } from '../../insights/performance';
import { KIND_LABELS, SCENARIO_KEYS, SCENARIO_LABELS } from '../../domain/bids';
import { closeLot, reopenLot } from '../../domain/lots';
import { formatDate } from '../../domain/dates';
import { computeSale } from '../../domain/calc';
import { fromCents, toCents } from '../../domain/money';
import { plural } from '../../domain/format';
import type { BidScenarioKey } from '../../domain/types';
import { store, useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { useAction } from '../../lib/useAction';
import { Card, PageHeader, SectionHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Button, buttonClass } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { EmptyState } from '../../ui/EmptyState';
import { TextAreaField } from '../../ui/Fields';
import { useRadioGroup } from '../../ui/useRadioGroup';
import { cn } from '../../ui/cn';
import { CompareBars, diffTone, Figure, pctText, signedMoney, signedPct, STAGE_LABELS, STAGE_TONES } from './parts';

export function LotPerformancePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const [scenario, setScenario] = useState<BidScenarioKey>('expected');
  const [closing, setClosing] = useState(false);
  const run = useAction();
  const lot = data.lots.find((l) => l.id === id);
  if (!lot) {
    return (
      <EmptyState
        icon={<TrendingUp className="size-6" />}
        title="Lot not found"
        actions={
          <Button variant="primary" onClick={() => navigate('/inventory/lots')}>
            All lots
          </Button>
        }
      >
        It may have been removed by restoring a backup.
      </EmptyState>
    );
  }
  const perf = lotPerformance(data, settings, lot, { scenario });
  const { plan } = perf;

  return (
    <>
      <Link to={`/inventory/lots/${lot.id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> {lot.name}
      </Link>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STAGE_TONES[perf.stage]}>{STAGE_LABELS[perf.stage]}</Badge>
            <span className="text-xs text-muted">{perf.final ? 'Final result' : 'Not final: still selling'}</span>
          </span>
        }
        title={<span className="break-words">Performance: {lot.name}</span>}
        description={stageText(perf)}
        actions={
          <>
            <Link to="/inventory/lots/performance" className={buttonClass('secondary', 'md')}>
              <TrendingUp className="size-4" /> All lots
            </Link>
            {perf.final && !lot.closure ? null : lot.closure ? (
              <Button icon={<LockOpen className="size-4" />} onClick={() => run(() => store.commit((d) => reopenLot(d, lot.id)), 'Reopened: the result is no longer final.')} data-testid="perf-reopen">
                Reopen lot
              </Button>
            ) : (
              <Button icon={<Lock className="size-4" />} onClick={() => setClosing(true)} data-testid="perf-close">
                Close lot
              </Button>
            )}
          </>
        }
      />

      <StageNote perf={perf} />

      {plan && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-2">
            Planned with{' '}
            <Link to={`/inventory/bids/${plan.id}`} className="font-medium text-accent-text hover:underline">
              “{plan.name}”
            </Link>{' '}
            ({KIND_LABELS[plan.kind].toLowerCase()}){plan.snapshot ? `, estimate frozen ${formatDate(plan.snapshot.takenAt.slice(0, 10))}` : ''}.
          </p>
          <ScenarioChoice value={scenario} onChange={setScenario} />
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-4">
          <ComparisonTable perf={perf} />
          {perf.attribution && <WhyCard perf={perf} />}
          {!perf.final && <SoFarCard perf={perf} />}
          <SourcesCard perf={perf} />
        </div>
        <div className="space-y-4 lg:sticky lg:top-6">
          {perf.warnings.length > 0 && (
            <Card className="p-4" data-testid="perf-warnings">
              <SectionHeader title="Check these records" />
              <ul className="mt-2 space-y-1.5">
                {perf.warnings.map((w) => (
                  <li key={w} className="flex items-start gap-1.5 text-sm text-warn-text">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="min-w-0">{w}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {plan?.snapshot && <OriginalCard perf={perf} />}
        </div>
      </div>
      <CloseDialog perf={perf} open={closing} onClose={() => setClosing(false)} />
    </>
  );
}

function StageNote({ perf }: { perf: LotPerformance }) {
  const { money } = useMoney();
  const a = perf.actual;
  const text = perf.final
    ? perf.stage === 'sold_out'
      ? 'Every unit sold, so these are final results.'
      : `This lot is closed: ${a.unitsSold} unit${a.unitsSold === 1 ? '' : 's'} sold${a.unitsWrittenOff ? `, ${a.unitsWrittenOff} written off` : ''}${perf.lot.closure?.unitsOnHand ? `, ${perf.lot.closure.unitsOnHand} kept in stock and counted as unsold` : ''}. These are final results.`
    : `Still selling: ${a.unitsSold} of ${plural(a.unitsBought, 'unit')} sold. Figures marked “so far” are partial. The prediction is for the whole lot, so differences are shown against a projected final outcome (an estimate), not against what has sold so far. ${
        a.unrecovered > 0 ? `${money(a.unrecovered)} of what you paid isn’t recovered yet.` : `Net proceeds so far (${money(a.netProceeds)}) already cover what you paid (${money(a.acquisitionCost)}).`
      }`;
  return (
    <p className={cn('mb-4 flex items-start gap-2 rounded-2xl p-3 text-sm', perf.final ? 'bg-good-soft text-good-text' : 'bg-accent-soft/60 text-ink')} data-testid="perf-stage-note">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  );
}

function ScenarioChoice({ value, onChange }: { value: BidScenarioKey; onChange: (k: BidScenarioKey) => void }) {
  const radio = useRadioGroup(SCENARIO_KEYS, value, onChange);
  return (
    <div role="radiogroup" aria-label="Compare with scenario" className="flex rounded-xl bg-surface-2 p-1 text-xs">
      {SCENARIO_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          {...radio(k)}
          onClick={() => onChange(k)}
          className={cn('rounded-lg px-2.5 py-1.5 font-medium', value === k ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink')}
        >
          {SCENARIO_LABELS[k]}
        </button>
      ))}
    </div>
  );
}

function ComparisonTable({ perf }: { perf: LotPerformance }) {
  const { money, currency } = useMoney();
  const [open, setOpen] = useState<string | null>(null);
  const fmt = (r: PerfRow, n: number | null) => (n === null ? '—' : r.unit === 'money' ? money(n) : pctText(n));
  const actualHead = perf.final ? 'Actual' : 'Actual so far';
  return (
    <Card className="p-4 sm:p-5" data-testid="perf-comparison">
      <SectionHeader
        title="Predicted vs. actual"
        description={
          perf.prediction
            ? `${SCENARIO_LABELS[perf.scenario]} scenario. ${perf.final ? 'Differences are actual − predicted.' : 'Differences are projected final − predicted.'}`
            : 'No prediction for this lot: actual results from your records.'
        }
      />
      <div className="mt-3 hidden grid-cols-[1.3fr_1fr_1fr_1fr] gap-2 border-b border-line pb-1.5 text-xs font-medium text-muted sm:grid" aria-hidden>
        <span>Metric</span>
        <span className="text-right">Predicted</span>
        <span className="text-right">{perf.final ? 'Actual' : 'Actual so far → projected'}</span>
        <span className="text-right">Difference</span>
      </div>
      <ul className="divide-y divide-line" data-testid="perf-rows">
        {perf.rows.map((r) => {
          const expanded = open === r.key;
          const diff = r.difference === null ? '—' : r.unit === 'money' ? signedMoney(r.difference, currency) : signedPct(r.difference, ' pts');
          return (
            <li key={r.key} className="py-2" data-testid={`perf-row-${r.key}`}>
              <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 text-sm sm:grid-cols-[1.3fr_1fr_1fr_1fr] sm:items-baseline">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : r.key)}
                  aria-expanded={expanded}
                  className="col-span-3 flex items-center gap-1 text-left font-medium text-ink hover:text-accent-text sm:col-span-1"
                >
                  {r.label}
                  <ChevronDown className={cn('size-3.5 shrink-0 text-muted transition-transform', expanded && 'rotate-180')} aria-hidden />
                </button>
                <span className="tabular sm:text-right">
                  <span className="block text-[10px] text-muted sm:hidden">Predicted</span>
                  {fmt(r, r.predicted)}
                </span>
                <span className="tabular sm:text-right" data-testid="perf-actual">
                  <span className="block text-[10px] text-muted sm:hidden">{actualHead}</span>
                  {fmt(r, r.actual)}
                  {r.projected !== null && (
                    <span className="block text-xs text-ink-2" data-testid="perf-projected">
                      → {fmt(r, r.projected)} projected
                    </span>
                  )}
                </span>
                <span className={cn('tabular font-medium sm:text-right', diffTone(r))} data-testid="perf-diff">
                  <span className="block text-[10px] font-normal text-muted sm:hidden">Difference</span>
                  {diff}
                  {r.errorPct !== null && <span className="block text-xs font-normal">{signedPct(r.errorPct)}</span>}
                </span>
              </div>
              {r.unit === 'money' && r.predicted !== null && r.compared !== null && <CompareBars predicted={r.predicted} actual={r.compared} actualLabel={perf.final || r.key === 'acquisition' ? 'Actual' : 'Projected'} />}
              {expanded && (
                <div className="mt-2 rounded-xl bg-surface-2 p-2.5 text-xs text-ink-2" data-testid="perf-row-detail">
                  <p>{r.formula}</p>
                  {r.errorPct !== null && <p className="mt-1">Forecast error = ({perf.final ? 'actual' : 'projected'} − predicted) ÷ predicted = {signedPct(r.errorPct)}.</p>}
                  {r.predicted !== null && r.unit === 'money' && Math.round(r.predicted * 100) === 0 && <p className="mt-1">The prediction was 0, so there’s no percentage error.</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {perf.soldPrices && (
        <p className="mt-3 rounded-xl bg-surface-2 p-2.5 text-sm text-ink-2" data-testid="perf-sold-prices">
          What has sold brought <span className="font-medium text-ink">{money(perf.soldPrices.actual)}</span>; at the plan’s prices it would have brought {money(perf.soldPrices.predicted)} (
          {signedPct(perf.soldPrices.differencePct)}).
        </p>
      )}
    </Card>
  );
}

function WhyCard({ perf }: { perf: LotPerformance }) {
  const { money, currency } = useMoney();
  const at = perf.attribution!;
  return (
    <Card className="p-4 sm:p-5" data-testid="perf-why">
      <SectionHeader title="Why the result differs" description="From the predicted profit to the actual result, one recorded difference at a time. They add up exactly." />
      <div className="mt-3 text-sm">
        <div className="flex items-baseline justify-between gap-3 py-1 font-medium text-ink">
          <span>{at.startLabel}</span>
          <span className="tabular">{money(at.start)}</span>
        </div>
        <ul>
          {at.factors.map((f) => (
            <li key={f.key} className="border-t border-line py-1.5" data-testid="perf-factor">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-ink">{f.label}</span>
                <span className={cn('tabular shrink-0 font-medium', Math.round(f.amount * 100) === 0 ? 'text-ink-2' : f.amount > 0 ? 'text-good-text' : 'text-bad-text')}>{signedMoney(f.amount, currency)}</span>
              </div>
              <p className="text-xs text-ink-2">{f.detail}</p>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5 font-semibold text-ink" data-testid="perf-why-end">
          <span>Actual result (net proceeds − acquisition cost)</span>
          <span className="tabular">{money(at.end)}</span>
        </div>
        {at.notes.map((n) => (
          <p key={n} className="mt-1 text-xs text-muted">
            {n}
          </p>
        ))}
      </div>
    </Card>
  );
}

function SoFarCard({ perf }: { perf: LotPerformance }) {
  const { money } = useMoney();
  const a = perf.actual;
  const p = perf.projection!;
  return (
    <Card className="p-4 sm:p-5" data-testid="perf-so-far">
      <SectionHeader title="So far, and where it’s heading" description="Realized profit is on the units sold. The whole-lot result also counts what you paid for the units still in stock." />
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Figure label="Revenue so far" value={money(a.revenue)} sub={`${plural(a.unitsSold, 'unit')} sold`} />
        <Figure label="Cost of goods sold" value={money(a.costOfGoods)} sub="Lot shares of the units sold" />
        <Figure label="Realized profit on sold units" value={money(a.realizedProfit)} tone={a.realizedProfit < 0 ? 'bad' : undefined} testId="perf-realized" />
        <Figure label="Inventory cost still in stock" value={money(a.remainingCost)} sub={`${plural(a.unitsOnHand, 'unit')} on hand`} />
        <Figure label="Not yet recovered" value={money(a.unrecovered)} sub="What you paid − net proceeds so far" testId="perf-unrecovered" />
        <Figure label="Estimated proceeds still to come" value={money(p.remainingNet)} sub={`From ${money(p.remainingEstimate)} of your estimates`} testId="perf-remaining" />
      </div>
      <div className="mt-3 rounded-xl border border-line p-3 text-sm" data-testid="perf-projection">
        <p className="font-medium text-ink">Projected final outcome (an estimate)</p>
        <p className="mt-0.5 text-ink-2">
          Net proceeds {money(p.finalNet)} → result {money(p.finalResult)} ({pctText(p.finalRoiPct)} ROI on {money(a.acquisitionCost)}).
        </p>
        <p className="mt-1 text-xs text-muted">Net proceeds so far {money(a.netProceeds)} + {money(p.remainingNet)} estimated for what’s left, using {p.assumptions}.</p>
      </div>
    </Card>
  );
}

function SourcesCard({ perf }: { perf: LotPerformance }) {
  const { money } = useMoney();
  const data = useAppState((s) => s.data);
  const ids = new Set(perf.lot.lines.map((l) => l.itemId));
  const writeOffs = data.adjustments.filter((a) => ids.has(a.itemId) && a.source !== 'restock' && a.difference < 0);
  return (
    <Card className="p-4 sm:p-5" data-testid="perf-sources">
      <SectionHeader title="Where the actual figures come from" description={`${plural(perf.sales.length, 'recorded sale')} of this lot’s items${writeOffs.length ? ` and ${plural(writeOffs.length, 'write-off')}` : ''}.`} />
      {perf.sales.length === 0 && writeOffs.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">Nothing sold or written off yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line text-sm">
          {perf.sales.map((s) => {
            const f = computeSale(s);
            const revenue = f.revenue;
            const expenses = f.totalExpenses;
            return (
              <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5" data-testid="perf-source-sale">
                <span className="min-w-0">
                  <Link to={`/inventory/${s.itemId}`} className="font-medium text-accent-text hover:underline">
                    {s.itemName}
                  </Link>{' '}
                  <span className="text-ink-2">
                    × {s.quantity} · {formatDate(s.saleDate)}
                    {s.platform ? ` · ${s.platform}` : ''}
                  </span>
                </span>
                <span className="tabular text-ink-2">
                  {money(revenue)} − {money(expenses)} = <span className="text-ink">{money(fromCents(toCents(revenue) - toCents(expenses)))}</span>
                </span>
              </li>
            );
          })}
          {writeOffs.map((w) => (
            <li key={w.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5" data-testid="perf-source-writeoff">
              <span className="min-w-0">
                <Link to={`/inventory/${w.itemId}`} className="font-medium text-accent-text hover:underline">
                  {w.itemName}
                </Link>{' '}
                <span className="text-ink-2">
                  {Math.abs(w.difference)} written off · {formatDate(w.date.slice(0, 10))} · {w.reason}
                </span>
              </span>
              <span className="tabular text-ink-2">{money(Math.abs(w.valueDifference))} at cost</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OriginalCard({ perf }: { perf: LotPerformance }) {
  const { money } = useMoney();
  const plan = perf.plan!;
  const snap = plan.snapshot!;
  const a = snap.assumptions;
  const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
  return (
    <Card className="p-4" data-testid="perf-original">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <Calculator className="size-4 text-accent" aria-hidden /> What you believed
          </span>
        }
        description={`Your estimate when you recorded the purchase (${formatDate(snap.takenAt.slice(0, 10))}). Kept unchanged.`}
      />
      <dl className="mt-2 space-y-1 text-sm">
        {[
          ['Resale estimate', perf.prediction ? money(perf.prediction.estimate) : '—'],
          ['Selling fees (expected)', pct(a.scenarios.expected.sellingFeePct)],
          ['Shipping', a.shippingMode === 'percent' ? `${a.shippingValue ?? 0}% of sales` : `${money(a.shippingValue ?? 0)} per item sold`],
          ['Unsold allowance (expected)', pct(a.scenarios.expected.unsoldPct)],
          ['Target ROI', pct(a.targetRoiPct)],
          ['Max bid (expected)', snap.results.expected?.maxBid != null ? money(snap.results.expected.maxBid) : 'None'],
          ['Recommended bid', snap.recommendedBid != null ? money(snap.recommendedBid) : 'None'],
          ['Price you paid', plan.purchase ? money(plan.purchase.pricePaid) : '—'],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-ink-2">{k}</dt>
            <dd className="tabular text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <table className="mt-3 w-full text-xs">
        <caption className="sr-only">Original scenarios</caption>
        <thead>
          <tr className="text-left text-muted">
            <th scope="col" className="py-1 font-medium">
              <span className="sr-only">Scenario</span>
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Resale
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Unsold
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Fees
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Net
            </th>
          </tr>
        </thead>
        <tbody className="tabular">
          {SCENARIO_KEYS.map((k) => (
            <tr key={k} className="border-t border-line">
              <th scope="row" className="py-1 text-left font-normal text-ink-2">
                {SCENARIO_LABELS[k]}
              </th>
              <td className="py-1 text-right">{pct(a.scenarios[k].resalePct)}</td>
              <td className="py-1 text-right">{pct(a.scenarios[k].unsoldPct)}</td>
              <td className="py-1 text-right">{pct(a.scenarios[k].sellingFeePct)}</td>
              <td className="py-1 text-right">{snap.results[k] ? money(snap.results[k]!.netProceeds) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function CloseDialog({ perf, open, onClose }: { perf: LotPerformance; open: boolean; onClose: () => void }) {
  const { money } = useMoney();
  const run = useAction();
  const [note, setNote] = useState('');
  const [keep, setKeep] = useState(false);
  const a = perf.actual;
  const remaining = perf.summary.lines.filter((l) => l.item && l.unitsOnHand > 0);
  const close = () => {
    if (run(() => store.commit((d) => closeLot(d, perf.lot.id, note, keep)), 'Lot closed: its result is now final.')) {
      setNote('');
      setKeep(false);
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Close this lot?"
      description="Closing says you’re done selling it, so its result becomes final. You can reopen it."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={close} disabled={a.unitsOnHand > 0 && !keep} data-testid="perf-close-confirm">
            Close lot
          </Button>
        </div>
      }
      testId="perf-close-dialog"
    >
      <div className="space-y-3 text-sm">
        {a.unitsOnHand > 0 ? (
          <>
            <p className="text-ink-2">
              {plural(a.unitsOnHand, 'unit')} {a.unitsOnHand === 1 ? 'is' : 'are'} still in stock ({money(a.remainingCost)} at cost). Closing never writes them off. If they’re gone, write them off on
              each item’s page first:
            </p>
            <ul className="space-y-1">
              {remaining.map((l) => (
                <li key={l.line.id}>
                  <Link to={`/inventory/${l.item!.id}`} className="font-medium text-accent-text hover:underline" onClick={onClose}>
                    {l.name}
                  </Link>{' '}
                  <span className="text-ink-2">× {l.unitsOnHand}</span>
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-2 text-ink">
              <input type="checkbox" className="mt-0.5 size-4 accent-accent" checked={keep} onChange={(e) => setKeep(e.target.checked)} data-testid="perf-close-keep" />
              Keep them in my inventory at cost. In this lot’s final result they count as unsold.
            </label>
          </>
        ) : (
          <p className="text-ink-2">Everything has been sold or written off.</p>
        )}
        <TextAreaField label="Note (optional)" value={note} onChange={setNote} rows={2} maxLength={500} />
      </div>
    </Dialog>
  );
}
