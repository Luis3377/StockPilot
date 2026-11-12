// One sourcing trip: what was bought on it (link existing items and lots; nothing new is
// created), its expenses, time, and what it has earned so far.

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, X } from 'lucide-react';
import { sessionStats } from '../../insights/sourcing';
import { deleteSession, linkToSession } from '../../domain/sourcing';
import { formatDate } from '../../domain/dates';
import { lotForItem } from '../../domain/lots';
import { plural } from '../../domain/format';
import { store, useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { useAction } from '../../lib/useAction';
import { Card, PageHeader, SectionHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Button, IconButton } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { SelectField } from '../../ui/Fields';
import { useConfirm } from '../../ui/Confirm';
import { Figures, hoursText, pctText, sourceHref } from './parts';
import { TripDialog } from './TripsTab';

export function TripPage() {
  const { id } = useParams();
  const data = useAppState((s) => s.data);
  const navigate = useNavigate();
  const { money } = useMoney();
  const run = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const session = data.sourcing.sessions.find((s) => s.id === id);
  if (!session) {
    return (
      <EmptyState title="Trip not found" actions={<Button onClick={() => navigate('/insights/sourcing?tab=trips')}>All trips</Button>}>
        It may have been deleted.
      </EmptyState>
    );
  }
  const st = sessionStats(data, session);
  const linkable = [
    ...data.lots.filter((l) => l.sessionId !== session.id).map((l) => ({ value: `lot:${l.id}`, label: `Lot: ${l.name}` })),
    ...data.items.filter((i) => !lotForItem(data, i.id) && i.sessionId !== session.id).map((i) => ({ value: `item:${i.id}`, label: i.name })),
  ];
  const link = (v: string) => {
    if (!v) return;
    const [kind, recordId] = v.split(':') as ['item' | 'lot', string];
    run(() => store.update((d) => linkToSession(d, kind, recordId, session.id)), 'Linked to the trip. No purchase was added.');
  };
  const remove = async () => {
    if (await confirm({ title: `Delete “${session.name}”?`, message: 'Its items and lots stay in your inventory; they’re just no longer on a trip. Time linked only to it becomes general work.', confirmLabel: 'Delete trip', tone: 'danger' })) {
      if (run(() => (store.update((d) => deleteSession(d, session.id)), true), 'Trip deleted.')) navigate('/insights/sourcing?tab=trips');
    }
  };
  return (
    <>
      <Link to="/insights/sourcing?tab=trips" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Trips
      </Link>
      <PageHeader
        eyebrow={<Badge tone={st.completed ? 'good' : 'accent'}>{st.completed ? 'Completed' : 'Still selling'}</Badge>}
        title={<span className="break-words">{session.name}</span>}
        description={`${formatDate(session.date)}${session.notes ? ` · ${session.notes}` : ''}`}
        actions={
          <>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)} data-testid="trip-edit">
              Edit trip
            </Button>
            <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      />
      <Card className="p-4 sm:p-5" data-testid="trip-figures">
        <SectionHeader
          title={st.completed ? 'Result' : 'Result so far'}
          description={st.completed ? 'Everything bought on this trip has sold or been written off.' : 'Some of what was bought is still in stock, so this isn’t final.'}
        />
        <Figures
          className="mt-3"
          rows={[
            ['Bought', `${money(st.acquisitionCost)} · ${plural(st.unitsBought, 'unit')}`],
            ['Trip expenses', `${money(st.tripExpenses)} (${money(st.acquisitionExpenses)} buying, ${money(st.operatingExpenses)} running)`],
            ['Sales revenue', money(st.revenue)],
            ['Selling expenses', money(st.sellingExpenses)],
            ['Realized profit (sold units)', money(st.realizedProfit), st.realizedProfit < 0 ? 'text-bad-text' : undefined],
            ['Still in stock', `${money(st.inventoryCost)} · ${plural(st.unitsRemaining, 'unit')}`],
            [st.completed ? 'Trip result' : 'Trip result so far', money(st.result), st.result < 0 ? 'text-bad-text' : undefined],
            ['Return', pctText(st.roiPct)],
            ['Time', st.hours ? `${hoursText(st.hours)} · ${money(st.profitPerHour!)} realized profit per hour` : 'Not enough time data'],
          ]}
        />
        <p className="mt-2 text-xs text-muted">Trip result = net proceeds − what was bought − trip expenses. Return = trip result ÷ (what was bought + trip expenses).</p>
        {session.sourceIds.length > 1 && !session.split && (
          <p className="mt-2 text-sm text-warn-text">This trip visited several sources. Choose how to divide its time and expenses (Edit trip) to see them per source.</p>
        )}
      </Card>

      <Card className="mt-4 p-4 sm:p-5" data-testid="trip-purchases">
        <SectionHeader title="Bought on this trip" description="Link items or lots you already added. Linking never adds a purchase." />
        <ul className="mt-2 divide-y divide-line text-sm">
          {st.purchases.map((p) => (
            <li key={`${p.kind}:${p.id}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="min-w-0">
                <Link to={p.kind === 'lot' ? `/inventory/lots/${p.id}` : `/inventory/${p.id}`} className="break-words text-accent-text hover:underline">
                  {p.kind === 'lot' ? `Lot: ${p.name}` : p.name}
                </Link>{' '}
                <span className="text-ink-2">
                  · {money(p.cost)} ·{' '}
                  <Link to={sourceHref(p.ref.key)} className="hover:underline">
                    {p.ref.name}
                  </Link>
                </span>
              </span>
              <IconButton label={`Remove ${p.name} from the trip`} onClick={() => run(() => store.update((d) => linkToSession(d, p.kind, p.id, null)))}>
                <X className="size-4" />
              </IconButton>
            </li>
          ))}
          {!st.purchases.length && <li className="py-1.5 text-ink-2">Nothing linked yet.</li>}
        </ul>
        {linkable.length > 0 && (
          <SelectField className="mt-3" label="Link an item or lot" value="" onChange={link} data-testid="trip-link">
            <option value="">Choose…</option>
            {linkable.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        )}
      </Card>
      <TripDialog session={session} open={editing} onClose={() => setEditing(false)} />
    </>
  );
}
