import { useMemo, useState } from 'react';
import { CheckCheck, ClipboardCheck, Download, Minus, Plus, Search, X } from 'lucide-react';
import { compareCount, completeCount, discardCount, itemsInScope, setCount, startCount, type CountDecision } from '../domain/actions';
import { knownCategories, knownLocations } from '../domain/calc';
import { formatDateTime } from '../domain/dates';
import type { CountLine, CountRecord, CountScope, Item } from '../domain/types';
import { store, useAppState } from '../data/store';
import { adjustmentsCsv, discrepancyCsv } from '../csv/exports';
import { downloadText, fileStamp } from '../lib/download';
import { useMoney } from '../lib/hooks';
import { useAction } from '../lib/useAction';
import { PageHeader, Card, SectionHeader } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Dialog } from '../ui/Dialog';
import { EmptyState } from '../ui/EmptyState';
import { inputClass, Segmented, SelectField } from '../ui/Fields';
import { ItemThumb } from '../ui/Photo';
import { useConfirm } from '../ui/Confirm';
import { useToast } from '../ui/Toast';
import { cn } from '../ui/cn';

const REASONS = ['Miscounted before', 'Damaged', 'Lost', 'Stolen', 'Sold but not recorded', 'Found extra', 'Received but not recorded', 'Other'];

function scopeLabel(scope: CountScope): string {
  if (scope.category) return `Category: ${scope.category}`;
  if (scope.location) return `Location: ${scope.location}`;
  return 'All items';
}

export function CountCheckPage() {
  const data = useAppState((s) => s.data);
  return data.countDraft ? <ActiveCount /> : <StartCount />;
}

