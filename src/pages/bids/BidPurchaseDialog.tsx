// "I bought this lot": asks what was actually paid, shows how it compares with the plan's
// maximum, then opens the ordinary bulk lot form filled from the plan. If the lot was already
// added by hand, the plan can be linked to it instead, so nothing is entered twice.

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Link2 } from 'lucide-react';
import { calculateBid, linkBidToLot, lotPrefillFromPlan, similarLots } from '../../domain/bids';
import { todayISO, formatDate } from '../../domain/dates';
import { isDomainError } from '../../domain/errors';
import type { BidPlan } from '../../domain/types';
import { store, useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { MoneyField, SelectField, TextField } from '../../ui/Fields';
import { useToast } from '../../ui/Toast';
import { useDialogs } from '../dialogs/DialogHub';
import { readMoney, Row } from '../lots/LotParts';

export function BidPurchaseDialog({ plan, open, onClose }: { plan: BidPlan; open: boolean; onClose: () => void }) {
  const data = useAppState((s) => s.data);
  const { money, currency } = useMoney();
  const dialogs = useDialogs();
  const toast = useToast();
  const [paid, setPaid] = useState('');
  const [date, setDate] = useState(todayISO());
  const [linkTo, setLinkTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPaid('');
    setDate(todayISO());
    setLinkTo('');
    setError(null);
  }, [open]);

  const calc = useMemo(() => calculateBid(plan.assumptions), [plan.assumptions]);
  const expected = calc.ok ? calc.scenarios.expected : null;
  const read = readMoney(paid);
  const price = read.error ? null : read.value;
  const prefill = price !== null && price >= 0 ? lotPrefillFromPlan(plan, price, date || todayISO()) : null;
  const extra = prefill ? prefill.input.extraCosts.reduce((c, x) => c + Math.round((x.amount ?? 0) * 100), 0) / 100 : 0;
  const similar = similarLots(data, plan);
  const linkable = data.lots.filter((l) => !data.bidPlans.some((p) => p.purchase?.lotId === l.id));

  const next = () => {
    if (read.error) return setError(read.error);
    if (price === null) return setError('Enter what you paid for the lot.');
    if (price < 0) return setError('The price can’t be negative.');
    onClose();
    dialogs.addLotFromBid({ planId: plan.id, planName: plan.name, ...prefill! });
  };

  const link = (lotId: string) => {
    try {
      const r = store.commit((d) => linkBidToLot(d, plan.id, lotId));
      toast.success(`Linked the plan to lot “${r.plan.purchase!.lotName}”. Nothing new was added to inventory.`);
      onClose();
    } catch (e) {
      if (!isDomainError(e)) throw e;
      setError(e.message);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="I bought this lot"
      description="Record what you actually paid. Next you’ll check the items and how the cost is split, using the bulk lot form."
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={next} data-testid="bid-purchase-next">
            Next: items and cost split <ArrowRight className="size-4" />
          </Button>
        </div>
      }
      testId="bid-purchase-dialog"
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyField
            label="What you paid (winning bid or price)"
            required
            currency={currency}
            value={paid}
            onChange={(v) => {
              setPaid(v);
              setError(null);
            }}
            error={error}
            hint="Before buyer’s premium and tax"
            data-autofocus
            data-testid="bid-purchase-price"
          />
          <TextField label="Purchase date" type="date" value={date} onChange={setDate} />
        </div>
        {prefill && (
          <div className="rounded-2xl bg-surface-2 p-3" data-testid="bid-purchase-summary">
            <Row label="Price paid" value={money(price!)} />
            {prefill.input.extraCosts.map((c) => (
              <Row key={c.label} label={c.label} value={`+ ${money(c.amount ?? 0)}`} />
            ))}
            <Row label="Total cost of the lot" value={money(price! + extra)} strong className="border-t border-line pt-2" />
            {expected?.recommendedBid != null && (
              <p className="mt-1 text-sm text-ink-2" data-testid="bid-purchase-compare">
                {price! <= expected.recommendedBid
                  ? `${money(expected.recommendedBid - price!)} below your maximum bid estimate of ${money(expected.recommendedBid)}.`
                  : `${money(price! - expected.recommendedBid)} above your maximum bid estimate of ${money(expected.recommendedBid)}.`}
              </p>
            )}
            <p className="mt-1 text-xs text-muted">The buying costs use the plan’s rates at this price. You can change them on the next step.</p>
          </div>
        )}
        {similar.length > 0 && (
          <div className="rounded-xl bg-warn-soft p-3 text-sm text-warn-text" data-testid="bid-purchase-similar">
            <p className="font-medium">Already added it?</p>
            {similar.map((l) => (
              <div key={l.id} className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  You have a lot named “{l.name}”{l.purchaseDate ? `, bought ${formatDate(l.purchaseDate)}` : ''}. Link the plan to it instead of adding the items again.
                </span>
                <Button size="sm" icon={<Link2 className="size-3.5" />} onClick={() => link(l.id)}>
                  Link to this lot
                </Button>
              </div>
            ))}
          </div>
        )}
        {linkable.length > 0 && similar.length === 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-accent-text">Already added this lot to your inventory?</summary>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <SelectField label="Link to an existing lot" className="min-w-0 flex-1" value={linkTo} onChange={setLinkTo}>
                <option value="">Choose a lot…</option>
                {linkable.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.purchaseDate ? ` (${formatDate(l.purchaseDate)})` : ''}
                  </option>
                ))}
              </SelectField>
              <Button disabled={!linkTo} icon={<Link2 className="size-4" />} onClick={() => link(linkTo)}>
                Link
              </Button>
            </div>
          </details>
        )}
      </div>
    </Dialog>
  );
}
