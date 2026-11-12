// Assistant answers about predicted vs. actual: prediction accuracy, lots that beat or missed
// expectations, why a lot lost money, and what past results suggest for the next bid. Every
// figure comes from the performance engine; each answer carries a calculation the app re-checks.

import type { AppData, BidLotKind, Lot, Settings } from '../domain/types';
import { DEFAULT_SCENARIOS, KIND_LABELS } from '../domain/bids';
import { formatDate } from '../domain/dates';
import { plural } from '../domain/format';
import { formatMoney, fromCents, toCents } from '../domain/money';
import { calcContext, saleRecord, type CalcLine, type Calculation, type SourceRecord } from './calculations';
import { lotHistory, lotPerformance, stageText, suggestAdjustments, type HistoryRow } from './performance';

export interface PerformanceAnswer {
  intent: string;
  text: string;
  details: string[];
  calculation?: Calculation;
  followUps: string[];
}

const KIND_WORDS: [RegExp, BidLotKind][] = [
  [/storage/, 'storage_unit'],
  [/pallet|liquidation/, 'pallet'],
  [/estate/, 'estate_sale'],
  [/garage|yard sale/, 'garage_sale'],
  [/collectib/, 'collectibles'],
  [/retail/, 'retail_lot'],
];

const pct = (n: number | null) => (n === null ? '—' : `${Math.abs(n)}%`);

/** Which performance question this is, if any (checked before the generic lot questions). */
export function performanceIntent(q: string): 'lot-learning' | 'lot-why' | 'lot-outcomes' | 'prediction-accuracy' | null {
  if (/\b(next|future|upcoming)\b.*\b(bids?|max(imum)? bids?|purchases?|lots?|buy)\b|\b(previous|past) (results|lots)\b/.test(q)) return 'lot-learning';
  if (/\bwhy\b.*\blots?\b|\blots?\b.*\b(lose|lost|losing)\b.*\bmoney\b/.test(q)) return 'lot-why';
  if (/\blots?\b.*\b(more|less|better|worse) than (expected|predicted)\b|\b(under|out)-?perform|\b(kinds?|types?) of lots?\b/.test(q)) return 'lot-outcomes';
  if (/\baccura(te|cy)\b|\bover-?estimat|\bunder-?estimat|\b(predictions?|forecasts?)\b/.test(q)) return 'prediction-accuracy';
  return null;
}

function lotRecord(r: HistoryRow, money: (n: number) => string, withParts: boolean): SourceRecord {
  const diff = r.predictedNet === null ? 0 : fromCents(toCents(r.net) - toCents(r.predictedNet));
  return {
    kind: 'lot',
    id: r.lot.id,
    label: r.lot.name,
    detail: `${r.type} · ${formatDate(r.date)} · net proceeds ${money(r.net)}${r.predictedNet !== null ? ` vs ${money(r.predictedNet)} predicted` : ''}`,
    date: r.date,
    links: [
      { label: 'Performance', href: `/inventory/lots/${r.lot.id}/performance` },
      ...(r.plan ? [{ label: 'Plan', href: `/inventory/bids/${r.plan.id}` }] : []),
    ],
    parts: withParts && r.predictedNet !== null ? { actual: r.net, predicted: r.predictedNet, difference: diff } : {},
  };
}

/** Actual vs predicted net proceeds over planned, completed lots: lines add up from the lots. */
function accuracyCalculation(rows: HistoryRow[], title: string, today: string, money: (n: number) => string, warnings: string[]): Calculation {
  const actual = rows.reduce((c, r) => c + toCents(r.net), 0);
  const predicted = rows.reduce((c, r) => c + toCents(r.predictedNet!), 0);
  const diff = actual - predicted;
  const lines: CalcLine[] = [
    { key: 'actual', label: 'Actual net proceeds', amount: fromCents(actual), op: '+', fromRecords: true },
    { key: 'predicted', label: 'Predicted net proceeds (expected scenario)', amount: fromCents(predicted), op: '-', fromRecords: true, note: 'From each plan’s estimate, frozen when the lot was bought' },
    { key: 'difference', label: diff >= 0 ? 'More than predicted' : 'Less than predicted', amount: fromCents(Math.abs(diff)), op: '=', fromRecords: true, signedParts: true, negative: diff < 0 },
  ];
  return {
    metric: 'prediction_accuracy',
    title,
    value: fromCents(diff),
    period: null,
    asOf: today,
    formula: 'Net proceeds = sales − fees, shipping and other selling expenses. Forecast error = (actual − predicted) ÷ predicted, for completed lots planned with the Max Bid Calculator.',
    lines,
    records: rows.map((r) => lotRecord(r, money, true)),
    warnings,
    basis: 'recorded',
  };
}

