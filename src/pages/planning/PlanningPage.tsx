// Sales & Profit → Financial Planning: how much of recorded profit to earmark for taxes and other
// goals (at percentages the user chooses), what they've recorded as set aside, and obligations
// they've planned. Planning only: nothing here changes profit, expenses or inventory, and no bank
// account is connected. Figures are labelled recorded, estimated or user-entered.

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Archive, ArrowLeft, Bell, CheckCircle2, Info, Pencil, Plus } from 'lucide-react';
import type { Obligation, ObligationCategory, ReserveCategory, ReserveKind } from '../../domain/types';
import { addCategory, addEntry, addObligation, archiveCategory, cancelObligation, OBLIGATION_LABELS, RESERVE_KIND_LABELS, setOccurrenceDone, setTaxPercent, updateCategory, updateObligation, voidEntry } from '../../domain/planning';
import { isDomainError } from '../../domain/errors';
import { formatDate, formatDateTime, todayISO } from '../../domain/dates';
import { toCents } from '../../domain/money';
import { plural } from '../../domain/format';
import { obligationOccurrences, PERIOD_TYPE_LABELS, percentText, periodOptions, planningPeriod, planningSummary, PLANNING_DISCLAIMER, scenarioRows, type PeriodType, type PlanningSummary } from '../../insights/planning';
import { store, useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { useAction } from '../../lib/useAction';
import { useToast } from '../../ui/Toast';
import { Card, PageHeader, SectionHeader } from '../../ui/Card';
import { Badge, type Tone } from '../../ui/Badge';
import { Button, IconButton } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { MoneyField, Segmented, SelectField, TextAreaField, TextField } from '../../ui/Fields';
import { useConfirm } from '../../ui/Confirm';
import { cn } from '../../ui/cn';

/** The time and currency for history text and messages. */
const clk = () => ({ now: new Date(), currency: store.getState().settings.currency });

const TAG: Record<'recorded' | 'estimated' | 'entered', [string, Tone]> = { recorded: ['Recorded', 'good'], estimated: ['Estimated', 'accent'], entered: ['User-entered', 'neutral'] };

export function PlanningPage() {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const today = todayISO();
  const [params, setParams] = useSearchParams();
  const type = (['month', 'quarter', 'year'].includes(params.get('type') ?? '') ? params.get('type') : 'month') as PeriodType;
  const options = periodOptions(type, data, today);
  const key = params.get('key') && planningPeriodValid(type, params.get('key')!) ? params.get('key')! : options[0];
  const s = planningSummary(data, settings, type, key, today);
  return (
    <>
      <Link to="/sales" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Sales & Profit
      </Link>
      <PageHeader title="Financial Planning" description="Decide how much of your recorded profit to earmark for taxes and other goals, keep track of what you’ve set aside, and plan upcoming obligations." />
      <p className="mb-4 flex items-start gap-1.5 rounded-xl border border-line bg-surface-2 p-3 text-sm text-ink-2" data-testid="planning-disclaimer">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {PLANNING_DISCLAIMER}
      </p>
      <Card className="mb-4 flex flex-wrap items-end justify-between gap-3 p-4">
        <Segmented label="Period" value={type} onChange={(t) => setParams({ type: t }, { replace: true })} options={(['month', 'quarter', 'year'] as const).map((t) => ({ value: t, label: PERIOD_TYPE_LABELS[t] }))} />
        <SelectField label="Showing" value={key} onChange={(k) => setParams({ type, key: k }, { replace: true })} className="sm:w-56" data-testid="planning-period">
          {(options.includes(key) ? options : [key, ...options]).map((k) => (
            <option key={k} value={k}>
              {planningPeriod(type, k).label}
            </option>
          ))}
        </SelectField>
      </Card>
      <SummaryCard s={s} />
      <TaxCard s={s} />
      <ScenarioCard s={s} />
      <ReservesCard s={s} />
      <ObligationsCard />
      <PlanningLog />
    </>
  );
}

function planningPeriodValid(type: PeriodType, key: string): boolean {
  return type === 'month' ? /^\d{4}-(0[1-9]|1[0-2])$/.test(key) : type === 'quarter' ? /^\d{4}-Q[1-4]$/.test(key) : /^\d{4}$/.test(key);
}

function Row({ label, value, tag, note, testId }: { label: string; value: ReactNode; tag?: keyof typeof TAG; note?: string; testId?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5" data-testid={testId}>
      <dt className="min-w-0 text-sm text-ink-2">
        {label}
        {note && <span className="block text-xs text-muted">{note}</span>}
      </dt>
      <dd className="flex items-center gap-2">
        <span className="tabular text-sm font-medium text-ink">{value}</span>
        {tag && <Badge tone={TAG[tag][1]}>{TAG[tag][0]}</Badge>}
      </dd>
    </div>
  );
}

function SummaryCard({ s }: { s: PlanningSummary }) {
  const { money } = useMoney();
  const others = s.lines.filter((l) => l.category.mode === 'percent' && l !== s.tax).reduce((c, l) => c + toCents(l.target ?? 0), 0);
  const goals = s.lines.filter((l) => l.category.mode === 'goal');
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="planning-summary">
      <SectionHeader title={s.period.label} description={s.periodStatus} />
      <div className="mt-3 grid gap-x-8 md:grid-cols-2">
        <dl className="divide-y divide-line">
          <Row label="Recorded realized profit" value={<span className={s.profit.netProfit < 0 ? 'text-bad-text' : undefined}>{money(s.profit.netProfit)}</span>} tag="recorded" note={`${plural(s.profit.salesCount, 'sale')}; same figure as Sales & Profit`} testId="pl-profit" />
          <Row label="Suggested tax reserve" value={s.tax ? money(s.tax.target ?? 0) : 'Choose a percentage'} tag={s.tax ? 'estimated' : undefined} note={s.tax ? `At the ${percentText(s.tax.category.percent ?? 0)} you chose` : undefined} testId="pl-tax" />
          <Row label="Other planned reserves" value={money(others / 100)} tag="estimated" note="Your other percentage reserves" />
          <Row label="Profit remaining after planned reserves" value={<span className={s.afterReserves < 0 ? 'text-bad-text' : undefined}>{money(s.afterReserves)}</span>} tag="estimated" note="Not the same as cash you can spend" testId="pl-after" />
        </dl>
        <dl className="divide-y divide-line">
          <Row label="Marked as reserved in this period" value={money(s.setAsideTotal)} tag="entered" testId="pl-set-aside" />
          <Row label="Remaining reserve target" value={money(s.remainingTarget)} tag="estimated" note={goals.length ? `Includes ${plural(goals.length, 'savings goal')}` : undefined} testId="pl-remaining" />
          <Row label="Upcoming obligations (next 90 days)" value={money(s.upcomingTotal)} tag="entered" note={s.overdue.length ? `${plural(s.overdue.length, 'payment')} past its date` : undefined} testId="pl-upcoming" />
        </dl>
      </div>
    </Card>
  );
}

