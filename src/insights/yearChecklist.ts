// The year-end review checklist. Like the monthly one, a step is done only when the user marks
// it (reviewed, not applicable with an explanation, or issues acknowledged with a note), and a
// decision goes stale when the step's records change. A finalized year is flagged, never
// silently changed, when a month in it is reopened or its records no longer give the same figures.

import type { AppData, Settings, YearDecision, YearReview, YearStepKey } from '../domain/types';
import { formatDate, formatDateTime } from '../domain/dates';
import { formatMoney, toCents } from '../domain/money';
import { plural } from '../domain/format';
import { hash, type CloseIssue, type StepRecord, type StepState } from './closeChecklist';
import { MOVEMENT_LABELS, type MovementKey } from './monthly';
import { COVERAGE_LABELS, currentReview, periodMonths, yearEndCountCandidates, yearFigures, type YearFigures } from './yearEnd';

export const YEAR_STEP_TITLES: Record<YearStepKey, string> = {
  months: 'Check the monthly closes',
  beginning: 'Confirm beginning inventory',
  movements: 'Review purchases, corrections and write-offs',
  reconciliation: 'Reconcile ending inventory',
  count: 'Year-end inventory count',
  report: 'Review the year-end summary',
};

export interface YearStep {
  step: YearStepKey;
  number: number;
  title: string;
  description: string;
  facts: string[];
  records: StepRecord[];
  issues: CloseIssue[];
  canReview: boolean;
  canNA: boolean;
  naExplanation: string;
  fingerprint: string;
  decision: YearDecision | null;
  stale: boolean;
  state: StepState;
  stateText: string;
}

export interface YearChecklist {
  key: string;
  label: string;
  figures: YearFigures;
  steps: YearStep[];
  review: YearReview | null;
  /** Why a finalized review needs re-review (month reopened, figures changed…). */
  flags: string[];
  ended: boolean;
  ready: boolean;
  blockers: string[];
  unresolved: string[];
}

/** Reasons a finalized year-end review no longer stands as it was. Never changes the review itself. */
export function yearFlags(data: AppData, settings: Pick<Settings, 'currency'>, review: YearReview, y: YearFigures): string[] {
  const money = (n: number) => formatMoney(n, settings.currency);
  const flags: string[] = [];
  const months = new Set(periodMonths(y.period));
  for (const a of data.monthlyClose.audit) {
    if (a.kind === 'reopened' && months.has(a.month) && a.at > review.finalizedAt) flags.push(`${a.detail} (${formatDateTime(a.at)}), after the year was finalized.`);
  }
  for (const m of y.coverage.months) {
    const then = review.coverage.find((c) => c.month === m.month);
    if (then && m.close && then.closeVersion !== m.close.version) flags.push(`${m.label} was closed again (version ${m.close.version}) after the year was finalized.`);
  }
  const f = review.figures;
  const pairs: [string, number | null, number | null][] = [
    ['Beginning inventory', f.beginning, y.rf.beginning],
    ['Purchases', f.purchases, y.purchases],
    ['Cost of goods sold', f.costOfGoodsSold, -y.line('cogs')],
    ['Ending inventory (item records)', f.recordsEnding, y.rf.recordsEnding],
    ['Ending inventory (independent)', f.independentEnding, y.independentEnding],
  ];
  for (const [label, a, b] of pairs) {
    if ((a === null) !== (b === null) || (a !== null && b !== null && toCents(a) !== toCents(b))) flags.push(`${label}: ${a === null ? 'not available' : money(a)} when finalized, ${b === null ? 'not available' : money(b)} from today’s records.`);
  }
  return flags;
}

