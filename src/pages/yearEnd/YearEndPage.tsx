// Sales & Profit → Year-End Review: the annual inventory roll-forward, monthly coverage, the
// year-end count, the review checklist, finalizing and reopening, and an optional tax-preparer
// worksheet. Figures are labelled verified, not verified or missing; nothing is estimated.

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ClipboardList, FileText, Lock, RotateCcw } from 'lucide-react';
import type { YearReview, YearStepKey } from '../../domain/types';
import { decideYearStep, designateYearCount, finalizeYear, reopenYear, undoYearDecision } from '../../domain/yearEnd';
import { isDomainError } from '../../domain/errors';
import { localDate } from '../../domain/ledger';
import { formatDate, formatDateTime, todayISO } from '../../domain/dates';
import { plural } from '../../domain/format';
import { yearChecklist, type YearChecklist } from '../../insights/yearChecklist';
import { COVERAGE_LABELS, currentReview, taxWorksheet, yearEndCountCandidates, type CoverageStatus } from '../../insights/yearEnd';
import { store, useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { useAction } from '../../lib/useAction';
import { useToast } from '../../ui/Toast';
import { Card, PageHeader, SectionHeader } from '../../ui/Card';
import { Badge, type Tone } from '../../ui/Badge';
import { Button, buttonClass } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Checkbox, SelectField, TextAreaField } from '../../ui/Fields';
import { DecisionDialog, StateBadge, type StepView } from '../close/parts';
import { RollForwardCard, StepItem } from '../close/MonthlyClosePage';
import { cn } from '../../ui/cn';

const COVERAGE_TONE: Record<CoverageStatus, Tone> = { verified: 'good', exceptions: 'warn', open: 'warn', missing: 'bad', not_verifiable: 'neutral', future: 'neutral' };

function yearOptions(years: string[], current: string): string[] {
  const first = years.length ? years.reduce((a, b) => (a < b ? a : b)) : current;
  const out: string[] = [];
  for (let y = Number(current); y >= Number(first) && out.length < 30; y--) out.push(String(y));
  return out;
}

