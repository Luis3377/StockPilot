// Every Max Bid plan, newest first, with its estimate and where the decision stands.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calculator, Plus } from 'lucide-react';
import { calculateBid, KIND_LABELS, STATUS_LABELS } from '../domain/bids';
import { formatDate } from '../domain/dates';
import type { BidPlan, BidPlanStatus } from '../domain/types';
import { useAppState } from '../data/store';
import { useMoney } from '../lib/hooks';
import { Card, PageHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { buttonClass } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { useRadioGroup } from '../ui/useRadioGroup';
import { cn } from '../ui/cn';
import { STATUS_TONES } from './BidPlanPage';

const FILTERS = ['all', 'draft', 'purchased', 'passed', 'lost'] as const;
type Filter = (typeof FILTERS)[number];

export function BidsPage() {
  const plans = useAppState((s) => s.data.bidPlans);
  const [filter, setFilter] = useState<Filter>('all');
  const radio = useRadioGroup(FILTERS, filter, setFilter);
  const shown = [...plans].filter((p) => filter === 'all' || p.status === filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const count = (s: BidPlanStatus) => plans.filter((p) => p.status === s).length;

  const newLink = (
    <Link to="/inventory/bids/new" className={buttonClass('primary', 'md')} data-testid="bid-new">
      <Plus className="size-4" /> New calculation
    </Link>
  );

  return (
    <>
      <Link to="/inventory" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Inventory
      </Link>
      <PageHeader title="Max bid calculator" description="Work out the most to pay for a lot before you buy it. Plans are estimates, not inventory or purchases." actions={newLink} />
      {plans.length === 0 ? (
        <Card>
          <EmptyState icon={<Calculator className="size-6" />} title="No bid plans yet" actions={newLink}>
            Going to a storage-unit auction, buying a pallet or an estate-sale lot? Enter what you think the contents would sell for, your costs and the return you want, and see the most you
            should bid. If you buy it, the plan becomes a bulk lot in one step.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div role="radiogroup" aria-label="Show plans" className="mb-3 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={filter === f}
                {...radio(f)}
                onClick={() => setFilter(f)}
                className={cn('rounded-full border px-3 py-1.5 text-xs font-medium', filter === f ? 'border-accent bg-accent-soft text-accent-text' : 'border-line-strong bg-surface text-ink-2 hover:text-ink')}
              >
                {f === 'all' ? `All (${plans.length})` : `${STATUS_LABELS[f]} (${count(f)})`}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="text-sm text-ink-2">No plans here.</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2" data-testid="bid-list">
              {shown.map((p) => (
                <li key={p.id}>
                  <PlanCard plan={p} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function PlanCard({ plan }: { plan: BidPlan }) {
  const { money } = useMoney();
  // A purchased plan shows the estimate it was bought with.
  const r = calculateBid(plan.snapshot?.assumptions ?? plan.assumptions);
  const e = r.ok ? r.scenarios.expected : null;
  return (
    <Link to={`/inventory/bids/${plan.id}`} className="block rounded-2xl border border-line bg-surface p-4 shadow-card hover:bg-surface-2" data-testid="bid-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold break-words text-ink">{plan.name}</h2>
          <p className="mt-0.5 text-sm text-muted">
            {KIND_LABELS[plan.kind]} · {formatDate(plan.updatedAt.slice(0, 10))}
          </p>
        </div>
        <Badge tone={STATUS_TONES[plan.status]}>{STATUS_LABELS[plan.status]}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted">Max bid (expected)</dt>
          <dd className="tabular font-medium text-ink">{!e ? 'Incomplete' : e.maxBid === null ? 'None' : money(e.maxBid)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{plan.purchase ? 'Paid' : 'Budget'}</dt>
          <dd className="tabular font-medium text-ink">{plan.purchase ? money(plan.purchase.pricePaid) : plan.assumptions.budget === null ? '—' : money(plan.assumptions.budget)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Resale estimate</dt>
          <dd className="tabular font-medium text-ink">{e ? money(e.estimatedResale) : '—'}</dd>
        </div>
      </dl>
    </Link>
  );
}
