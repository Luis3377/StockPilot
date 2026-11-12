// Sales & Profit → Monthly Close: pick a month, work through the checklist, check the inventory
// roll-forward, review the Controller's Report, then finalize. A closed month shows the figures
// as they were kept at closing; it can be reopened with a reason.

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, History, Info, Lock, RotateCcw, Undo2 } from 'lucide-react';
import type { MonthClose } from '../../domain/types';
import { undoDecision, decideStep } from '../../domain/close';
import { formatDate, formatDateTime, todayISO } from '../../domain/dates';
import { plural } from '../../domain/format';
import { closeChecklist, type Checklist, type CloseStep } from '../../insights/closeChecklist';
import { monthFigures, monthLabel, type RollForward } from '../../insights/monthly';
import { store, useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { useAction } from '../../lib/useAction';
import { Card, PageHeader, SectionHeader } from '../../ui/Card';
import { Badge, type Tone } from '../../ui/Badge';
import { Button, buttonClass } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { DecisionDialog, defaultMonth, FinalizeDialog, MonthPicker, monthOptions, ReopenDialog, StateBadge, STATE_LABEL } from './parts';

export function MonthlyClosePage() {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const today = todayISO();
  const [params, setParams] = useSearchParams();
  const months = monthOptions(data, today);
  const month = params.get('month') && /^\d{4}-\d{2}$/.test(params.get('month')!) ? params.get('month')! : defaultMonth(data, today);
  const list = closeChecklist(data, settings, month, today);
  // Keep the month in the address, so finalizing it doesn't move the page to another month.
  useEffect(() => {
    if (!params.get('month')) setParams({ month }, { replace: true });
  }, [params, month, setParams]);
  const [finalizing, setFinalizing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const options = months.includes(month) ? months : [month, ...months];
  return (
    <>
      <Link to="/sales" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Sales & Profit
      </Link>
      <PageHeader
        title="Monthly Close"
        description="Review a month’s records step by step, check that inventory adds up, and finalize the month. Finalized months are protected from accidental changes."
        actions={
          <Link to="/sales/close/history" className={buttonClass('secondary', 'md')} data-testid="close-history-link">
            <History className="size-4" aria-hidden /> History
          </Link>
        }
      />
      <Card className="mb-4 flex flex-wrap items-end justify-between gap-3 p-4">
        <MonthPicker value={month} months={options} onChange={(m) => setParams({ month: m }, { replace: true })} />
        <p className="text-sm text-ink-2">
          Reporting period: {formatDate(list.figures.range.start)} – {formatDate(list.figures.range.end)}
          {list.ended ? '' : ' (in progress)'}
        </p>
      </Card>

      <StatusCard list={list} onFinalize={() => setFinalizing(true)} onReopen={() => setReopening(true)} />
      {list.closed ? <ClosedView close={list.closed} /> : <OpenView list={list} onFinalize={() => setFinalizing(true)} />}
      <AuditCard month={month} />
      <FinalizeDialog list={list} open={finalizing} onClose={() => setFinalizing(false)} />
      <ReopenDialog month={month} open={reopening} onClose={() => setReopening(false)} />
    </>
  );
}

function StatusCard({ list, onFinalize, onReopen }: { list: Checklist; onFinalize: () => void; onReopen: () => void }) {
  const done = list.steps.filter((s) => s.state === 'completed' || s.state === 'na').length;
  const c = list.closed;
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="close-status">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink">{list.label}</h2>
            {c ? (
              <Badge tone="good" icon={<Lock className="size-3" />}>
                Closed
              </Badge>
            ) : list.ended ? (
              <Badge tone="accent">Open</Badge>
            ) : (
              <Badge tone="neutral">In progress</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-2" data-testid="close-status-text">
            {c
              ? `Closed ${formatDateTime(c.closedAt)} (version ${c.version}). Changes that would alter this month’s figures are refused until it’s reopened.`
              : list.ready
                ? 'Every step is done. Review the Controller’s Report, then finalize the month.'
                : `${done} of ${list.steps.length} checklist steps done.${list.ended ? '' : ' The month can be closed once it’s over.'}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link to={`/sales/close/${list.month}/report`} className={buttonClass('secondary', 'md')} data-testid="close-report-link">
            <FileText className="size-4" aria-hidden /> {c ? 'Closing report' : 'Preview report'}
          </Link>
          {c ? (
            <Button icon={<RotateCcw className="size-4" />} onClick={onReopen} data-testid="close-reopen">
              Reopen month
            </Button>
          ) : (
            <Button variant="primary" icon={<Lock className="size-4" />} onClick={onFinalize} disabled={!list.ready} data-testid="close-finalize">
              Finalize month
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

type Basis = [string, Tone];
const VERIFIED: Basis = ['Verified', 'good'];

function FigureRow({ label, value, basis, note, testId }: { label: string; value: ReactNode; basis?: Basis; note?: string; testId?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5" data-testid={testId}>
      <dt className="min-w-0 text-sm text-ink-2">
        {label}
        {note && <span className="block text-xs text-muted">{note}</span>}
      </dt>
      <dd className="flex items-center gap-2">
        <span className="tabular text-sm font-medium text-ink">{value}</span>
        {basis && <Badge tone={basis[1]}>{basis[0]}</Badge>}
      </dd>
    </div>
  );
}

function rfBasis(rf: Pick<RollForward, 'status'>, side: 'beginning' | 'ending'): Basis {
  if (rf.status === 'not_available') return ['Missing', 'bad'];
  if (rf.status === 'partial') return ['Not verified', 'warn'];
  if (rf.status === 'difference' && side === 'ending') return ['Difference', 'bad'];
  return VERIFIED;
}

function FiguresCard({ list }: { list: Checklist }) {
  const { money } = useMoney();
  const f = list.figures;
  const t = f.totals;
  const rf = f.rollForward;
  const incomplete: Basis | undefined = f.noCostSales.length ? ['Incomplete', 'warn'] : undefined;
  const reconBasis: Record<string, Basis> = { reconciled: ['Reconciled', 'good'], issues: ['Issues', 'bad'], partial: ['Partial', 'warn'], not_performed: ['Not performed', 'neutral'] };
  const issues = list.steps.reduce((n, s) => n + s.issues.filter((i) => i.severity === 'attention').length, 0);
  const adjustments = rf.lines.filter((l) => !['items', 'lots', 'restocks', 'cogs'].includes(l.key)).reduce((c, l) => c + l.amount, 0);
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="close-figures">
      <SectionHeader title="Financial summary" description="Verified: recalculated from your records, with the checks passing. Not verified: only partly covered by the records. Missing: can’t be worked out from the records. No estimates are used." />
      <div className="mt-3 grid gap-x-8 md:grid-cols-2">
        <dl className="divide-y divide-line">
          <FigureRow label="Sales revenue" value={money(t.revenue)} basis={VERIFIED} note={plural(t.salesCount, 'sale')} testId="fig-revenue" />
          <FigureRow label="Cost of goods sold" value={money(t.costOfGoods)} basis={incomplete ?? VERIFIED} note={incomplete ? `${plural(f.noCostSales.length, 'sale')} without a recorded cost` : undefined} testId="fig-cogs" />
          <FigureRow label="Gross profit" value={money(f.grossProfit)} basis={incomplete ?? VERIFIED} note={f.grossMarginPct === null ? undefined : `${f.grossMarginPct}% gross margin`} />
          <FigureRow label="Marketplace fees" value={money(t.fees)} basis={VERIFIED} />
          <FigureRow label="Shipping" value={money(t.shipping)} basis={VERIFIED} />
          <FigureRow label="Other selling expenses" value={money(t.otherExpenses)} basis={VERIFIED} />
          <FigureRow label="Realized profit" value={<span className={t.netProfit < 0 ? 'text-bad-text' : undefined}>{money(t.netProfit)}</span>} basis={incomplete ?? VERIFIED} note={f.marginPct === null ? undefined : `${f.marginPct}% margin`} testId="fig-profit" />
        </dl>
        <dl className="divide-y divide-line">
          <FigureRow label="Beginning inventory cost" value={rf.beginning === null ? 'Not available' : money(rf.beginning)} basis={rfBasis(rf, 'beginning')} testId="fig-beginning" />
          <FigureRow label="Inventory purchases" value={f.purchases === null ? 'Not available' : money(f.purchases)} basis={f.purchases === null ? ['Missing', 'bad'] : rf.status === 'partial' ? ['Not verified', 'warn'] : VERIFIED} note="Items, bulk lots (with their buying costs), restocks" testId="fig-purchases" />
          <FigureRow label="Adjustments and corrections" value={rf.status === 'not_available' ? 'Not available' : money(adjustments)} basis={rf.status === 'not_available' ? ['Missing', 'bad'] : undefined} note="Write-offs, units found, cost corrections, deletions" />
          <FigureRow label="Ending inventory cost" value={rf.recordsEnding === null ? 'Not available' : money(rf.recordsEnding)} basis={rfBasis(rf, 'ending')} testId="fig-ending" />
          <FigureRow label="Payout reconciliation" value={list.recon.status === 'not_performed' ? '—' : `${plural(list.recon.payouts.length, 'payout')}`} basis={reconBasis[list.recon.status]} note={list.recon.statusText} testId="fig-recon" />
          <FigureRow label="Outstanding issues" value={String(issues)} basis={issues ? ['Needs attention', 'warn'] : undefined} />
          {f.tripExpenses > 0 && <FigureRow label="Sourcing trip expenses" value={money(f.tripExpenses)} note="Recorded separately; not in realized profit" />}
        </dl>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Open month: checklist and roll-forward
// ---------------------------------------------------------------------------

function OpenView({ list, onFinalize }: { list: Checklist; onFinalize: () => void }) {
  return (
    <>
      <FiguresCard list={list} />
      <ChecklistCard list={list} onFinalize={onFinalize} />
      <RollForwardCard rf={list.figures.rollForward} />
    </>
  );
}

function ChecklistCard({ list, onFinalize }: { list: Checklist; onFinalize: () => void }) {
  const [dialog, setDialog] = useState<{ step: CloseStep; kind: 'na' | 'acknowledged' } | null>(null);
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="close-checklist">
      <SectionHeader title="Closing checklist" description="Work through each step. A step is done only when you mark it: nothing is ticked just because there are no records." />
      <ol className="mt-3 space-y-3">
        {list.steps.map((s) => (
          <StepItem key={s.step} month={list.month} step={s} onDialog={(kind) => setDialog({ step: s, kind })} />
        ))}
        <li className="rounded-xl border border-line p-3" data-testid="close-step" data-step="finalize">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-ink">
              <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-surface-2 text-xs">9</span>
              Finalize the month
            </p>
            <Badge tone={list.ready ? 'accent' : 'neutral'}>{list.ready ? 'Ready' : 'Not ready'}</Badge>
          </div>
          {list.ready ? (
            <Button className="mt-2" variant="primary" icon={<Lock className="size-4" />} onClick={onFinalize}>
              Finalize {list.label}
            </Button>
          ) : (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-2" data-testid="close-blockers">
              {list.blockers.slice(0, 9).map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </li>
      </ol>
      <DecisionDialog month={list.month} step={dialog?.step ?? null} kind={dialog?.kind ?? 'na'} onClose={() => setDialog(null)} />
    </Card>
  );
}

function StepItem({ month, step: s, onDialog }: { month: string; step: CloseStep; onDialog: (kind: 'na' | 'acknowledged') => void }) {
  const settings = useAppState((x) => x.settings);
  const run = useAction();
  const { money } = useMoney();
  const attention = s.issues.filter((i) => i.severity === 'attention');
  const decided = s.decision !== null;
  return (
    <li className={cn('rounded-xl border p-3', s.state === 'attention' ? 'border-warn/50' : 'border-line')} data-testid="close-step" data-step={s.step}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 font-medium text-ink">
          <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-surface-2 text-xs">{s.number}</span>
          {s.title}
        </p>
        <StateBadge state={s.state} />
      </div>
      <p className="mt-1 text-sm text-ink-2" data-testid="step-state">
        {s.stateText}
      </p>
      <p className="mt-1 text-xs text-muted">{s.description}</p>
      <ul className="mt-2 space-y-0.5 text-sm text-ink">
        {s.facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {s.issues.length > 0 && (
        <ul className="mt-2 space-y-1.5" data-testid="step-issues">
          {s.issues.map((i) => (
            <li key={i.id} className={cn('flex items-start gap-1.5 rounded-lg p-2 text-sm', i.severity === 'attention' ? 'bg-warn-soft text-warn-text' : 'bg-surface-2 text-ink-2')}>
              {i.severity === 'attention' ? <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0" aria-hidden />}
              <span className="min-w-0">
                {i.text}{' '}
                {i.links.map((l) => (
                  <Link key={l.href + l.label} to={l.href} className="mr-2 underline">
                    {l.label}
                  </Link>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {s.records.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-accent-text">
            Show the {plural(s.records.length, 'record')}
          </summary>
          <ul className="mt-1 divide-y divide-line" data-testid="step-records">
            {s.records.slice(0, 200).map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1">
                <span className="min-w-0">
                  <Link to={r.href} className="break-words text-accent-text hover:underline">
                    {r.label}
                  </Link>{' '}
                  <span className="text-xs text-ink-2">{r.detail}</span>
                </span>
                {r.amount !== null && <span className="tabular text-ink-2">{money(r.amount)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="mt-2 flex flex-wrap gap-2 print:hidden">
        {decided ? (
          <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => run(() => store.update((d) => undoDecision(d, month, s.step)), 'Decision undone.')} data-testid="step-undo">
            Undo
          </Button>
        ) : (
          <>
            {s.canReview && !attention.length && (
              <Button size="sm" icon={<CheckCircle2 className="size-4" />} onClick={() => run(() => store.update((d) => decideStep(d, settings, month, s.step, 'reviewed', '', todayISO())), 'Marked reviewed.')} data-testid="step-review">
                Mark reviewed
              </Button>
            )}
            {attention.length > 0 && (
              <Button size="sm" onClick={() => onDialog('acknowledged')} data-testid="step-ack">
                Acknowledge {attention.length === 1 ? 'issue' : 'issues'}…
              </Button>
            )}
            {s.canNA && (
              <Button size="sm" variant="ghost" onClick={() => onDialog('na')} data-testid="step-na">
                Not applicable…
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function RollForwardCard({ rf }: { rf: RollForward }) {
  const { money } = useMoney();
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
  const tone: Tone = rf.status === 'verified' ? 'good' : rf.status === 'difference' ? 'bad' : rf.status === 'partial' ? 'warn' : 'neutral';
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="rollforward">
      <SectionHeader title="Inventory roll-forward" description="Beginning inventory cost plus the month’s recorded movements, compared with the cost on hand from your item records." />
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm" data-testid="rf-status">
        <Badge tone={tone}>{rf.status === 'verified' ? 'Verified' : rf.status === 'difference' ? 'Difference' : rf.status === 'partial' ? 'Partly verified' : 'Not available'}</Badge>
        <span className="text-ink-2">{rf.statusText}</span>
      </p>
      {rf.status !== 'not_available' && (
        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">Inventory roll-forward</caption>
          <tbody className="divide-y divide-line">
            <tr data-testid="rf-line" data-key="beginning">
              <th scope="row" className="py-1.5 text-left font-normal text-ink-2">
                Beginning inventory cost
                <span className="block text-xs text-muted">{rf.beginningBasis}</span>
              </th>
              <td className="tabular py-1.5 text-right">{money(rf.beginning!)}</td>
            </tr>
            {rf.lines.map((l) => (
              <tr key={l.key} data-testid="rf-line" data-key={l.key}>
                <th scope="row" className="py-1.5 text-left font-normal text-ink-2">
                  {l.label}
                  {l.records.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-accent-text">{plural(l.records.length, 'record')}</summary>
                      <ul className="mt-1 space-y-0.5">
                        {l.records.slice(0, 200).map((r) => (
                          <li key={r.id}>
                            <Link to={r.href} className="text-accent-text hover:underline">
                              {r.label}
                            </Link>{' '}
                            · {formatDate(r.date)} · {r.detail} · {signed(r.amount)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </th>
                <td className={cn('tabular py-1.5 text-right', l.amount === 0 && 'text-muted')}>{signed(l.amount)}</td>
              </tr>
            ))}
            <tr data-testid="rf-line" data-key="expected" className="font-medium">
              <th scope="row" className="py-1.5 text-left">
                = Expected ending inventory cost
              </th>
              <td className="tabular py-1.5 text-right">{money(rf.expectedEnding!)}</td>
            </tr>
            <tr data-testid="rf-line" data-key="records">
              <th scope="row" className="py-1.5 text-left font-normal text-ink-2">
                Ending inventory cost from the item records
                <span className="block text-xs text-muted">{rf.recordsBasis}</span>
              </th>
              <td className="tabular py-1.5 text-right">{money(rf.recordsEnding!)}</td>
            </tr>
            <tr data-testid="rf-line" data-key="difference" className="font-medium">
              <th scope="row" className="py-1.5 text-left">
                Unexplained difference
              </th>
              <td className={cn('tabular py-1.5 text-right', rf.difference !== 0 && 'text-bad-text')}>{signed(rf.difference!)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {rf.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-ink-2" data-testid="rf-notes">
          {rf.notes.map((n) => (
            <li key={n} className="flex items-start gap-1.5">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden />
              {n}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Closed month: the snapshot
// ---------------------------------------------------------------------------

function ClosedView({ close }: { close: MonthClose }) {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const { money } = useMoney();
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
  const f = close.figures;
  const now = monthFigures(data, settings, close.month, todayISO());
  const changed = [
    ['Revenue', f.revenue, now.totals.revenue],
    ['Realized profit', f.realizedProfit, now.totals.netProfit],
    ['Cost of goods sold', f.costOfGoods, now.totals.costOfGoods],
  ].filter(([, a, b]) => a !== b) as [string, number, number][];
  const rows: [string, number | null][] = [
    ['Sales revenue', f.revenue],
    ['Cost of goods sold', f.costOfGoods],
    ['Gross profit', f.grossProfit],
    ['Marketplace fees', f.fees],
    ['Shipping', f.shipping],
    ['Other selling expenses', f.otherExpenses],
    ['Realized profit', f.realizedProfit],
    ['Beginning inventory cost', f.beginningInventory],
    ['Inventory purchases', f.purchases],
    ['Ending inventory cost', f.endingInventory],
  ];
  return (
    <>
      <Card className="mb-4 p-4 sm:p-5" data-testid="closed-figures">
        <SectionHeader title={`As closed on ${formatDate(close.closedAt)}`} description="The figures kept when the month was closed. They don’t change when records change later." />
        <dl className="mt-3 grid gap-x-8 divide-y divide-line md:grid-cols-2 md:divide-y-0">
          {rows.map(([label, v]) => (
            <FigureRow key={label} label={label} value={v === null ? 'Not available' : money(v)} />
          ))}
        </dl>
        <p className="mt-2 text-sm text-ink-2">Inventory roll-forward at closing: {close.rollForward.statusText}.</p>
        {changed.length > 0 ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-warn-soft p-2 text-sm text-warn-text" data-testid="closed-changed">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            Recalculated from today’s records: {changed.map(([l, a, b]) => `${l.toLowerCase()} ${money(b)} (${signed(b - a)} since closing)`).join('; ')}. The closing figures above are unchanged.
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted">Recalculating from today’s records gives the same figures.</p>
        )}
      </Card>
      <Card className="mb-4 p-4 sm:p-5" data-testid="closed-checklist">
        <SectionHeader title="Checklist at closing" />
        <ul className="mt-2 divide-y divide-line">
          {close.checklist.map((s) => (
            <li key={s.step} className="py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{s.title}</span>
                <Badge tone={STATE_LABEL[s.state][1]}>{STATE_LABEL[s.state][0]}</Badge>
              </div>
              {s.note && <p className="text-ink-2">{s.note}</p>}
            </li>
          ))}
        </ul>
        {close.unresolved.length > 0 && (
          <div className="mt-3 rounded-lg bg-warn-soft p-2 text-sm text-warn-text" data-testid="closed-unresolved">
            <p className="font-medium">Open issues acknowledged at closing:</p>
            <ul className="list-disc pl-5">
              {close.unresolved.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        )}
        {close.acknowledgement && <p className="mt-2 text-sm text-ink-2">Closing note: {close.acknowledgement}</p>}
      </Card>
    </>
  );
}

function AuditCard({ month }: { month: string }) {
  const audit = useAppState((s) => s.data.monthlyClose.audit).filter((a) => a.month === month);
  if (!audit.length) return null;
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="close-audit">
      <SectionHeader title={`History for ${monthLabel(month)}`} description="Every checklist decision, close and reopen, as recorded on this device. A record of what was done, not a tamper-proof log." />
      <ul className="mt-2 space-y-1 text-xs text-ink-2">
        {[...audit].reverse().map((a) => (
          <li key={a.id}>
            {formatDateTime(a.at)}: {a.detail}
          </li>
        ))}
      </ul>
    </Card>
  );
}