function StartCount() {
  const data = useAppState((s) => s.data);
  const dataset = useAppState((s) => s.dataset);
  const run = useAction();
  const { money } = useMoney();
  const [by, setBy] = useState<'all' | 'category' | 'location'>('all');
  const [value, setValue] = useState('');
  const [viewing, setViewing] = useState<CountRecord | null>(null);
  const categories = knownCategories({ ...data, sales: [] });
  const locations = knownLocations(data);
  const scope: CountScope = { category: by === 'category' ? value || null : null, location: by === 'location' ? value || null : null };
  const inScope = itemsInScope(data.items, scope).length;
  const history = [...data.countHistory].reverse();
  const prefix = `stockpilot-${dataset === 'demo' ? 'demo-' : ''}`;
  const corrections = data.adjustments.filter((a) => a.source === 'count_check' || a.source === 'manual');

  return (
    <>
      <PageHeader title="Count Check" description="Compare what’s physically on your shelves with what StockPilot has recorded." />
      {data.items.length === 0 ? (
        <Card>
          <EmptyState icon={<ClipboardCheck className="size-6" />} title="Nothing to count yet">
            Add items to your inventory first, then come back to check your physical stock against your records.
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_1fr] md:items-start">
            <div>
              <h2 className="text-lg font-semibold text-ink">Start a new count</h2>
              <ol className="mt-3 space-y-2 text-sm text-ink-2">
                <li>1. Choose what to count — everything, or one category or location.</li>
                <li>2. Enter how many of each item you physically find.</li>
                <li>3. Review missing and extra items, then approve the adjustments you agree with.</li>
              </ol>
              <p className="mt-3 text-xs text-muted">Your progress is saved as you go, so you can count over several sessions.</p>
            </div>
            <div className="space-y-4 rounded-2xl bg-surface-2 p-4">
              <Segmented
                label="What to count"
                className="w-full"
                value={by}
                onChange={(v) => {
                  setBy(v);
                  setValue('');
                }}
                options={[
                  { value: 'all', label: 'Everything' },
                  { value: 'category', label: 'A category' },
                  { value: 'location', label: 'A location' },
                ]}
              />
              {by !== 'all' && (
                <SelectField label={by === 'category' ? 'Category' : 'Location'} value={value} onChange={setValue}>
                  <option value="">Choose…</option>
                  {(by === 'category' ? categories : locations).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </SelectField>
              )}
              <Button
                variant="primary"
                className="w-full"
                disabled={(by !== 'all' && !value) || inScope === 0}
                onClick={() => run(() => store.update((d) => startCount(d, scope)), `Count started for ${inScope} items.`)}
              >
                Start counting {inScope > 0 && `${inScope} ${inScope === 1 ? 'item' : 'items'}`}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <SectionHeader title="Past counts" as="h2" />
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-ink-2">No counts completed yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {history.map((c) => {
                const diffs = c.lines.filter((l) => l.status !== 'match');
                const applied = c.lines.filter((l) => l.applied);
                const net = applied.reduce((s, l) => s + l.valueDifference, 0);
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{formatDateTime(c.completedAt)}</p>
                      <p className="text-xs text-ink-2">
                        {scopeLabel(c.scope)} · {c.lines.length} counted · {diffs.length} {diffs.length === 1 ? 'difference' : 'differences'} · {applied.length} applied ({money(net)})
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setViewing(c)}>
                        View
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => downloadText(`${prefix}count-${c.completedAt.slice(0, 10)}.csv`, discrepancyCsv(c.lines, c.completedAt.slice(0, 10)))}>
                        CSV
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="p-4 sm:p-5">
          <SectionHeader
            title="Adjustment log"
            description="Every approved correction and its reason"
            as="h2"
            action={
              corrections.length > 0 && (
                <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => downloadText(`${prefix}adjustments-${fileStamp()}.csv`, adjustmentsCsv(data.adjustments))}>
                  Export
                </Button>
              )
            }
          />
          {corrections.length === 0 ? (
            <p className="mt-3 text-sm text-ink-2">No adjustments yet.</p>
          ) : (
            <ul className="mt-3 max-h-80 divide-y divide-line overflow-y-auto">
              {[...corrections].reverse().map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{a.itemName}</p>
                    <p className="truncate text-xs text-ink-2">
                      {formatDateTime(a.date)} · {a.source === 'count_check' ? 'Count Check' : 'Manual'} · {a.reason || 'No reason'}
                    </p>
                  </div>
                  <span className={cn('tabular shrink-0 text-sm font-medium', a.difference < 0 ? 'text-bad-text' : 'text-good-text')}>
                    {a.difference > 0 ? '+' : ''}
                    {a.difference} · {money(a.valueDifference)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Dialog open={viewing !== null} onClose={() => setViewing(null)} title="Count results" description={viewing ? `${formatDateTime(viewing.completedAt)} · ${scopeLabel(viewing.scope)}` : ''} size="lg">
        {viewing && <LinesTable lines={viewing.lines} money={money} showApplied />}
      </Dialog>
    </>
  );
}

function LinesTable({ lines, money, showApplied }: { lines: CountLine[]; money: (n: number) => string; showApplied?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="text-left text-xs text-ink-2">
          <tr>
            <th className="py-2 font-medium">Item</th>
            <th className="py-2 text-right font-medium">Recorded</th>
            <th className="py-2 text-right font-medium">Counted</th>
            <th className="py-2 text-right font-medium">Difference</th>
            <th className="py-2 text-right font-medium">Value</th>
            {showApplied && <th className="py-2 pl-3 font-medium">Outcome</th>}
          </tr>
        </thead>
        <tbody className="tabular divide-y divide-line">
          {lines.map((l) => (
            <tr key={l.itemId}>
              <td className="py-2 pr-2 text-ink">{l.itemName}</td>
              <td className="py-2 text-right text-ink-2">{l.recordedQuantity}</td>
              <td className="py-2 text-right text-ink">{l.countedQuantity}</td>
              <td className={cn('py-2 text-right font-medium', l.difference < 0 ? 'text-bad-text' : l.difference > 0 ? 'text-good-text' : 'text-ink-2')}>
                {l.difference > 0 ? '+' : ''}
                {l.difference}
              </td>
              <td className="py-2 text-right text-ink">{money(l.valueDifference)}</td>
              {showApplied && <td className="py-2 pl-3 text-xs text-ink-2">{l.status === 'match' ? 'Match' : l.applied ? `Adjusted · ${l.reason}` : 'Not applied'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Filter = 'all' | 'todo' | 'diff';

function ActiveCount() {
  const data = useAppState((s) => s.data);
  const dataset = useAppState((s) => s.dataset);
  const draft = data.countDraft!;
  const confirm = useConfirm();
  const toast = useToast();
  const { money } = useMoney();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const scoped = useMemo(() => itemsInScope(data.items, draft.scope).sort((a, b) => (a.location || '').localeCompare(b.location || '') || a.name.localeCompare(b.name)), [data.items, draft.scope]);
  const cmp = compareCount(data.items, draft);
  const counted = cmp.lines.length;
  const lineById = new Map(cmp.lines.map((l) => [l.itemId, l]));
  const visible = scoped.filter((i) => {
    if (q.trim() && !`${i.name} ${i.sku} ${i.location}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (filter === 'todo') return draft.counts[i.id] === undefined;
    if (filter === 'diff') return (lineById.get(i.id)?.difference ?? 0) !== 0;
    return true;
  });

  const update = (itemId: string, value: number | null) => {
    try {
      store.update((d) => setCount(d, itemId, value));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that count.');
    }
  };

  const discard = async () => {
    const ok = await confirm({
      title: 'Discard this count?',
      message: `The ${counted} counts you’ve entered will be thrown away. Inventory quantities are not changed.`,
      confirmLabel: 'Discard count',
    });
    if (ok) {
      store.update(discardCount);
      toast.info('Count discarded. No quantities were changed.');
    }
  };

  return (
    <>
      <PageHeader
        title="Count Check"
        description={`${scopeLabel(draft.scope)} · started ${formatDateTime(draft.startedAt)}`}
        eyebrow={<Badge tone="accent">Count in progress</Badge>}
        actions={
          <>
            <Button variant="ghost" icon={<X className="size-4" />} onClick={() => void discard()}>
              Discard
            </Button>
            <Button icon={<Download className="size-4" />} disabled={counted === 0} onClick={() => downloadText(`stockpilot-${dataset === 'demo' ? 'demo-' : ''}count-draft-${fileStamp()}.csv`, discrepancyCsv(cmp.lines, fileStamp()))}>
              Discrepancy report
            </Button>
            <Button variant="primary" icon={<CheckCheck className="size-4" />} disabled={counted === 0} onClick={() => setReviewing(true)}>
              Review & finish
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="count-summary">
        <SummaryTile label="Counted" value={`${counted} / ${cmp.totalInScope}`} />
        <SummaryTile label="Matching" value={String(cmp.matching)} tone="good" />
        <SummaryTile label="Missing" value={`${cmp.missingUnits} units`} sub={money(cmp.missingValue)} tone={cmp.missingUnits ? 'bad' : undefined} testId="count-missing" />
        <SummaryTile label="Extra" value={`${cmp.excessUnits} units`} sub={money(cmp.excessValue)} tone={cmp.excessUnits ? 'warn' : undefined} testId="count-excess" />
        <SummaryTile label="Net value difference" value={money(cmp.netValueDifference)} tone={cmp.netValueDifference < 0 ? 'bad' : undefined} testId="count-net" />
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${cmp.totalInScope ? (counted / cmp.totalInScope) * 100 : 0}%` }} />
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item…" aria-label="Find an item to count" className={cn(inputClass, 'border-line-strong pl-9')} />
        </div>
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'todo', label: `Not counted (${cmp.uncounted.length})` },
            { value: 'diff', label: `Differences (${cmp.lines.filter((l) => l.difference !== 0).length})` },
          ]}
        />
      </div>

      <Card className="mt-3 overflow-hidden">
        {visible.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-2">{filter === 'todo' ? 'Everything here has been counted. 🎉' : 'Nothing matches.'}</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="count-list">
            {visible.map((item) => (
              <CountRow key={item.id} item={item} counted={draft.counts[item.id]} line={lineById.get(item.id)} onChange={(v) => update(item.id, v)} money={money} />
            ))}
          </ul>
        )}
      </Card>
      {cmp.uncounted.length > 0 && counted > 0 && <p className="mt-2 text-xs text-muted">Items you don’t count are left unchanged when you finish.</p>}

      <ReviewDialog open={reviewing} onClose={() => setReviewing(false)} lines={cmp.lines} uncounted={cmp.uncounted.length} />
    </>
  );
}

function SummaryTile({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' | 'warn'; testId?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-card" data-testid={testId}>
      <div className="text-xs text-ink-2">{label}</div>
      <div className={cn('mt-1 text-lg font-semibold', tone === 'bad' ? 'text-bad-text' : tone === 'warn' ? 'text-warn-text' : tone === 'good' ? 'text-good-text' : 'text-ink')}>{value}</div>
      {sub && <div className="text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

function CountRow({ item, counted, line, onChange, money }: { item: Item; counted: number | undefined; line?: CountLine; onChange: (v: number | null) => void; money: (n: number) => string }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (counted === undefined ? '' : String(counted));
  const commit = (raw: string) => {
    setText(null);
    if (raw.trim() === '') return onChange(null);
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) onChange(n);
  };
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5" data-testid="count-row">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ItemThumb photoId={item.photoIds[0]} name={item.name} className="size-11 shrink-0 rounded-lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{item.name}</p>
          <p className="truncate text-xs text-ink-2">
            {[item.sku, item.location].filter(Boolean).join(' · ')} · Recorded: <strong className="text-ink">{item.quantity}</strong>
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {line ? (
          <span className={cn('w-28 text-right text-xs font-medium', line.status === 'missing' ? 'text-bad-text' : line.status === 'excess' ? 'text-warn-text' : 'text-good-text')}>
            {line.status === 'match' ? '✓ Matches' : `${line.difference > 0 ? '+' : ''}${line.difference} (${money(line.valueDifference)})`}
          </span>
        ) : (
          <button type="button" onClick={() => onChange(item.quantity)} className="w-28 rounded-lg px-2 py-1 text-right text-xs font-medium text-accent-text hover:bg-accent-soft">
            Matches ({item.quantity})
          </button>
        )}
        <div className="flex items-stretch">
          <button type="button" aria-label={`One fewer ${item.name}`} onClick={() => onChange(Math.max(0, (counted ?? item.quantity) - 1))} className="flex w-10 items-center justify-center rounded-l-xl border border-r-0 border-line-strong bg-surface-2 text-ink-2">
            <Minus className="size-4" />
          </button>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label={`Counted quantity for ${item.name}`}
            placeholder="—"
            value={shown}
            onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className={cn(inputClass, 'tabular w-16 rounded-none! border-line-strong px-1 text-center')}
          />
          <button type="button" aria-label={`One more ${item.name}`} onClick={() => onChange((counted ?? item.quantity) + 1)} className="flex w-10 items-center justify-center rounded-r-xl border border-l-0 border-line-strong bg-surface-2 text-ink-2">
            <Plus className="size-4" />
          </button>
        </div>
      </div>
    </li>
  );
}

function ReviewDialog({ open, onClose, lines, uncounted }: { open: boolean; onClose: () => void; lines: CountLine[]; uncounted: number }) {
  const { money } = useMoney();
  const toast = useToast();
  const diffs = lines.filter((l) => l.status !== 'match');
  const [decisions, setDecisions] = useState<Record<string, { apply: boolean; reason: string; note: string }>>({});
  const get = (l: CountLine) => decisions[l.itemId] ?? { apply: true, reason: l.status === 'missing' ? 'Miscounted before' : 'Found extra', note: '' };
  const setD = (l: CountLine, patch: Partial<{ apply: boolean; reason: string; note: string }>) => setDecisions((d) => ({ ...d, [l.itemId]: { ...get(l), ...patch } }));
  const applyCount = diffs.filter((l) => get(l).apply).length;
  const net = diffs.filter((l) => get(l).apply).reduce((s, l) => s + l.valueDifference, 0);

  const finish = () => {
    const list: CountDecision[] = diffs.map((l) => {
      const d = get(l);
      const reason = d.reason === 'Other' ? d.note.trim() || 'Other' : d.note.trim() ? `${d.reason} — ${d.note.trim()}` : d.reason;
      return { itemId: l.itemId, apply: d.apply, reason };
    });
    try {
      const r = store.commit((data) => completeCount(data, list));
      toast.success(r.appliedCount ? `Count finished. ${r.appliedCount} ${r.appliedCount === 1 ? 'adjustment' : 'adjustments'} applied.` : 'Count finished. No quantities changed.');
      setDecisions({});
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not finish the count.');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Review differences"
      description={`${lines.length} counted · ${diffs.length} ${diffs.length === 1 ? 'difference' : 'differences'}${uncounted ? ` · ${uncounted} not counted (left unchanged)` : ''}`}
      size="lg"
      testId="count-review"
      footer={
        <>
          <Button onClick={onClose}>Keep counting</Button>
          <Button variant="primary" onClick={finish}>
            {applyCount ? `Apply ${applyCount} ${applyCount === 1 ? 'adjustment' : 'adjustments'} & finish` : 'Finish without changes'}
          </Button>
        </>
      }
    >
      {diffs.length === 0 ? (
        <EmptyState icon={<CheckCheck className="size-6" />} title="Everything you counted matches">
          No adjustments are needed. Finishing saves this count to your history.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            Approved adjustments set each item’s quantity to what you counted. Net effect on inventory value: <strong className={net < 0 ? 'text-bad-text' : 'text-ink'}>{money(net)}</strong>
          </p>
          <ul className="space-y-2">
            {diffs.map((l) => {
              const d = get(l);
              return (
                <li key={l.itemId} className={cn('rounded-2xl border p-3', d.apply ? 'border-line-strong' : 'border-line opacity-70')} data-testid="review-line">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={d.apply} onChange={(e) => setD(l, { apply: e.target.checked })} aria-label={`Apply adjustment for ${l.itemName}`} className="mt-1 size-5 shrink-0 accent-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-ink">{l.itemName}</p>
                        <Badge tone={l.status === 'missing' ? 'bad' : 'warn'}>
                          {l.status === 'missing' ? `${-l.difference} missing` : `${l.difference} extra`} · {money(l.valueDifference)}
                        </Badge>
                      </div>
                      <p className="text-xs text-ink-2">
                        Recorded {l.recordedQuantity} → counted {l.countedQuantity}
                      </p>
                      {d.apply && (
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <select value={d.reason} onChange={(e) => setD(l, { reason: e.target.value })} aria-label={`Reason for ${l.itemName}`} className={cn(inputClass, 'h-10 border-line-strong text-sm')}>
                            {REASONS.map((r) => (
                              <option key={r}>{r}</option>
                            ))}
                          </select>
                          <input value={d.note} onChange={(e) => setD(l, { note: e.target.value })} placeholder="Note (optional)" aria-label={`Note for ${l.itemName}`} className={cn(inputClass, 'h-10 border-line-strong text-sm')} />
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Dialog>
  );
}