export function YearEndPage() {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const today = todayISO();
  const [params, setParams] = useSearchParams();
  const thisYear = today.slice(0, 4);
  const years = yearOptions([...data.sales.map((s) => s.saleDate.slice(0, 4)), ...data.inventoryLedger.events.map((e) => e.date.slice(0, 4)), ...data.items.map((i) => (i.purchaseDate ?? localDate(i.createdAt)).slice(0, 4))], thisYear);
  const fallback = years.find((y) => y < thisYear && !currentReview(data, y)) ?? thisYear;
  const key = /^\d{4}$/.test(params.get('year') ?? '') ? params.get('year')! : fallback;
  useEffect(() => {
    if (!params.get('year')) setParams({ year: key }, { replace: true });
  }, [params, key, setParams]);
  const list = yearChecklist(data, settings, key, today);
  const [finalizing, setFinalizing] = useState(false);
  const [reopening, setReopening] = useState(false);
  return (
    <>
      <Link to="/sales" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Sales & Profit
      </Link>
      <PageHeader
        title="Year-End Review"
        description="Where your inventory money went this year, and whether your inventory records reconcile: beginning inventory, purchases, cost of goods sold, write-offs and what’s left at year-end."
        actions={
          <Link to="/sales/close" className={buttonClass('secondary', 'md')}>
            <ClipboardList className="size-4" aria-hidden /> Monthly Close
          </Link>
        }
      />
      <Card className="mb-4 flex flex-wrap items-end justify-between gap-3 p-4">
        <SelectField label="Year" value={key} onChange={(y) => setParams({ year: y }, { replace: true })} className="sm:w-60" data-testid="year-select">
          {(years.includes(key) ? years : [key, ...years]).map((y) => (
            <option key={y} value={y}>
              {y}
              {currentReview(data, y) ? ' · finalized' : y === thisYear ? ' · in progress' : ''}
            </option>
          ))}
        </SelectField>
        <p className="text-sm text-ink-2">
          Calendar year: {formatDate(list.figures.period.start)} – {formatDate(list.figures.period.end)}
        </p>
      </Card>
      <StatusCard list={list} onFinalize={() => setFinalizing(true)} onReopen={() => setReopening(true)} />
      {list.flags.length > 0 && (
        <Card className="mb-4 border-warn/50 p-4" data-testid="year-flags">
          <p className="flex items-center gap-1.5 font-medium text-warn-text">
            <AlertTriangle className="size-4" aria-hidden /> This finalized review needs re-review
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-2">
            {list.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">The finalized figures below are unchanged. Reopen the year to review and finalize it again.</p>
        </Card>
      )}
      {list.review ? <FinalizedFigures review={list.review} /> : <Dashboard list={list} />}
      {!list.review && <RollForwardCard rf={list.figures.rf} title="Annual inventory roll-forward" description="Beginning inventory plus the year’s recorded movements, compared with the item records at year-end. Each line lists its records." />}
      <CoverageCard list={list} />
      <CountCard list={list} />
      {!list.review && <ChecklistCard list={list} onFinalize={() => setFinalizing(true)} />}
      <WorksheetCard list={list} />
      <YearAudit keyName={key} />
      <FinalizeYearDialog list={list} open={finalizing} onClose={() => setFinalizing(false)} />
      <ReopenYearDialog keyName={key} open={reopening} onClose={() => setReopening(false)} />
    </>
  );
}

function StatusCard({ list, onFinalize, onReopen }: { list: YearChecklist; onFinalize: () => void; onReopen: () => void }) {
  const done = list.steps.filter((s) => s.state === 'completed' || s.state === 'na').length;
  const r = list.review;
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="year-status">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink">{list.label}</h2>
            {r ? <Badge tone={list.flags.length ? 'warn' : 'good'}>{list.flags.length ? 'Finalized · needs re-review' : 'Finalized'}</Badge> : <Badge tone={list.ended ? 'accent' : 'neutral'}>{list.ended ? 'Open' : 'In progress'}</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-2" data-testid="year-status-text">
            {r ? `Finalized ${formatDateTime(r.finalizedAt)} (version ${r.version}).` : list.ready ? 'Every step is done. Review the summary, then finalize the year.' : `${done} of ${list.steps.length} review steps done.${list.ended ? '' : ' The year can be finalized once it’s over.'}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link to={`/sales/year-end/${list.key}/report`} className={buttonClass('secondary', 'md')} data-testid="year-report-link">
            <FileText className="size-4" aria-hidden /> {r ? 'Finalized summary' : 'Accountant summary'}
          </Link>
          {r ? (
            <Button icon={<RotateCcw className="size-4" />} onClick={onReopen} data-testid="year-reopen">
              Reopen year
            </Button>
          ) : (
            <Button variant="primary" icon={<Lock className="size-4" />} onClick={onFinalize} disabled={!list.ready} data-testid="year-finalize">
              Finalize year
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

type Basis = [string, Tone];
const VERIFIED: Basis = ['Verified', 'good'];
const MISSING: Basis = ['Missing', 'bad'];
const UNVERIFIED: Basis = ['Not verified', 'warn'];

function Row({ label, value, basis, note, testId }: { label: string; value: ReactNode; basis?: Basis; note?: string; testId?: string }) {
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

function Dashboard({ list }: { list: YearChecklist }) {
  const { money } = useMoney();
  const y = list.figures;
  const rf = y.rf;
  const avail = rf.status !== 'not_available';
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
  const other = (['decreases', 'withdrawals', 'increases', 'returns', 'removed', 'sale_corrections'] as const).reduce((c, k) => c + y.line(k), 0);
  const ledgerBasis: Basis = rf.status === 'partial' ? UNVERIFIED : VERIFIED;
  const closed = y.coverage.months.filter((m) => m.status === 'verified' || m.status === 'exceptions').length;
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="year-dashboard">
      <SectionHeader title={`${list.label} at a glance`} description="Verified: worked out from dated records, with the checks passing. Not verified: only partly covered by the records. Missing: the records can’t establish it. All amounts are at cost." />
      <div className="mt-3 grid gap-x-8 md:grid-cols-2">
        <dl className="divide-y divide-line">
          <Row label="Beginning inventory" value={avail ? money(rf.beginning!) : 'Not available'} basis={y.beginning.status === 'verified' ? VERIFIED : y.beginning.status === 'partial' ? UNVERIFIED : MISSING} note={y.beginning.text} testId="ye-beginning" />
          <Row label="Purchases and acquisition costs" value={y.purchases === null ? 'Not available' : money(y.purchases)} basis={y.purchases === null ? MISSING : ledgerBasis} note={y.capitalizedCosts ? `Includes ${money(y.capitalizedCosts)} of freight, premiums and other buying costs on bulk lots` : 'Items, bulk lots and restocks'} testId="ye-purchases" />
          <Row label="Inventory cost corrections" value={avail ? signed(y.line('corrections')) : 'Not available'} basis={avail ? ledgerBasis : MISSING} />
          <Row label="Cost of goods sold (recorded sales)" value={money(y.totals.costOfGoods)} basis={VERIFIED} note={`${plural(y.totals.salesCount, 'sale')}${rf.status === 'partial' ? '; only sales recorded since the ledger began are in the roll-forward' : ''}`} testId="ye-cogs" />
          <Row label="Write-offs and other movements" value={avail ? signed(other) : 'Not available'} basis={avail ? ledgerBasis : MISSING} note="Damaged, lost, personal use, returns, units found, deletions, sale edits" />
        </dl>
        <dl className="divide-y divide-line">
          <Row label="Expected ending inventory" value={avail ? money(rf.expectedEnding!) : 'Not available'} basis={avail ? ledgerBasis : MISSING} testId="ye-expected" />
          <Row label="Independently determined ending inventory" value={y.independentEnding === null ? 'Not available' : money(y.independentEnding)} basis={y.independentEnding === null ? MISSING : y.count ? VERIFIED : ledgerBasis} note={y.independentBasis} testId="ye-independent" />
          <Row label="Unexplained difference" value={y.difference === null ? 'Not available' : <span className={y.difference ? 'text-bad-text' : undefined}>{signed(y.difference)}</span>} basis={y.difference === null ? MISSING : y.difference ? ['Difference', 'bad'] : rf.status === 'partial' ? UNVERIFIED : VERIFIED} testId="ye-difference" />
          <Row label="Monthly closing coverage" value={`${closed} of 12 months closed`} basis={y.coverage.complete ? VERIFIED : ['Incomplete', 'warn']} testId="ye-coverage" />
          <Row label="Year-end review status" value={list.review ? 'Finalized' : list.ready ? 'Ready to finalize' : 'In review'} />
        </dl>
      </div>
      {!avail && (
        <p className="mt-3 rounded-lg bg-surface-2 p-2 text-sm text-ink-2" data-testid="ye-missing">
          Cannot fully verify. Missing evidence: {y.beginning.missing.join('; ')}.
        </p>
      )}
    </Card>
  );
}

function FinalizedFigures({ review }: { review: YearReview }) {
  const { money } = useMoney();
  const f = review.figures;
  const v = (n: number | null) => (n === null ? 'Not available' : money(n));
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="year-finalized">
      <SectionHeader title={`As finalized on ${formatDate(review.finalizedAt)}`} description="The figures kept when the year was finalized. Later changes never alter them; they’re flagged above instead." />
      <dl className="mt-3 grid gap-x-8 divide-y divide-line md:grid-cols-2 md:divide-y-0">
        <Row label="Beginning inventory" value={v(f.beginning)} note={f.beginningBasis} />
        <Row label="Purchases and acquisition costs" value={v(f.purchases)} />
        <Row label="Cost of goods sold" value={money(f.costOfGoodsSold)} />
        <Row label="Expected ending inventory" value={v(f.expectedEnding)} />
        <Row label="Independently determined ending inventory" value={v(f.independentEnding)} note={f.independentBasis} />
        <Row label="Unexplained difference" value={v(f.difference)} />
      </dl>
      {review.unresolved.length > 0 && (
        <div className="mt-3 rounded-lg bg-warn-soft p-2 text-sm text-warn-text">
          <p className="font-medium">Open issues acknowledged at finalizing:</p>
          <ul className="list-disc pl-5">
            {review.unresolved.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function CoverageCard({ list }: { list: YearChecklist }) {
  const { money } = useMoney();
  const c = list.figures.coverage;
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="year-coverage">
      <SectionHeader title="Monthly closes" description="The year is built from its months. Close each month in Monthly Close; the year shows which are verified, closed with exceptions, open, missing, or before StockPilot’s records began." />
      <ul className="mt-2 divide-y divide-line">
        {c.months.map((m) => (
          <li key={m.month} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm" data-testid="year-month">
            <span className="min-w-0">
              <Link to={`/sales/close?month=${m.month}`} className="font-medium text-accent-text hover:underline">
                {m.label}
              </Link>{' '}
              <span className="text-xs text-ink-2">{m.statusText}</span>
            </span>
            <Badge tone={COVERAGE_TONE[m.status]}>{COVERAGE_LABELS[m.status]}</Badge>
          </li>
        ))}
      </ul>
      {c.inconsistencies.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-warn-text" data-testid="year-inconsistencies">
          {c.inconsistencies.map((x) => (
            <li key={x.id}>{x.text}</li>
          ))}
        </ul>
      )}
      {c.sums && !c.inconsistencies.some((x) => x.id.startsWith('sum:')) && (
        <p className="mt-2 text-sm text-ink-2" data-testid="year-sums">
          The twelve monthly closes add up to the year: {c.sums.map((s) => `${s.label.toLowerCase()} ${money(s.year)}`).join(', ')}.
        </p>
      )}
    </Card>
  );
}

function CountCard({ list }: { list: YearChecklist }) {
  const data = useAppState((s) => s.data);
  const { money } = useMoney();
  const run = useAction();
  const c = list.figures.count;
  const candidates = yearEndCountCandidates(data, list.figures.period);
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
  const label: Record<string, string> = { match: 'Matches', needs_recount: 'Needs recount', missing_or_damaged: 'Missing or damaged', found: 'Found' };
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="year-count">
      <SectionHeader title="Year-end inventory count" description={`Count everything on hand on or near ${formatDate(list.figures.period.end)} with Count Check (no category or location filter), then choose it here. Differences you apply are recorded once, dated, with a reason; past quantities are never rewritten.`} />
      {c ? (
        <>
          <p className="mt-2 text-sm text-ink" data-testid="year-count-basis">
            {c.basis}. Counted inventory at year-end: <span className="font-medium">{money(c.countedEndingCents / 100)}</span> ({signed(c.differenceCents / 100)} against the item records).
          </p>
          <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Year-end count lines">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 font-medium">Item</th>
                  <th className="py-1 text-right font-medium">Recorded</th>
                  <th className="py-1 text-right font-medium">Counted</th>
                  <th className="py-1 text-right font-medium">Difference</th>
                  <th className="py-1 text-right font-medium">Cost impact</th>
                  <th className="py-1 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {c.lines.map((l) => (
                  <tr key={l.itemId} data-testid="year-count-line">
                    <th scope="row" className="py-1.5 text-left font-normal">
                      <Link to={`/inventory/${l.itemId}`} className="text-accent-text hover:underline">
                        {l.itemName}
                      </Link>
                    </th>
                    <td className="tabular py-1.5 text-right">{l.recordedQuantity}</td>
                    <td className="tabular py-1.5 text-right">{l.countedQuantity}</td>
                    <td className="tabular py-1.5 text-right">{l.difference > 0 ? `+${l.difference}` : l.difference}</td>
                    <td className="tabular py-1.5 text-right">{signed(l.valueDifference)}</td>
                    <td className={cn('py-1.5 text-right text-xs', l.status === 'needs_recount' && 'text-warn-text')}>{label[l.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-2">No year-end count chosen. Ending inventory comes from the item records.</p>
      )}
      {!list.review && (
        <div className="mt-3 flex flex-wrap items-end gap-2 print:hidden">
          {candidates.length > 0 && (
            <SelectField
              label="Year-end count"
              value={c?.record.id ?? ''}
              onChange={(v) => run(() => store.update((d) => designateYearCount(d, list.key, v || null)), v ? 'Year-end count chosen.' : 'Year-end count cleared.')}
              className="sm:w-80"
              data-testid="year-count-select"
            >
              <option value="">None</option>
              {candidates.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatDate(localDate(r.completedAt))} · {plural(r.lines.length, 'item')}
                  {r.scope.category || r.scope.location ? ' · partial' : ''}
                </option>
              ))}
            </SelectField>
          )}
          <Link to="/count" className={buttonClass('secondary', 'md')}>
            Open Count Check
          </Link>
        </div>
      )}
    </Card>
  );
}

function ChecklistCard({ list, onFinalize }: { list: YearChecklist; onFinalize: () => void }) {
  const settings = useAppState((s) => s.settings);
  const [dialog, setDialog] = useState<{ step: StepView; kind: 'na' | 'acknowledged' } | null>(null);
  const toast = useToast();
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="year-checklist">
      <SectionHeader title="Year-end review" description="Work through each step. Nothing is ticked automatically; open issues can be acknowledged with a note and are kept with the finalized review." />
      <ol className="mt-3 space-y-3">
        {list.steps.map((s) => (
          <StepItem
            key={s.step}
            step={s}
            onDialog={(kind) => setDialog({ step: s, kind })}
            onReview={() => store.update((d) => decideYearStep(d, settings, list.key, s.step, 'reviewed', '', todayISO()))}
            onUndo={() => store.update((d) => undoYearDecision(d, list.key, s.step))}
          />
        ))}
        <li className="rounded-xl border border-line p-3" data-testid="close-step" data-step="finalize">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-ink">
              <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-surface-2 text-xs">{list.steps.length + 1}</span>
              Finalize the year
            </p>
            <StateBadge state={list.ready ? 'todo' : 'attention'} />
          </div>
          {list.ready ? (
            <Button className="mt-2" variant="primary" icon={<Lock className="size-4" />} onClick={onFinalize}>
              Finalize {list.label}
            </Button>
          ) : (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-2" data-testid="year-blockers">
              {list.blockers.slice(0, 8).map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </li>
      </ol>
      <DecisionDialog
        month={list.key}
        step={dialog?.step ?? null}
        kind={dialog?.kind ?? 'na'}
        onClose={() => setDialog(null)}
        onSave={(note) => {
          store.update((d) => decideYearStep(d, settings, list.key, dialog!.step.step as YearStepKey, dialog!.kind, note, todayISO()));
          toast.success(dialog!.kind === 'na' ? 'Marked not applicable.' : 'Issues acknowledged.');
        }}
      />
    </Card>
  );
}

function WorksheetCard({ list }: { list: YearChecklist }) {
  const settings = useAppState((s) => s.settings);
  const { money } = useMoney();
  const ws = taxWorksheet(list.figures, settings);
  const tag: Record<string, [string, Tone]> = { recorded: ['Recorded figure', 'good'], needs_review: ['Needs review', 'warn'], not_tracked: ['Not tracked', 'neutral'] };
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="year-worksheet">
      <details>
        <summary className="cursor-pointer font-semibold text-ink">Optional: worksheet for a tax preparer (Schedule C, Part III layout)</summary>
        <p className="mt-2 rounded-lg bg-surface-2 p-2 text-sm text-ink-2" data-testid="worksheet-disclaimer">
          {ws.disclaimer}
        </p>
        <ul className="mt-2 divide-y divide-line text-sm">
          {ws.lines.map((l) => (
            <li key={l.line} className="py-2" data-testid="worksheet-line">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-ink">
                  Line {l.line}. {l.label}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular">{l.amount === null ? '—' : money(l.amount)}</span>
                  <Badge tone={tag[l.status][1]}>{tag[l.status][0]}</Badge>
                </span>
              </div>
              <p className="text-xs text-ink-2">{l.note}</p>
            </li>
          ))}
        </ul>
        {ws.bridge.length > 0 && (
          <p className="mt-2 text-sm text-ink-2" data-testid="worksheet-bridge">
            Line 42 compared with your records: {ws.bridge.map((b) => `${b.label.toLowerCase()} ${money(b.amount)}`).join(' + ')}.
          </p>
        )}
      </details>
    </Card>
  );
}

function YearAudit({ keyName }: { keyName: string }) {
  const audit = useAppState((s) => s.data.yearEnd.audit).filter((a) => a.periodKey === keyName);
  const reviews = useAppState((s) => s.data.yearEnd.reviews).filter((r) => r.periodKey === keyName);
  if (!audit.length && !reviews.length) return null;
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="year-audit">
      <SectionHeader title={`History for ${keyName}`} description="Versions and every decision, count choice, finalization, reopening and flag, as recorded on this device. A record of what was done, not a tamper-proof log." />
      {reviews.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm" data-testid="year-versions">
          {[...reviews].sort((a, b) => b.version - a.version).map((r) => (
            <li key={r.id}>
              <Link to={`/sales/year-end/${keyName}/report?version=${r.version}`} className="text-accent-text underline">
                Version {r.version}
              </Link>{' '}
              · finalized {formatDateTime(r.finalizedAt)} · {r.status === 'finalized' ? 'current' : `superseded ${formatDateTime(r.supersededAt ?? r.finalizedAt)}: ${r.reopenReason}`}
            </li>
          ))}
        </ul>
      )}
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

function FinalizeYearDialog({ list, open, onClose }: { list: YearChecklist; open: boolean; onClose: () => void }) {
  const settings = useAppState((s) => s.settings);
  const toast = useToast();
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setAck(false);
      setNote('');
      setError('');
    }
  }, [open]);
  const save = () => {
    try {
      store.commit((d) => finalizeYear(d, settings, list.key, { acknowledged: ack, note }, todayISO()));
      toast.success(`The ${list.key} year-end review is finalized.`);
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
      title={`Finalize ${list.key}`}
      description="Finalizing keeps the year’s figures, calculations, count reference, review decisions, open issues and summary as they are now. Afterwards, changes to the year’s months are refused unless you reopen the year, or reopen a month (which flags the year for re-review)."
      testId="year-finalize-dialog"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={list.unresolved.length > 0 && !ack} data-testid="year-finalize-confirm">
            Finalize year
          </Button>
        </div>
      }
    >
      {list.unresolved.length > 0 && (
        <div className="rounded-xl bg-warn-soft p-3" data-testid="year-unresolved">
          <p className="text-sm font-medium text-warn-text">{plural(list.unresolved.length, 'open issue')} will be kept with the review:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-warn-text">
            {list.unresolved.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
          <div className="mt-3">
            <Checkbox checked={ack} onChange={setAck} label="I’ve reviewed these open issues and want to finalize the year with them on record." />
          </div>
        </div>
      )}
      <TextAreaField className="mt-3" label="Note (optional)" value={note} onChange={setNote} rows={2} maxLength={1000} />
      {error && (
        <p className="mt-2 text-sm text-bad-text" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function ReopenYearDialog({ keyName, open, onClose }: { keyName: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setReason('');
      setError('');
    }
  }, [open]);
  const save = () => {
    try {
      store.update((d) => reopenYear(d, keyName, reason));
      toast.success(`${keyName} is open for corrections. Review it again before finalizing.`);
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
      title={`Reopen ${keyName}`}
      description="The current review is kept and marked superseded, with your reason. Monthly locks still apply: reopen a closed month in Monthly Close to correct it."
      testId="year-reopen-dialog"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} data-testid="year-reopen-confirm">
            Reopen year
          </Button>
        </div>
      }
    >
      <TextAreaField label="Why are you reopening it?" required value={reason} onChange={setReason} rows={3} error={error} maxLength={1000} data-testid="year-reopen-reason" />
    </Dialog>
  );
}
