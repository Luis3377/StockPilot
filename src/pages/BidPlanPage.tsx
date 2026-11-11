// One Max Bid plan: the assumptions on the left, the live result on the right (below on phones).
// A plan is planning data until the user records the purchase; from then on its assumptions are
// kept as the original estimate and only a copy can be changed.

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Calculator, Copy, Layers, PackageCheck, RotateCcw, Save, ThumbsDown, Trash2, Trophy } from 'lucide-react';
import {
  bidPlanErrors,
  calculateBid,
  createBidPlan,
  deleteBidPlan,
  duplicateBidPlan,
  KIND_LABELS,
  setBidPlanStatus,
  STATUS_LABELS,
  updateBidPlan,
  type BidCalcResult,
} from '../domain/bids';
import { knownCategories } from '../domain/calc';
import { formatDate, formatDateTime } from '../domain/dates';
import { isDomainError } from '../domain/errors';
import type { BidPlan, BidPlanStatus } from '../domain/types';
import { store, useAppState } from '../data/store';
import { useMoney } from '../lib/hooks';
import { useAction } from '../lib/useAction';
import { Card, PageHeader, SectionHeader } from '../ui/Card';
import { Badge, type Tone } from '../ui/Badge';
import { Button, buttonClass } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { EmptyState } from '../ui/EmptyState';
import { TextAreaField } from '../ui/Fields';
import { useConfirm } from '../ui/Confirm';
import { useToast } from '../ui/Toast';
import { BidForm } from './bids/BidForm';
import { BidResults } from './bids/BidResults';
import { BidPurchaseDialog } from './bids/BidPurchaseDialog';
import { draftFromPlan, isDirty, toBidInput, type BidDraft } from './bids/bidDraft';

export const STATUS_TONES: Record<BidPlanStatus, Tone> = { draft: 'accent', purchased: 'good', passed: 'neutral', lost: 'warn' };

export function BidPlanPage() {
  const { id } = useParams();
  const data = useAppState((s) => s.data);
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const plan = isNew ? null : (data.bidPlans.find((p) => p.id === id) ?? null);

  if (!isNew && !plan) {
    return (
      <EmptyState
        icon={<Calculator className="size-6" />}
        title="Plan not found"
        actions={
          <Button variant="primary" onClick={() => navigate('/inventory/bids')}>
            All plans
          </Button>
        }
      >
        It may have been deleted, or removed by restoring a backup.
      </EmptyState>
    );
  }
  // Keyed so switching plans (or saving a new one) starts from that plan's saved values.
  return <PlanEditor key={plan?.id ?? 'new'} plan={plan} />;
}

