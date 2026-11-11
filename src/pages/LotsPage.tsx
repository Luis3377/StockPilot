import { Link } from 'react-router-dom';
import { ArrowLeft, Calculator, CheckCircle2, AlertTriangle, Layers, PackagePlus } from 'lucide-react';
import { lotSummary } from '../domain/lots';
import { formatDate } from '../domain/dates';
import { plural } from '../domain/format';
import { useAppState } from '../data/store';
import { useMoney } from '../lib/hooks';
import { Card, PageHeader } from '../ui/Card';
import { Button, buttonClass } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { useDialogs } from './dialogs/DialogHub';

/** Every bulk lot, newest first, with where its cost stands. */
export function LotsPage() {
  const data = useAppState((s) => s.data);
  const dialogs = useDialogs();
  const { money } = useMoney();
  const lots = [...data.lots].sort((a, b) => (b.purchaseDate ?? b.createdAt).localeCompare(a.purchaseDate ?? a.createdAt));

  return (
    <>
      <Link to="/inventory" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Inventory
      </Link>
      <PageHeader
        title="Bulk lots"
        description="Items bought together for one price, with the cost split across them."
        actions={
          <>
            <Link to="/inventory/bids" className={buttonClass('secondary', 'md')}>
              <Calculator className="size-4" /> Plan a purchase: max bid
            </Link>
            <Button variant="primary" icon={<Layers className="size-4" />} onClick={dialogs.addLot}>
              Add bulk lot
            </Button>
          </>
        }
      />
      {lots.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Layers className="size-6" />}
            title="No bulk lots yet"
            actions={
              <Button variant="primary" icon={<PackagePlus className="size-4" />} onClick={dialogs.addLot}>
                Add your first lot
              </Button>
            }
          >
            Bought a box, pallet or auction lot for one price? Add it as a lot and StockPilot splits the cost across the items, so each sale shows its real profit.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="lot-list">
          {lots.map((lot) => {
            const s = lotSummary(data, lot);
            return (
              <li key={lot.id}>
                <Link to={`/inventory/lots/${lot.id}`} className="block rounded-2xl border border-line bg-surface p-4 shadow-card hover:bg-surface-2" data-testid="lot-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold break-words text-ink">{lot.name}</h2>
                      <p className="mt-0.5 text-sm text-muted">
                        {[lot.purchaseDate && formatDate(lot.purchaseDate), lot.source].filter(Boolean).join(' · ') || 'No date or source'}
                      </p>
                    </div>
                    {s.reconciled ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-good-text">
                        <CheckCircle2 className="size-4" aria-hidden /> Reconciled
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-warn-text">
                        <AlertTriangle className="size-4" aria-hidden /> Check
                      </span>
                    )}
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted">Total cost</dt>
                      <dd className="tabular font-medium text-ink">{money(s.total)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Sold</dt>
                      <dd className="tabular font-medium text-ink">
                        {s.sales.unitsSold} of {s.unitsBought}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Realized profit</dt>
                      <dd className={s.sales.netProfit < 0 ? 'tabular font-medium text-bad-text' : 'tabular font-medium text-ink'}>{money(s.sales.netProfit)}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-muted">{plural(s.itemCount, 'item')} · {plural(s.unitsOnHand, 'unit')} in stock</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