/** A lot named in the question (longest name first, so "Box 12" wins over "Box 1"). */
function namedLot(q: string, data: AppData): Lot | undefined {
  return [...data.lots].sort((a, b) => b.name.length - a.name.length).find((l) => l.name.trim().length >= 3 && q.includes(l.name.trim().toLowerCase()));
}

export function performanceAnswer(q: string, data: AppData, settings: Settings, today: string): PerformanceAnswer | null {
  const named = namedLot(q, data);
  // "Why did Estate box lose money?" names the lot without saying "lot".
  const intent = performanceIntent(q) ?? (named && /\b(why|lose|lost|losing|loss|do|did)\b/.test(q) ? 'lot-why' : null);
  if (!intent) return null;
  const money = (n: number) => formatMoney(n, settings.currency);
  if (!data.lots.length) {
    return { intent, text: 'You haven’t recorded any bulk lots yet, so there are no results to compare with predictions.', details: ['Plan a purchase with Inventory → Max bid, and record it with “I bought this lot”.'], followUps: [] };
  }
  const h = lotHistory(data, settings);
  const planned = h.completed.filter((r) => r.predictedNet !== null);
  const stillSelling = h.rows.filter((r) => !r.final);
  const kind = KIND_WORDS.find(([re]) => re.test(q))?.[1] ?? null;
  const notYet = stillSelling.length ? [`${plural(stillSelling.length, 'lot')} ${stillSelling.length === 1 ? 'is' : 'are'} still selling and ${stillSelling.length === 1 ? 'isn’t' : 'aren’t'} included.`] : [];

  if (intent === 'lot-learning') {
    const r = suggestAdjustments(data, settings, kind, DEFAULT_SCENARIOS.expected);
    if (!r.ok) return { intent, text: r.reason, details: ['Past results become suggestions once enough lots are complete, so a few lots can’t skew your next bid.', ...notYet], followUps: ['How accurate have my predictions been?'] };
    const d = DEFAULT_SCENARIOS.expected;
    return {
      intent,
      text: `${r.summary} For your next ${kind ? KIND_LABELS[kind].toLowerCase() : 'plan'}, StockPilot would suggest an expected scenario of ${r.suggested.resalePct}% resale, ${r.suggested.unsoldPct}% unsold and ${r.suggested.sellingFeePct}% fees, instead of the default ${d.resalePct}% / ${d.unsoldPct}% / ${d.sellingFeePct}%.`,
      details: [
        ...r.fields.map((f) => f.explanation),
        `Based on ${plural(r.sampleSize, 'lot')}: ${r.lots.map((l) => l.name).join(', ')}. Weight ${r.weight}${r.consistent ? '' : ' (halved: the lots disagree)'}.`,
        'It’s a suggestion: open a Max Bid plan to see it next to your own assumptions, and accept, edit or ignore it. Past results don’t guarantee future ones.',
      ],
      followUps: ['How accurate have my predictions been?', 'Which lots made more than expected?'],
    };
  }

  if (intent === 'lot-why') {
    const losing = h.completed.filter((r) => r.result < 0).sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.lot;
    const lot: Lot | undefined = named ?? losing;
    if (!lot) return { intent, text: 'None of your completed lots lost money.', details: [`${plural(h.completed.length, 'completed lot')} so far.`, ...notYet], followUps: ['Which lots made more than expected?'] };
    const perf = lotPerformance(data, settings, lot);
    const a = perf.actual;
    const cc = calcContext(data, settings, today);
    const records: SourceRecord[] = [
      { kind: 'lot', id: lot.id, label: lot.name, detail: stageText(perf), links: [{ label: 'Performance', href: `/inventory/lots/${lot.id}/performance` }], parts: {} },
      ...perf.sales.map((s) => saleRecord(cc, s)),
    ];
    if (!perf.final) {
      return {
        intent,
        text: `“${lot.name}” is still selling (${a.unitsSold} of ${plural(a.unitsBought, 'unit')} sold), so whether it loses money isn’t known yet.`,
        details: [
          `So far: realized profit on the units sold ${money(a.realizedProfit)}; ${money(a.unrecovered)} of the ${money(a.acquisitionCost)} you paid isn’t recovered yet.`,
          perf.projection ? `Projected final result: ${money(perf.projection.finalResult)}, an estimate using ${perf.projection.assumptions}.` : '',
        ].filter(Boolean),
        followUps: ['How accurate have my predictions been?'],
      };
    }
    if (!perf.attribution) {
      const lines: CalcLine[] = [
        { key: 'net', label: 'Net proceeds', amount: Math.abs(a.netProceeds), op: a.netProceeds >= 0 ? '+' : '-', fromRecords: false },
        { key: 'cost', label: 'Acquisition cost', amount: a.acquisitionCost, op: '-', fromRecords: false },
        { key: 'result', label: 'Result', amount: Math.abs(a.lotResult), op: '=', fromRecords: false, negative: a.lotResult < 0 },
      ];
      return {
        intent,
        text: `“${lot.name}” ${a.lotResult < 0 ? `lost ${money(Math.abs(a.lotResult))}` : `made ${money(a.lotResult)}`}: net proceeds of ${money(a.netProceeds)} against ${money(a.acquisitionCost)} paid. It wasn’t planned with the Max Bid Calculator, so there’s no prediction to explain the difference against.`,
        details: [stageText(perf)],
        calculation: { metric: 'lot_result', title: `Result of “${lot.name}”`, value: a.lotResult, period: null, asOf: today, formula: 'Result = net proceeds − acquisition cost.', lines, records, warnings: perf.warnings, basis: 'recorded' },
        followUps: [],
      };
    }
    const at = perf.attribution;
    const lines: CalcLine[] = [
      { key: 'start', label: at.startLabel, amount: Math.abs(at.start), op: at.start >= 0 ? '+' : '-', fromRecords: false },
      ...at.factors.map((f): CalcLine => ({ key: f.key, label: f.label, amount: Math.abs(f.amount), op: f.amount >= 0 ? '+' : '-', fromRecords: false, note: f.detail })),
      { key: 'end', label: 'Actual result (net proceeds − acquisition cost)', amount: Math.abs(at.end), op: '=', fromRecords: false, negative: at.end < 0 },
    ];
    const hurt = at.factors.filter((f) => f.amount < 0).sort((x, y) => x.amount - y.amount);
    return {
      intent,
      text: `“${lot.name}” ${at.end < 0 ? `lost ${money(Math.abs(at.end))}` : `made ${money(at.end)}`}, against ${money(at.start)} predicted.${hurt.length ? ` The biggest difference: ${hurt[0].label.toLowerCase()} (${money(Math.abs(hurt[0].amount))}).` : ''}`,
      details: at.factors.map((f) => `${f.label}: ${f.amount < 0 ? '−' : '+'}${money(Math.abs(f.amount))}. ${f.detail}`),
      calculation: {
        metric: 'lot_attribution',
        title: `Why “${lot.name}” differs from the prediction`,
        value: at.end,
        period: null,
        asOf: today,
        formula: 'Start from the predicted profit, then add each recorded difference: what you paid, selling prices, how much sold, fees and shipping. They add up exactly to the actual result.',
        lines,
        records,
        warnings: perf.warnings,
        basis: 'recorded',
      },
      followUps: ['How should my previous results affect my next maximum bid?'],
    };
  }

  if (!planned.length) {
    return {
      intent,
      text: 'None of your completed lots was planned with the Max Bid Calculator, so there are no predictions to compare yet.',
      details: [`${plural(h.completed.length, 'completed lot')}.`, ...notYet, 'Plan your next purchase with Inventory → Max bid and record it with “I bought this lot”.'],
      followUps: [],
    };
  }

  if (intent === 'lot-outcomes') {
    if (/\b(kinds?|types?) of lots?\b/.test(q)) {
      const types = h.byType.filter((g) => g.meanNetErrorPct !== null).sort((a, b) => a.meanNetErrorPct! - b.meanNetErrorPct!);
      const worst = types[0];
      return {
        intent,
        text: worst && worst.meanNetErrorPct! < 0 ? `${worst.label} lots have done worst against your predictions: net proceeds averaged ${pct(worst.meanNetErrorPct)} below (${plural(worst.plannedLots, 'lot')}).` : 'None of your lot types has come in below your predictions on average.',
        details: [
          ...types.map((g) => `${g.label}: ${plural(g.lots, 'lot')}, ROI ${g.roiPct ?? '—'}%, net proceeds ${g.meanNetErrorPct! < 0 ? `${pct(g.meanNetErrorPct)} below` : `${pct(g.meanNetErrorPct)} above`} predictions on average${g.lots < 3 ? ' (small sample)' : ''}.`),
          ...notYet,
        ],
        calculation: accuracyCalculation(planned, 'Net proceeds vs predictions, completed lots', today, money, notYet),
        followUps: ['How should my previous results affect my next maximum bid?'],
      };
    }
    const better = /\b(more|better)\b|outperform/.test(q);
    const chosen = planned.filter((r) => (better ? toCents(r.net) > toCents(r.predictedNet!) : toCents(r.net) < toCents(r.predictedNet!)));
    const word = better ? 'more' : 'less';
    if (!chosen.length) return { intent, text: `None of your ${plural(planned.length, 'completed planned lot')} made ${word} than predicted.`, details: notYet, followUps: ['How accurate have my predictions been?'] };
    return {
      intent,
      text: `${chosen.length} of ${plural(planned.length, 'completed planned lot')} made ${word} than predicted: ${chosen.map((r) => `${r.lot.name} (${r.netErrorPct! > 0 ? '+' : '−'}${pct(r.netErrorPct)})`).join(', ')}.`,
      details: ['Compared on net proceeds (sales − selling expenses) against each plan’s expected scenario.', ...notYet],
      calculation: accuracyCalculation(chosen, `Lots that made ${word} than predicted`, today, money, notYet),
      followUps: ['Why did my lot lose money?', 'How should my previous results affect my next maximum bid?'],
    };
  }

  // prediction-accuracy
  const actual = planned.reduce((c, r) => c + toCents(r.net), 0);
  const predicted = planned.reduce((c, r) => c + toCents(r.predictedNet!), 0);
  const prices = h.rows
    .map((r) => lotPerformance(data, settings, r.lot, { skipWarnings: true }).soldPrices)
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .reduce((acc, p) => ({ predicted: acc.predicted + toCents(p.predicted), actual: acc.actual + toCents(p.actual) }), { predicted: 0, actual: 0 });
  const priceErr = prices.predicted ? Math.round(((prices.actual - prices.predicted) / prices.predicted) * 10000) / 100 : null;
  const overall = predicted ? Math.round(((actual - predicted) / Math.abs(predicted)) * 10000) / 100 : null;
  return {
    intent: 'prediction-accuracy',
    text:
      overall === null
        ? `Your ${plural(planned.length, 'completed planned lot')} brought ${money(fromCents(actual))} of net proceeds; the predictions were $0, so there’s no percentage to compare.`
        : `Across ${plural(planned.length, 'completed lot')} you planned, net proceeds were ${money(fromCents(actual))} against ${money(fromCents(predicted))} predicted: ${pct(overall)} ${overall < 0 ? 'below' : 'above'} (${overall < 0 ? '−' : '+'}${money(fromCents(Math.abs(actual - predicted)))}).`,
    details: [
      h.meanNetErrorPct !== null ? `Average forecast error per lot: ${h.meanNetErrorPct > 0 ? '+' : h.meanNetErrorPct < 0 ? '−' : ''}${pct(h.meanNetErrorPct)}.` : '',
      priceErr !== null
        ? `Selling prices: what has sold from your planned lots brought ${money(fromCents(prices.actual))}, against ${money(fromCents(prices.predicted))} at your plans’ prices (${priceErr > 0 ? '+' : priceErr < 0 ? '−' : ''}${pct(priceErr)}${priceErr < 0 ? ', so you’ve been overestimating resale prices' : priceErr > 0 ? ', so you’ve been underestimating them' : ''}).`
        : '',
      ...notYet,
    ].filter(Boolean),
    calculation: accuracyCalculation(planned, 'Net proceeds vs predictions, completed lots', today, money, notYet),
    followUps: ['Which lots made more than expected?', 'What kinds of lots consistently underperform?', 'How should my previous results affect my next maximum bid?'],
  };
}