function PlanEditor({ plan }: { plan: BidPlan | null }) {
  const data = useAppState((s) => s.data);
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const run = useAction();
  const { money } = useMoney();
  const [draft, setDraft] = useState<BidDraft>(() => draftFromPlan(plan));
  const [submitErrors, setSubmitErrors] = useState<Record<string, string>>({});
  const [buying, setBuying] = useState(false);
  const [deciding, setDeciding] = useState<'passed' | 'lost' | null>(null);
  const categories = useMemo(() => knownCategories(data), [data]);

  const locked = plan !== null && plan.status !== 'draft';
  const dirty = !locked && isDirty(draft, plan);
  const { input, typing } = toBidInput(draft);
  // Format problems show as you type; "required" ones only after trying to save.
  const live = { ...bidPlanErrors(input), ...typing };
  delete live.name;
  // Fields show format problems as you type; "is required" waits for a save attempt (the result
  // panel still lists what's missing).
  const fieldLive = Object.fromEntries(Object.entries(live).filter(([, m]) => !m.endsWith('is required.')));
  const errors = { ...fieldLive, ...submitErrors };
  const result: BidCalcResult = locked ? calculateBid(plan!.assumptions) : Object.keys(live).length ? { ok: false, missing: live } : calculateBid(input.assumptions);

  const onChange = (update: (d: BidDraft) => BidDraft, clear: string[] = []) => {
    setDraft(update);
    if (clear.some((k) => submitErrors[k])) setSubmitErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !clear.includes(k))));
  };

  const save = () => {
    const found = { ...bidPlanErrors(input), ...typing };
    if (Object.keys(found).length) {
      setSubmitErrors(found);
      toast.error('Check the highlighted fields.');
      return;
    }
    try {
      if (plan) {
        store.commit((d) => updateBidPlan(d, plan.id, input));
        setDraft(draftFromPlan(store.getState().data.bidPlans.find((p) => p.id === plan.id)!));
        toast.success('Saved your changes.');
      } else {
        const r = store.commit((d) => createBidPlan(d, input));
        toast.success('Saved as a draft plan. Nothing was added to your inventory.');
        navigate(`/inventory/bids/${r.plan.id}`, { replace: true });
      }
      setSubmitErrors({});
    } catch (e) {
      if (!isDomainError(e)) throw e;
      setSubmitErrors(Object.keys(e.fields).length ? e.fields : {});
      toast.error(e.message);
    }
  };

  const duplicate = () => {
    if (!plan) return;
    const r = run(() => store.commit((d) => duplicateBidPlan(d, plan.id)), 'Made a copy to try other assumptions.');
    if (r) navigate(`/inventory/bids/${r.plan.id}`);
  };

  const reopen = () => plan && run(() => store.commit((d) => setBidPlanStatus(d, plan.id, 'draft')), 'Reopened the plan.');

  const remove = async () => {
    if (!plan) return;
    const ok = await confirm({
      title: 'Delete this plan?',
      message:
        plan.status === 'purchased'
          ? 'The lot and its items stay in your inventory, but this plan’s original estimate will be gone, so it can’t be compared with the results later.'
          : 'This removes the plan and its assumptions. Your inventory isn’t affected.',
      confirmLabel: 'Delete plan',
      tone: 'danger',
    });
    if (!ok) return;
    const done = run(() => {
      store.update((d) => deleteBidPlan(d, plan.id));
      return true;
    }, 'Plan deleted.');
    if (done) navigate('/inventory/bids');
  };

  const lot = plan?.purchase ? data.lots.find((l) => l.id === plan.purchase!.lotId) : undefined;
  const expected = result.ok ? result.scenarios.expected : null;

  return (
    <>
      <Link to="/inventory/bids" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Max bid plans
      </Link>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={plan ? STATUS_TONES[plan.status] : 'accent'}>{plan ? STATUS_LABELS[plan.status] : 'New plan'}</Badge>
            <span className="text-xs text-muted">Planning estimate · not inventory, a purchase or an expense</span>
          </span>
        }
        title={<span className="break-words">{plan ? plan.name : 'Max bid calculator'}</span>}
        description={plan ? `${KIND_LABELS[plan.kind]} · updated ${formatDate(plan.updatedAt.slice(0, 10))}` : 'Work out the most to pay for a lot, before you buy it.'}
        actions={
          <>
            {!locked && (
              <Button variant="primary" icon={<Save className="size-4" />} onClick={save} disabled={plan !== null && !dirty} data-testid="bid-save">
                {plan ? 'Save changes' : 'Save draft'}
              </Button>
            )}
            {plan && (
              <Button icon={<Copy className="size-4" />} onClick={duplicate} disabled={dirty} data-testid="bid-duplicate">
                Duplicate
              </Button>
            )}
          </>
        }
      />
      {dirty && plan && (
        <p className="-mt-3 mb-4 text-sm text-warn-text" role="status" data-testid="bid-unsaved">
          Unsaved changes. Save them before duplicating or recording the purchase.
        </p>
      )}

      {plan?.status === 'purchased' && plan.purchase && (
        <Card className="mb-4 border-good/40 p-4 sm:p-5" data-testid="bid-purchased">
          <SectionHeader
            title="Purchased"
            description={`Recorded ${formatDateTime(plan.purchase.recordedAt)}${plan.purchase.how === 'linked' ? ' by linking a lot you had already added' : ''}. The estimate below is the original one, kept unchanged.`}
          />
          <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
            <div>
              <PurchaseRow label="Price paid" value={money(plan.purchase.pricePaid)} />
              <PurchaseRow label="Buying costs recorded on the lot" value={money(plan.purchase.additionalCosts)} />
              <PurchaseRow label="Total cost" value={money(plan.purchase.pricePaid + plan.purchase.additionalCosts)} strong />
            </div>
            <div>
              {plan.snapshot?.results.expected?.maxBid != null && <PurchaseRow label="Max bid estimate at the time (expected)" value={money(plan.snapshot.results.expected.maxBid)} />}
              {plan.snapshot?.recommendedBid != null && (
                <PurchaseRow
                  label={plan.purchase.pricePaid <= plan.snapshot.recommendedBid ? 'Paid below the recommendation by' : 'Paid above the recommendation by'}
                  value={money(Math.abs(plan.snapshot.recommendedBid - plan.purchase.pricePaid))}
                  testId="bid-paid-vs-max"
                />
              )}
              <PurchaseRow label="Bought on" value={plan.purchase.purchaseDate ? formatDate(plan.purchase.purchaseDate) : '—'} />
            </div>
          </div>
          {lot ? (
            <Link to={`/inventory/lots/${lot.id}`} className={buttonClass('secondary', 'md', 'mt-3')} data-testid="bid-open-lot">
              <Layers className="size-4" /> Open lot “{lot.name}”
            </Link>
          ) : (
            <p className="mt-3 text-sm text-warn-text">The lot “{plan.purchase.lotName}” is no longer in your records.</p>
          )}
        </Card>
      )}

      {expected && (
        // A button, not an anchor: with hash routing, "#bid-results" would be read as a page.
        <button
          type="button"
          onClick={() => document.getElementById('bid-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="mb-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3 text-left shadow-card lg:hidden"
          data-testid="bid-mobile-summary"
        >
          <span className="text-sm text-ink-2">{locked && plan?.status === 'purchased' ? 'Original max bid estimate' : 'Max bid estimate'} (expected) · see breakdown</span>
          <span className="tabular text-lg font-semibold text-ink">{expected.maxBid === null ? 'No sensible bid' : money(expected.maxBid)}</span>
        </button>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <BidForm draft={draft} onChange={onChange} errors={errors} categories={categories} locked={locked} />
        <div className="space-y-4 lg:sticky lg:top-6" id="bid-results">
          <BidResults
            result={result}
            heading={plan?.status === 'purchased' ? 'Original estimate' : 'Maximum bid estimate'}
            note={
              plan?.status === 'purchased' && plan.snapshot ? (
                <p className="mt-1 text-xs text-muted">As calculated when the purchase was recorded ({formatDate(plan.snapshot.takenAt.slice(0, 10))}).</p>
              ) : undefined
            }
          />
          {plan && (
            <Card className="p-4 sm:p-5" data-testid="bid-decision">
              <SectionHeader title="Decision" description="Plans stay planning data until you record a purchase." />
              <div className="mt-3 flex flex-wrap gap-2">
                {plan.status !== 'purchased' && (
                  <Button variant="primary" icon={<PackageCheck className="size-4" />} onClick={() => setBuying(true)} disabled={dirty} data-testid="bid-bought">
                    I bought this lot
                  </Button>
                )}
                {plan.status === 'draft' && (
                  <>
                    <Button icon={<ThumbsDown className="size-4" />} onClick={() => setDeciding('passed')} data-testid="bid-pass">
                      Passed
                    </Button>
                    <Button icon={<Trophy className="size-4" />} onClick={() => setDeciding('lost')} data-testid="bid-lost">
                      Lost
                    </Button>
                  </>
                )}
                {(plan.status === 'passed' || plan.status === 'lost') && (
                  <Button icon={<RotateCcw className="size-4" />} onClick={reopen} data-testid="bid-reopen">
                    Reopen to edit
                  </Button>
                )}
                <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => void remove()} data-testid="bid-delete">
                  Delete
                </Button>
              </div>
              {plan.history.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-line pt-2 text-xs text-ink-2" data-testid="bid-history">
                  {plan.history.map((h) => (
                    <li key={h.id}>
                      {formatDateTime(h.at)}: {STATUS_LABELS[h.from]} → {STATUS_LABELS[h.to]}
                      {h.note && ` · ${h.note}`}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>

      {plan && <BidPurchaseDialog plan={plan} open={buying} onClose={() => setBuying(false)} />}
      {plan && <DecisionDialog plan={plan} to={deciding} onClose={() => setDeciding(null)} />}
    </>
  );
}

function PurchaseRow({ label, value, strong, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <div className={strong ? 'flex justify-between gap-3 border-t border-line py-1.5 text-sm font-semibold text-ink' : 'flex justify-between gap-3 py-1.5 text-sm'} data-testid={testId}>
      <span className={strong ? '' : 'text-ink-2'}>{label}</span>
      <span className="tabular text-ink">{value}</span>
    </div>
  );
}

function DecisionDialog({ plan, to, onClose }: { plan: BidPlan; to: 'passed' | 'lost' | null; onClose: () => void }) {
  const [note, setNote] = useState('');
  const run = useAction();
  const label = to === 'lost' ? 'Lost' : 'Passed';
  const save = () => {
    if (!to) return;
    if (run(() => store.commit((d) => setBidPlanStatus(d, plan.id, to, note)), `Marked as ${label.toLowerCase()}.`)) {
      setNote('');
      onClose();
    }
  };
  return (
    <Dialog
      open={to !== null}
      onClose={onClose}
      title={to === 'lost' ? 'Mark as lost' : 'Mark as passed'}
      description={to === 'lost' ? 'Someone else won the lot.' : 'You decided not to bid or buy.'}
      size="sm"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} data-testid="bid-decision-save">
            Mark as {label.toLowerCase()}
          </Button>
        </div>
      }
    >
      <TextAreaField label="Note (optional)" value={note} onChange={setNote} rows={2} maxLength={500} placeholder={to === 'lost' ? 'e.g. Sold for $520' : 'e.g. Too much damage'} />
      <p className="mt-2 text-xs text-muted">The plan keeps its assumptions. You can reopen it later.</p>
    </Dialog>
  );
}
