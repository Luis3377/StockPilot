// One bulk lot: what it cost, how the cost was split, where every cent is now (sold, written
// off, still in stock), realized vs projected profit, and the history of changes.

import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, History, Layers, Pencil } from 'lucide-react';
import { lotSummary, lotTotal, METHOD_LABELS } from '../domain/lots';
import { formatDate, formatDateTime } from '../domain/dates';
import { plural } from '../domain/format';
import { multiplyMoney, toCents } from '../domain/money';
import type { LotChange } from '../domain/types';
import { useAppState } from '../data/store';
import { useMoney } from '../lib/hooks';
import { Card, PageHeader, SectionHeader } from '../ui/Card';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { CURRENT, PROJECTED, REALIZED, StatTile } from '../ui/Stat';
import { cn } from '../ui/cn';
import { useDialogs } from './dialogs/DialogHub';
import { Row, SplitCheck, UnitCost } from './lots/LotParts';

const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  purchaseDate: 'purchase date',
  source: 'where bought',
  notes: 'notes',
  purchasePrice: 'purchase price',
  extraCosts: 'additional costs',
  method: 'split method',
  estimates: 'resale estimates',
};

export function LotDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = useAppState((s) => s.data);
  const dialogs = useDialogs();
  const { money } = useMoney();
  const lot = data.lots.find((l) => l.id === id);

  if (!lot) {
    return (
      <EmptyState
        icon={<Layers className="size-6" />}
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

  const s = lotSummary(data, lot);
  const flow: [string, number, string][] = [
    ['Sold (cost of goods sold)', s.sales.costOfGoods, 'bg-good'],
    ['Written off or corrected', s.writtenOff, 'bg-warn'],
    ['Still in stock', s.remainingCost, 'bg-accent'],
  ];
  const flowTotal = s.total + s.addedLater;

  return (
    <>
      <Link to="/inventory/lots" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> All lots
      </Link>
      <PageHeader
        title={<span className="break-words">{lot.name}</span>}
        description={[lot.purchaseDate && `Bought ${formatDate(lot.purchaseDate)}`, lot.source, `Split ${METHOD_LABELS[lot.method].toLowerCase()}`].filter(Boolean).join(' · ')}
        actions={
          <Button icon={<Pencil className="size-4" />} onClick={() => dialogs.editLot(lot.id)} data-testid="lot-edit-open">
            Edit lot
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="lot-stats">
        <StatTile label="Total cost" value={money(s.total)} sub={`${money(s.purchasePrice)} price + ${money(s.extraCostsTotal)} additional`} testId="lot-stat-total" />
        <StatTile label="Items" value={plural(s.itemCount, 'item')} sub={`${plural(s.unitsBought, 'unit')} bought`} />
        <StatTile
          label="Est. resale value"
          value={money(s.estimatedResaleTotal)}
          sub={s.linesWithoutEstimate ? `${plural(s.linesWithoutEstimate, 'item')} not estimated` : 'Your estimates when bought'}
          tag={PROJECTED}
        />
        <StatTile
          label="Potential gross profit"
          value={s.potentialGrossProfit === null ? '—' : money(s.potentialGrossProfit)}
          sub="Est. resale − total cost, before selling expenses"
          tag={PROJECTED}
          testId="lot-stat-potential"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5" data-testid="lot-realized">
          <SectionHeader title="Sold so far" description="Completed sales of this lot’s items. Real money." />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <StatTile label="Units sold" value={`${s.sales.unitsSold} of ${s.unitsBought}`} tag={REALIZED} />
            <StatTile
              label="Realized profit"
              value={money(s.sales.netProfit)}
              tone={s.sales.netProfit < 0 ? 'bad' : 'default'}
              tag={REALIZED}
              sub={`${money(s.sales.revenue)} sales − ${money(s.sales.costOfGoods)} cost − ${money(s.sales.totalExpenses)} fees & shipping`}
              testId="lot-realized-profit"
            />
          </div>
        </Card>
        <Card className="p-4 sm:p-5" data-testid="lot-projected">
          <SectionHeader title="Still in stock" description="Not sold yet. Profit here is a projection." />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <StatTile label="Inventory cost" value={money(s.remainingCost)} sub={`${plural(s.unitsOnHand, 'unit')} on hand`} tag={CURRENT} testId="lot-remaining-cost" />
            <StatTile
              label="Projected gross profit"
              value={s.projectedGrossProfit === null ? '—' : money(s.projectedGrossProfit)}
              sub={
                s.projectedGrossProfit === null
                  ? 'Add estimated values to see this'
                  : `${money(s.remainingEstimatedValue)} est. value − ${money(s.remainingEstimatedCostBasis)} cost, before selling expenses${s.inStockWithoutEstimate ? ` (${plural(s.inStockWithoutEstimate, 'item')} not valued)` : ''}`
              }
              tag={PROJECTED}
            />
          </div>
        </Card>
      </div>

      <Card className="mt-4 p-4 sm:p-5" data-testid="lot-reconciliation">
        <SectionHeader title="Where the cost is now" description="Every cent of the lot’s cost is either sold, written off, or still in stock." />
        <div className="mt-3 space-y-3">
          <SplitCheck allocated={s.allocatedTotal} total={s.total} />
          {flowTotal > 0 && (
            <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              {flow.map(([label, amount, color]) => (amount > 0 ? <div key={label} className={color} style={{ width: `${(amount / flowTotal) * 100}%` }} /> : null))}
            </div>
          )}
          <div>
            <Row label="Total cost (purchase + additional)" value={money(s.total)} />
            {s.addedLater !== 0 && <Row label="Added later by restocking" value={`+ ${money(s.addedLater)}`} />}
            {flow.map(([label, amount, color]) => (
              <Row
                key={label}
                label={
                  <span className="inline-flex items-center gap-2">
                    <span className={cn('size-2.5 rounded-full', color)} aria-hidden />
                    {label}
                  </span>
                }
                value={money(amount)}
              />
            ))}
            {s.otherChanges !== 0 && <Row label="Changed outside the lot" value={money(s.otherChanges)} testId="lot-other-changes" />}
          </div>
          {s.reconciled ? (
            <p className="flex items-center gap-2 text-sm font-medium text-good-text" data-testid="lot-reconciled">
              <CheckCircle2 className="size-4" aria-hidden /> Fully reconciled: nothing lost, nothing counted twice.
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sm text-warn-text" data-testid="lot-not-reconciled">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {money(Math.abs(s.otherChanges))} of cost changed outside this lot, for example an item’s cost edited directly or an item deleted. Edit costs through “Edit lot” to keep the lot
              balanced.
            </p>
          )}
        </div>
      </Card>

      <Card className="mt-4 p-4 sm:p-5">
        <SectionHeader title="Items in this lot" description="Each item’s share of the cost, and how it’s doing." />
        <ul className="mt-3 divide-y divide-line" data-testid="lot-items">
          {s.lines.map((l) => (
            <li key={l.line.id} className="py-3" data-testid="lot-item">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                {l.item ? (
                  <Link to={`/inventory/${l.item.id}`} className="min-w-0 font-medium break-words text-accent-text hover:underline">
                    {l.name}
                  </Link>
                ) : (
                  <span className="min-w-0 font-medium break-words text-ink">
                    {l.name} <span className="text-sm font-normal text-muted">(deleted)</span>
                  </span>
                )}
                <span className="text-sm text-ink-2">
                  {l.unitsSold} sold · {l.unitsOnHand} in stock · {l.unitsBought} bought
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted">Allocated cost</dt>
                  <dd className="tabular text-ink" data-testid="lot-item-allocated">
                    {money(l.line.allocatedCost)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Cost per item</dt>
                  <dd className="tabular text-ink">
                    <UnitCost total={l.line.allocatedCost} quantity={l.line.quantity} />
                    {l.item && l.unitsOnHand > 0 && toCents(multiplyMoney(l.item.unitCost, l.line.quantity)) !== toCents(l.line.allocatedCost) && (
                      <span className="block text-xs text-muted">In stock now: {money(l.item.unitCost)} each</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Est. resale / item</dt>
                  <dd className="tabular text-ink">{l.line.estimatedUnitValue === null ? 'Not estimated' : money(l.line.estimatedUnitValue)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Realized profit</dt>
                  <dd className={cn('tabular', l.realizedProfit < 0 ? 'text-bad-text' : 'text-ink')}>{l.unitsSold ? money(l.realizedProfit) : '—'}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <SectionHeader title="Cost breakdown" />
          <div className="mt-2">
            <Row label="Purchase price" value={money(lot.purchasePrice)} />
            {lot.extraCosts.map((c) => (
              <Row key={c.id} label={c.label} value={`+ ${money(c.amount)}`} />
            ))}
            <Row label="Total cost" value={money(lotTotal(lot))} strong className="border-t border-line pt-2" />
          </div>
          {lot.notes && <p className="mt-3 text-sm whitespace-pre-wrap text-ink-2">{lot.notes}</p>}
        </Card>
        <Card className="p-4 sm:p-5" data-testid="lot-history">
          <SectionHeader title="History" description="Every change to this lot." />
          <ol className="mt-3 space-y-3">
            {[...lot.history].reverse().map((h) => (
              <HistoryEntry key={h.id} entry={h} />
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}

function HistoryEntry({ entry }: { entry: LotChange }) {
  const { money } = useMoney();
  const title =
    entry.kind === 'created'
      ? `Lot created · ${money(entry.newTotal)} split ${METHOD_LABELS[entry.newMethod].toLowerCase()}`
      : entry.kind === 'costs'
        ? `Costs changed${entry.previousTotal !== entry.newTotal ? ` · total ${money(entry.previousTotal)} → ${money(entry.newTotal)}` : ''}`
        : `Details changed: ${entry.changedFields.map((f) => FIELD_LABELS[f] ?? f).join(', ')}`;
  return (
    <li className="text-sm" data-testid="lot-history-entry">
      <div className="flex items-start gap-2">
        <History className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium text-ink">{title}</p>
          <p className="text-xs text-muted">{formatDateTime(entry.date)}</p>
          {entry.kind === 'costs' && (
            <>
              {entry.changedFields.length > 0 && <p className="mt-1 text-ink-2">Changed: {entry.changedFields.map((f) => FIELD_LABELS[f] ?? f).join(', ')}.</p>}
              {entry.previousMethod !== entry.newMethod && (
                <p className="text-ink-2">
                  Split: {METHOD_LABELS[entry.previousMethod]} → {METHOD_LABELS[entry.newMethod]}
                </p>
              )}
              {entry.lockedCost > 0 && <p className="text-ink-2">{money(entry.lockedCost)} already in completed sales or written off was left unchanged.</p>}
              {entry.lines.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-ink-2">
                  {entry.lines.map((l) => (
                    <li key={l.lineId} className="break-words">
                      {l.itemName}: {money(l.previousUnitCost)} → {money(l.newUnitCost)} per item ({plural(l.unitsAffected, 'unit')})
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {entry.note && <p className="mt-1 text-ink-2 italic">“{entry.note}”</p>}
        </div>
      </div>
    </li>
  );
}