function TaxCard({ s }: { s: PlanningSummary }) {
  const { money } = useMoney();
  const run = useAction();
  const [value, setValue] = useState('');
  const current = s.tax?.category.percent ?? null;
  useEffect(() => setValue(current === null ? '' : String(current)), [current]);
  const save = () => run(() => store.update((d) => setTaxPercent(d, value.trim() === '' ? null : Number(value), clk())), 'Reserve percentage saved.');
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="tax-card">
      <SectionHeader title="Tax reserve calculator" description="Choose the percentage of recorded profit you want to earmark. It’s your own planning choice: StockPilot doesn’t know your tax rate, and doesn’t work out what you owe." />
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <TextField label="Your reserve percentage (%)" inputMode="decimal" value={value} onChange={setValue} className="w-56" placeholder="e.g. 25" data-testid="tax-percent" />
        <Button variant="primary" onClick={save} data-testid="tax-percent-save">
          {current === null ? 'Set percentage' : 'Update'}
        </Button>
      </div>
      {s.tax && (
        <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm" data-testid="tax-calc">
          <p className="text-ink">{s.tax.calculation}</p>
          {s.profit.netProfit > 0 && (
            <p className="text-ink">
              {money(s.profit.netProfit)} − {money(s.tax.target ?? 0)} = {money(s.profit.netProfit - (s.tax.target ?? 0))} of recorded profit after the suggested tax reserve
            </p>
          )}
          <p className="mt-1 text-xs text-ink-2">Recorded as set aside for taxes in {s.period.label}: {money(s.tax.setAsideInPeriod)}{s.tax.remaining ? ` · ${money(s.tax.remaining)} behind your target` : s.tax.ahead ? ` · ${money(s.tax.ahead)} ahead of your target` : ' · on target'}.</p>
        </div>
      )}
      {s.warnings.length > 0 && (
        <ul className="mt-3 space-y-1.5" data-testid="planning-warnings">
          {s.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 rounded-lg bg-warn-soft p-2 text-sm text-warn-text">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-accent-text">What isn’t included in recorded profit</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-2" data-testid="planning-not-included">
          {s.notIncluded.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

function ScenarioCard({ s }: { s: PlanningSummary }) {
  const settings = useAppState((x) => x.settings);
  const [custom, setCustom] = useState('');
  const base = [20, 25, 30];
  const extra = [s.tax?.category.percent ?? null, custom.trim() !== '' && Number.isFinite(Number(custom)) && Number(custom) >= 0 && Number(custom) <= 100 ? Number(custom) : null].filter((p): p is number => p !== null);
  const percents = [...new Set([...base, ...extra])].sort((a, b) => a - b);
  const rows = scenarioRows(toCents(s.profit.netProfit), percents, settings.currency);
  const { money } = useMoney();
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="scenario-card">
      <SectionHeader title="Compare percentages" description="Examples to see the effect of different percentages on this period’s recorded profit. They aren’t recommended tax rates." />
      <TextField label="Try another percentage (%)" inputMode="decimal" value={custom} onChange={setCustom} className="mt-2 w-48" data-testid="scenario-custom" />
      <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Percentage scenarios">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 font-medium">Percentage</th>
              <th className="py-1 text-right font-medium">Earmarked</th>
              <th className="py-1 text-right font-medium">Profit remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.percent} data-testid="scenario-row">
                <th scope="row" className="py-1.5 text-left font-normal">
                  {percentText(r.percent)}
                  {r.percent === s.tax?.category.percent && <span className="ml-1 text-xs text-muted">(your setting)</span>}
                  <span className="block text-xs text-muted">{r.explanation}</span>
                </th>
                <td className="tabular py-1.5 text-right">{money(r.reserve)}</td>
                <td className="tabular py-1.5 text-right">{money(r.remaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ReservesCard({ s }: { s: PlanningSummary }) {
  const data = useAppState((x) => x.data);
  const { money } = useMoney();
  const run = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<ReserveCategory | 'new' | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const names = new Map(data.planning.categories.map((c) => [c.id, c.name]));
  const history = [...data.planning.entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="reserves-card">
      <SectionHeader title="Reserves" description="Suggested amounts come from your percentages; “set aside” is what you record moving to savings. StockPilot can’t see your bank, so it can’t confirm the money is there. Setting money aside isn’t an expense and doesn’t change profit." />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')} data-testid="category-new">
          Add reserve
        </Button>
        <Button size="sm" variant="primary" onClick={() => setRecording(true)} disabled={!s.lines.length} data-testid="entry-new">
          Record money set aside
        </Button>
      </div>
      {s.lines.length === 0 ? (
        <p className="mt-3 text-sm text-ink-2">No reserves yet. Set a tax percentage above, or add a reserve such as equipment replacement, an inventory buying fund or an emergency reserve.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {s.lines.map((l) => (
            <li key={l.category.id} className="py-2 text-sm" data-testid="reserve-row">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {l.category.name} <span className="text-xs font-normal text-muted">{l.category.mode === 'percent' ? `${percentText(l.category.percent ?? 0)} of profit` : `goal ${money(l.category.goal ?? 0)}`}</span>
                  </p>
                  <p className="text-xs text-ink-2">{l.calculation}</p>
                  <p className="tabular text-ink-2">
                    {l.category.mode === 'percent' ? `Target ${money(l.target ?? 0)} · set aside this period ${money(l.setAsideInPeriod)}` : `Set aside so far ${money(l.balance)}`} ·{' '}
                    <span className={l.remaining ? 'text-warn-text' : 'text-good-text'}>{l.remaining ? `${money(l.remaining)} to go` : l.ahead ? `${money(l.ahead)} ahead` : 'on target'}</span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <IconButton label={`Edit ${l.category.name}`} onClick={() => setEditing(l.category)}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton label={`Archive ${l.category.name}`} onClick={async () => (await confirm({ title: `Archive “${l.category.name}”?`, message: 'It disappears from planning; its history is kept.', confirmLabel: 'Archive' })) && run(() => store.update((d) => archiveCategory(d, l.category.id, clk())), 'Reserve archived.')}>
                    <Archive className="size-4" />
                  </IconButton>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {history.length > 0 && (
        <details className="mt-3 text-sm" open>
          <summary className="cursor-pointer font-medium text-ink">Reserve history</summary>
          <ul className="mt-1 divide-y divide-line" data-testid="reserve-history">
            {history.map((e) => (
              <li key={e.id} className={cn('flex items-start justify-between gap-2 py-1.5', e.voidedAt && 'text-muted line-through')} data-testid="reserve-entry">
                <span className="min-w-0">
                  {formatDate(e.date)} · {names.get(e.categoryId) ?? 'Reserve'} · {e.kind === 'deposit' ? 'set aside' : e.kind === 'withdrawal' ? 'taken out' : 'adjustment'} {money(e.kind === 'withdrawal' ? -e.amount : e.amount)}
                  {e.note && <span className="text-ink-2"> · {e.note}</span>}
                  {e.voidedAt && <span className="block text-xs no-underline">Voided: {e.voidReason}</span>}
                </span>
                {!e.voidedAt && (
                  <Button size="sm" variant="ghost" onClick={() => setVoiding(e.id)} data-testid="entry-void">
                    Void
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <CategoryDialog category={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
      <EntryDialog open={recording} onClose={() => setRecording(false)} />
      <VoidDialog entryId={voiding} onClose={() => setVoiding(null)} />
    </Card>
  );
}

function ObligationsCard() {
  const data = useAppState((x) => x.data);
  const { money } = useMoney();
  const run = useAction();
  const today = todayISO();
  const [editing, setEditing] = useState<Obligation | 'new' | null>(null);
  // Everything not done yet (including past dates), and done ones still ahead, for the next 12 months.
  const shown = obligationOccurrences(data, today, '0000-01-01', addYear(today))
    .filter((o) => !o.done || o.date >= today)
    .slice(0, 60);
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="obligations-card">
      <SectionHeader title="Upcoming obligations" description="Payments you expect, entered by you: tax payments you plan for, insurance, equipment, software, a large inventory purchase. They’re plans, not expenses, and you set the dates. Reminders show here when you open StockPilot; nothing is sent to your phone." />
      <Button size="sm" className="mt-3" icon={<Plus className="size-4" />} onClick={() => setEditing('new')} data-testid="obligation-new">
        Plan an obligation
      </Button>
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-ink-2">Nothing planned in the next 12 months.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line" data-testid="obligation-list">
          {shown.map((o) => (
            <li key={`${o.obligation.id}:${o.date}`} className="flex items-start justify-between gap-2 py-2 text-sm" data-testid="obligation-row">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  {o.obligation.description}{' '}
                  {o.overdue ? <Badge tone="bad">Past its date</Badge> : o.dueSoon ? <Badge tone="warn" icon={<Bell className="size-3" />}>Due soon</Badge> : o.done ? <Badge tone="good">Done</Badge> : null}
                </p>
                <p className="text-ink-2">
                  {formatDate(o.date)} · {money(o.amount)} · {OBLIGATION_LABELS[o.obligation.category]}
                  {o.obligation.recurrence !== 'none' && ` · repeats ${o.obligation.recurrence}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" icon={<CheckCircle2 className="size-4" />} onClick={() => run(() => store.update((d) => setOccurrenceDone(d, o.obligation.id, o.date, !o.done, clk())), o.done ? 'Marked not done.' : 'Marked done. No expense was recorded.')} data-testid="occurrence-done">
                  {o.done ? 'Undo' : 'Done'}
                </Button>
                <IconButton label={`Edit ${o.obligation.description}`} onClick={() => setEditing(o.obligation)}>
                  <Pencil className="size-4" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ObligationDialog obligation={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </Card>
  );
}

const addYear = (date: string) => `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;

function PlanningLog() {
  const audit = useAppState((s) => s.data.planning.audit);
  if (!audit.length) return null;
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="planning-log">
      <SectionHeader title="Planning history" description="Every change to your percentages, reserves, entries and obligations, as recorded on this device." />
      <ul className="mt-2 space-y-1 text-xs text-ink-2">
        {[...audit].reverse().slice(0, 200).map((a) => (
          <li key={a.id}>
            {formatDateTime(a.at)}: {a.detail}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function useFormErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const handle = (e: unknown) => {
    if (!isDomainError(e)) throw e;
    setErrors(Object.keys(e.fields).length ? e.fields : { form: e.message });
  };
  return { errors, setErrors, handle };
}

function Footer({ onClose, onSave, label, testId }: { onClose: () => void; onSave: () => void; label: string; testId: string }) {
  return (
    <div className="flex w-full justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" onClick={onSave} data-testid={testId}>
        {label}
      </Button>
    </div>
  );
}

function CategoryDialog({ category, open, onClose }: { category: ReserveCategory | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { errors, setErrors, handle } = useFormErrors();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ReserveKind>('emergency');
  const [mode, setMode] = useState<'percent' | 'goal'>('goal');
  const [percent, setPercent] = useState('');
  const [goal, setGoal] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setKind(category?.kind ?? 'emergency');
    setMode(category?.mode ?? 'goal');
    setPercent(category?.percent === null || category?.percent === undefined ? '' : String(category.percent));
    setGoal(category?.goal === null || category?.goal === undefined ? '' : String(category.goal));
    setErrors({});
  }, [open, category, setErrors]);
  const save = () => {
    try {
      const input = { name, kind, mode, percent: percent.trim() === '' ? null : Number(percent), goal: goal.trim() === '' ? null : Number(goal) };
      store.update((d) => (category ? updateCategory(d, category.id, input, clk()) : addCategory(d, input, clk()).data));
      toast.success(category ? 'Reserve saved.' : `Added “${name.trim()}”.`);
      onClose();
    } catch (e) {
      handle(e);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={category ? `Edit “${category.name}”` : 'Add a reserve'} testId="category-dialog" footer={<Footer onClose={onClose} onSave={save} label="Save" testId="category-save" />}>
      <div className="space-y-3">
        <TextField label="Name" required value={name} onChange={setName} error={errors.name} maxLength={80} placeholder="e.g. Equipment replacement" />
        {category?.kind !== 'tax' && (
          <SelectField label="Kind" value={kind} onChange={(v) => setKind(v as ReserveKind)} error={errors.kind}>
            {(Object.keys(RESERVE_KIND_LABELS) as ReserveKind[]).filter((k) => k !== 'tax').map((k) => (
              <option key={k} value={k}>
                {RESERVE_KIND_LABELS[k]}
              </option>
            ))}
          </SelectField>
        )}
        {category?.kind !== 'tax' && (
          <Segmented label="Target" value={mode} onChange={setMode} options={[{ value: 'goal', label: 'A savings goal' }, { value: 'percent', label: 'A % of profit' }]} />
        )}
        {mode === 'percent' ? (
          <TextField label="Percentage of each period’s recorded profit (%)" inputMode="decimal" value={percent} onChange={setPercent} error={errors.percent} />
        ) : (
          <TextField label="Goal amount" inputMode="decimal" value={goal} onChange={setGoal} error={errors.goal} hint="Money set aside toward this isn’t an expense. An inventory fund, for example, is just money kept for buying stock later." />
        )}
      </div>
    </Dialog>
  );
}

function EntryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const data = useAppState((x) => x.data);
  const settings = useAppState((x) => x.settings);
  const toast = useToast();
  const { errors, setErrors, handle } = useFormErrors();
  const cats = data.planning.categories.filter((c) => !c.archived);
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [kind, setKind] = useState<'deposit' | 'withdrawal' | 'adjustment'>('deposit');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!open) return;
    setCategoryId(cats[0]?.id ?? '');
    setDate(todayISO());
    setKind('deposit');
    setAmount('');
    setNote('');
    setErrors({});
  }, [open]);
  const save = (allowDuplicate = false) => {
    try {
      store.update((d) => addEntry(d, { categoryId, date, kind, amount: amount.trim() === '' ? null : Number(amount), note }, { allowDuplicate }, clk()).data);
      toast.success('Recorded. Profit isn’t changed: this is an allocation of your money.');
      onClose();
    } catch (e) {
      handle(e);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Record money set aside" description="Record what you moved to (or took from) savings yourself. StockPilot doesn’t move money or see your bank." testId="entry-dialog" footer={<Footer onClose={onClose} onSave={() => save()} label="Record" testId="entry-save" />}>
      <div className="space-y-3">
        <SelectField label="Reserve" value={categoryId} onChange={setCategoryId} error={errors.categoryId}>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <Segmented label="Type" value={kind} onChange={setKind} options={[{ value: 'deposit', label: 'Set aside' }, { value: 'withdrawal', label: 'Took out' }, { value: 'adjustment', label: 'Adjustment' }]} />
        <TextField label="Date" type="date" value={date} onChange={setDate} error={errors.date} max={todayISO()} />
        {kind === 'adjustment' ? (
          <TextField label="Adjustment (negative to reduce)" inputMode="decimal" value={amount} onChange={setAmount} error={errors.amount} />
        ) : (
          <MoneyField label="Amount" currency={settings.currency} value={amount} onChange={setAmount} error={errors.amount} />
        )}
        <TextField label="Note (optional)" value={note} onChange={setNote} maxLength={500} placeholder="e.g. Transfer to tax savings" />
        {errors.duplicate && (
          <div className="rounded-lg bg-warn-soft p-2 text-sm text-warn-text" data-testid="entry-duplicate">
            <p>{errors.duplicate}</p>
            <Button size="sm" className="mt-2" onClick={() => save(true)} data-testid="entry-save-anyway">
              Record it again
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function VoidDialog({ entryId, onClose }: { entryId: string | null; onClose: () => void }) {
  const toast = useToast();
  const { errors, setErrors, handle } = useFormErrors();
  const [reason, setReason] = useState('');
  useEffect(() => {
    setReason('');
    setErrors({});
  }, [entryId, setErrors]);
  const save = () => {
    try {
      store.update((d) => voidEntry(d, entryId!, reason, clk()));
      toast.success('Entry voided. It stays in the history.');
      onClose();
    } catch (e) {
      handle(e);
    }
  };
  return (
    <Dialog open={entryId !== null} onClose={onClose} title="Void this entry" description="It stays in the history, crossed out, and no longer counts." testId="void-dialog" footer={<Footer onClose={onClose} onSave={save} label="Void" testId="void-save" />}>
      <TextAreaField label="Why?" value={reason} onChange={setReason} error={errors.reason ?? errors.form} rows={2} data-testid="void-reason" />
    </Dialog>
  );
}

function ObligationDialog({ obligation, open, onClose }: { obligation: Obligation | null; open: boolean; onClose: () => void }) {
  const data = useAppState((x) => x.data);
  const settings = useAppState((x) => x.settings);
  const toast = useToast();
  const run = useAction();
  const { errors, setErrors, handle } = useFormErrors();
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ObligationCategory>('other');
  const [dueDate, setDueDate] = useState('');
  const [amount, setAmount] = useState('');
  const [recurrence, setRecurrence] = useState<Obligation['recurrence']>('none');
  const [endDate, setEndDate] = useState('');
  const [reserve, setReserve] = useState('');
  useEffect(() => {
    if (!open) return;
    setDescription(obligation?.description ?? '');
    setCategory(obligation?.category ?? 'other');
    setDueDate(obligation?.dueDate ?? '');
    setAmount(obligation ? String(obligation.amount) : '');
    setRecurrence(obligation?.recurrence ?? 'none');
    setEndDate(obligation?.endDate ?? '');
    setReserve(obligation?.reserveCategoryId ?? '');
    setErrors({});
  }, [open, obligation, setErrors]);
  const save = () => {
    try {
      const input = { description, category, dueDate, amount: amount.trim() === '' ? null : Number(amount), recurrence, endDate: endDate || null, reserveCategoryId: reserve || null };
      store.update((d) => (obligation ? updateObligation(d, obligation.id, input, clk()) : addObligation(d, input, clk()).data));
      toast.success('Planned. No expense was recorded.');
      onClose();
    } catch (e) {
      handle(e);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={obligation ? `Edit “${obligation.description}”` : 'Plan an obligation'}
      description="A planning record: it doesn’t create an expense. Enter your own dates; StockPilot doesn’t assume any tax deadlines."
      testId="obligation-dialog"
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          {obligation ? (
            <Button variant="ghost" onClick={() => run(() => (store.update((d) => cancelObligation(d, obligation.id, clk())), onClose()), 'Obligation cancelled (kept in the history).')}>
              Cancel obligation
            </Button>
          ) : (
            <span />
          )}
          <Footer onClose={onClose} onSave={save} label="Save" testId="obligation-save" />
        </div>
      }
    >
      <div className="space-y-3">
        <TextField label="Description" required value={description} onChange={setDescription} error={errors.description} maxLength={200} placeholder="e.g. Insurance renewal" />
        <SelectField label="Category" value={category} onChange={(v) => setCategory(v as ObligationCategory)}>
          {(Object.keys(OBLIGATION_LABELS) as ObligationCategory[]).map((k) => (
            <option key={k} value={k}>
              {OBLIGATION_LABELS[k]}
            </option>
          ))}
        </SelectField>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Expected date" type="date" required value={dueDate} onChange={setDueDate} error={errors.dueDate} />
          <MoneyField label="Estimated amount" currency={settings.currency} value={amount} onChange={setAmount} error={errors.amount} />
        </div>
        <SelectField label="Repeats" value={recurrence} onChange={(v) => setRecurrence(v as Obligation['recurrence'])}>
          <option value="none">Doesn’t repeat</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Every 3 months</option>
          <option value="yearly">Yearly</option>
        </SelectField>
        {recurrence !== 'none' && <TextField label="Last date (optional)" type="date" value={endDate} onChange={setEndDate} error={errors.endDate} />}
        <SelectField label="Paid from reserve (optional)" value={reserve} onChange={setReserve}>
          <option value="">None</option>
          {data.planning.categories.filter((c) => !c.archived).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      </div>
    </Dialog>
  );
}