export function yearChecklist(data: AppData, settings: Settings, key: string, today: string): YearChecklist {
  const money = (n: number) => formatMoney(n, settings.currency);
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
  const y = yearFigures(data, settings, key, today);
  const L = y.period.label;
  const rf = y.rf;
  const review = currentReview(data, key);
  const decisions = data.yearEnd.decisions[key] ?? [];
  type Draft = Omit<YearStep, 'number' | 'fingerprint' | 'decision' | 'stale' | 'state' | 'stateText' | 'title'>;
  const drafts: Draft[] = [];

  // 1. Monthly closes
  {
    const c = y.coverage;
    const by = (s: string) => c.months.filter((m) => m.status === s);
    const issues: CloseIssue[] = [];
    if (by('missing').length) issues.push({ id: `months:missing:${by('missing').map((m) => m.month).join(',')}`, severity: 'attention', text: `${plural(by('missing').length, 'month')} never closed: ${by('missing').map((m) => m.label).join(', ')}.`, links: by('missing').slice(0, 3).map((m) => ({ label: `Close ${m.label}`, href: `/sales/close?month=${m.month}` })) });
    for (const m of by('open')) issues.push({ id: `month:${m.month}:open`, severity: 'attention', text: `${m.label}: ${m.statusText}.`, links: [{ label: `Monthly Close: ${m.label}`, href: `/sales/close?month=${m.month}` }] });
    if (by('not_verifiable').length) issues.push({ id: `months:not-verifiable:${by('not_verifiable').length}`, severity: 'attention', text: `${plural(by('not_verifiable').length, 'month')} (${by('not_verifiable').map((m) => m.label).join(', ')}) can’t be fully verified: they’re before StockPilot’s dated inventory records began.`, links: [] });
    if (by('future').length) issues.push({ id: 'months:future', severity: 'attention', text: `${L} isn’t over: ${plural(by('future').length, 'month')} still to come.`, links: [] });
    for (const x of c.inconsistencies) issues.push({ id: x.id, severity: 'attention', text: x.text, links: [] });
    for (const m of by('exceptions')) issues.push({ id: `exceptions:${m.month}:${m.close?.version}`, severity: 'info', text: `${m.label}: ${m.statusText}.`, links: [{ label: `Monthly Close: ${m.label}`, href: `/sales/close?month=${m.month}` }] });
    drafts.push({
      step: 'months',
      description: 'The year is built from its months. Closed months are protected; gaps and inconsistencies are listed here.',
      facts: [(['verified', 'exceptions', 'open', 'missing', 'not_verifiable', 'future'] as const).filter((s) => by(s).length).map((s) => `${COVERAGE_LABELS[s]}: ${by(s).length}`).join(' · ')],
      records: c.months.map((m) => ({ id: m.month, label: m.label, detail: `${COVERAGE_LABELS[m.status]} — ${m.statusText}`, href: `/sales/close?month=${m.month}`, amount: m.close?.figures.endingInventory ?? null })),
      issues,
      canReview: true,
      canNA: false,
      naExplanation: '',
    });
  }

  // 2. Beginning inventory
  {
    const b = y.beginning;
    drafts.push({
      step: 'beginning',
      description: `Inventory cost on ${formatDate(y.period.start)}: carried from last year’s review or December close, or from the dated inventory records.`,
      facts: [rf.beginning === null ? 'Beginning inventory: not available' : `Beginning inventory ${money(rf.beginning)}`, b.text],
      records: [],
      issues: b.status === 'verified' ? [] : [{ id: `beginning:${b.status}`, severity: 'attention', text: `${b.text} Missing evidence: ${b.missing.join('; ')}.`, links: [] }],
      canReview: true,
      canNA: false,
      naExplanation: '',
    });
  }

  // 3. Movements
  {
    const keys: MovementKey[] = ['items', 'lots', 'restocks', 'corrections', 'decreases', 'withdrawals', 'increases', 'returns', 'removed', 'sale_corrections'];
    const records: StepRecord[] = rf.lines.filter((l) => keys.includes(l.key)).flatMap((l) => l.records.map((r) => ({ id: `${l.key}:${r.id}`, label: r.label, detail: `${l.label} · ${formatDate(r.date)} · ${r.detail}`, href: r.href, amount: r.amount })));
    const issues: CloseIssue[] = [];
    for (const l of rf.lines.filter((x) => x.key === 'removed' || x.key === 'sale_corrections')) {
      for (const r of l.records) issues.push({ id: `${l.key}:${r.id}`, severity: 'attention', text: l.key === 'removed' ? `${r.label} was deleted with ${money(Math.abs(r.amount))} of stock at cost on ${formatDate(r.date)}, with no write-off reason.` : `${r.label}: a sale was edited or cancelled on ${formatDate(r.date)}, changing inventory cost by ${signed(r.amount)}.`, links: [{ label: r.label, href: r.href }] });
    }
    if (y.line('withdrawals')) issues.push({ id: 'withdrawals', severity: 'info', text: `${money(-y.line('withdrawals'))} of merchandise was recorded as used personally.`, links: [] });
    drafts.push({
      step: 'movements',
      description: 'Everything that added to or took from inventory cost during the year, apart from items sold: purchases (with bulk-lot buying costs), cost corrections, write-offs, personal use, returns and deletions.',
      facts: rf.status === 'not_available' ? ['Not available: no dated inventory records for this year.'] : keys.map((k) => [k, y.line(k)] as const).filter(([, v]) => v !== 0).map(([k, v]) => `${MOVEMENT_LABELS[k]}: ${signed(v)}`),
      records,
      issues,
      canReview: rf.status !== 'not_available',
      canNA: rf.status === 'not_available',
      naExplanation: `Not available: StockPilot has no dated inventory records for ${L}.`,
    });
  }

  // 4. Reconciliation
  {
    const issues: CloseIssue[] = [];
    if (y.difference !== null && y.difference !== 0) issues.push({ id: `difference:${y.difference}`, severity: 'attention', text: `Unexplained difference of ${signed(y.difference)}: ${y.bookDifference ? `${signed(y.bookDifference)} between the item records and the dated movements` : ''}${y.bookDifference && y.countDifference ? ', and ' : ''}${y.countDifference ? `${signed(y.countDifference)} between the year-end count and the item records` : ''}.`, links: [] });
    if (rf.status === 'not_available' || rf.status === 'partial') issues.push({ id: `reconcile:${rf.status}`, severity: 'attention', text: `Cannot fully verify: ${rf.statusText}.`, links: [] });
    if (!y.ended) issues.push({ id: 'year:open', severity: 'attention', text: `${L} isn’t over yet.`, links: [] });
    drafts.push({
      step: 'reconciliation',
      description: 'Beginning inventory plus the year’s recorded movements gives the expected ending inventory. It’s compared with ending inventory established separately: a year-end count if you designate one, otherwise the item records at year-end.',
      facts: [
        `Expected ending ${rf.expectedEnding === null ? 'not available' : money(rf.expectedEnding)} · ${y.count ? 'counted' : 'item records'} ${y.independentEnding === null ? 'not available' : money(y.independentEnding)} · difference ${y.difference === null ? 'not available' : signed(y.difference)}`,
        `${y.independentBasis}.`,
      ],
      records: [],
      issues,
      canReview: true,
      canNA: false,
      naExplanation: '',
    });
  }

  // 5. Year-end count
  {
    const c = y.count;
    const candidates = yearEndCountCandidates(data, y.period);
    const issues: CloseIssue[] = [];
    if (c) {
      const recount = c.lines.filter((l) => l.status === 'needs_recount');
      for (const l of recount.slice(0, 20)) issues.push({ id: `recount:${c.record.id}:${l.itemId}`, severity: 'attention', text: `Recount ${l.itemName}: counted ${l.countedQuantity}, records say ${l.recordedQuantity} (difference not applied, ${signed(l.valueDifference)} at cost).`, links: [{ label: l.itemName, href: `/inventory/${l.itemId}` }] });
      if (recount.length > 20) issues.push({ id: `recount:more:${recount.length}`, severity: 'attention', text: `${recount.length - 20} more items need a recount.`, links: [] });
      if (!c.full) issues.push({ id: `count:partial:${c.record.id}`, severity: 'info', text: 'The count covered only some items (a category or location); the rest come from the item records.', links: [] });
      if (c.timing !== 'on') issues.push({ id: `count:timing:${c.record.id}`, severity: 'info', text: `${c.basis}.`, links: [] });
    } else if (candidates.length) {
      issues.push({ id: `count:candidates:${candidates.length}`, severity: 'info', text: `${plural(candidates.length, 'count')} completed near the year-end can be designated as the year-end count.`, links: [{ label: 'Count Check', href: '/count' }] });
    }
    drafts.push({
      step: 'count',
      description: 'A physical count around the year-end confirms what’s actually on hand. Count Check differences are recorded once, dated, with a reason; a later count is rolled back to the year-end using the recorded movements in between.',
      facts: [c ? `Count on ${formatDate(c.date)}: ${plural(c.lines.length, 'item')} counted, ${plural(c.lines.filter((l) => l.status !== 'match').length, 'difference')}, counted inventory ${money(c.countedEndingCents / 100)}` : `No year-end count designated for ${L}.`],
      records: c ? c.lines.filter((l) => l.status !== 'match').map((l) => ({ id: l.itemId, label: l.itemName, detail: `Recorded ${l.recordedQuantity}, counted ${l.countedQuantity} · ${l.status === 'needs_recount' ? 'needs recount (not applied)' : l.status === 'missing_or_damaged' ? 'missing or damaged (written off)' : 'found (added)'}${l.reason ? ` · ${l.reason}` : ''}`, href: `/inventory/${l.itemId}`, amount: l.valueDifference })) : [],
      issues,
      canReview: c !== null,
      canNA: c === null,
      naExplanation: `Not performed: no physical year-end count was designated for ${L}, so ending inventory comes from the item records.`,
    });
  }

  // 6. Summary
  {
    drafts.push({
      step: 'report',
      description: 'The accountant-ready summary, as it will be kept when you finalize.',
      facts: [`Revenue ${money(y.totals.revenue)} · cost of goods sold ${money(y.totals.costOfGoods)} · realized profit ${money(y.totals.netProfit)}`, `Ending inventory ${y.independentEnding === null ? 'not available' : money(y.independentEnding)}`],
      records: [],
      issues: y.ended ? [] : [{ id: 'year:open', severity: 'attention', text: `${L} can be finalized after ${formatDate(y.period.end)}.`, links: [] }],
      canReview: true,
      canNA: false,
      naExplanation: '',
    });
  }

  const steps: YearStep[] = drafts.map((d, i) => {
    const fingerprint = hash(JSON.stringify([d.records.map((r) => [r.id, r.amount]), d.issues.map((x) => x.id), d.facts]));
    const found = decisions.find((x) => x.step === d.step) ?? null;
    const stale = found !== null && found.fingerprint !== fingerprint;
    const decision = found && !stale ? found : null;
    const attention = d.issues.filter((x) => x.severity === 'attention');
    let state: StepState = attention.length ? 'attention' : 'todo';
    let stateText = attention.length ? `Needs attention: ${plural(attention.length, 'issue')}` : 'To review';
    if (decision?.decision === 'na') {
      state = 'na';
      stateText = `Not applicable: ${decision.note}`;
    } else if (decision) {
      state = 'completed';
      stateText = decision.decision === 'acknowledged' ? `Completed with ${plural(attention.length, 'open issue')} acknowledged` : 'Completed: reviewed';
    }
    if (stale) stateText += ' (records changed since your last decision)';
    return { ...d, number: i + 1, title: YEAR_STEP_TITLES[d.step], fingerprint, decision, stale, state, stateText };
  });
  const blockers: string[] = [];
  if (review) blockers.push(`${L} is finalized (version ${review.version}).`);
  if (!y.ended) blockers.push(`${L} isn’t over yet.`);
  for (const s of steps) if (s.state === 'todo' || s.state === 'attention') blockers.push(`Step ${s.number}: ${s.title} — ${s.stateText}.`);
  const unresolved = steps.filter((s) => s.decision?.decision === 'acknowledged').flatMap((s) => s.issues.filter((x) => x.severity === 'attention').map((x) => `${s.title}: ${x.text}`));
  return { key, label: L, figures: y, steps, review, flags: review ? yearFlags(data, settings, review, y) : [], ended: y.ended, ready: blockers.length === 0, blockers, unresolved };
}
