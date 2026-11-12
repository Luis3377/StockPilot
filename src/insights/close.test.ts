import { describe, expect, it } from 'vitest';
import { closeChecklist } from './closeChecklist';
import { controllerReport, reportHtml, reportSnapshot } from './controllerReport';
import { monthFigures, rollForward } from './monthly';
import { assertClosedMonthsUnchanged, closeMonth, decideStep, reopenMonth, undoDecision } from '../domain/close';
import { trackChanges } from '../domain/ledger';
import { addItem, deleteSale, recordSale, updateItem, updateSale } from '../domain/actions';
import { toCents } from '../domain/money';
import { createBackup, parseBackup } from '../data/backup';
import { defaultSettings, type AppData, type CloseStepKey } from '../domain/types';
import { at, closeShop, input, sell, tracked } from './closeFixture';

const settings = defaultSettings();
const TODAY = '2026-11-12';
const OCT = '2026-10';
const steps = (data: AppData, month = OCT) => closeChecklist(data, settings, month, TODAY).steps;
const step = (data: AppData, key: CloseStepKey, month = OCT) => steps(data, month).find((s) => s.step === key)!;
const decide = (data: AppData, key: CloseStepKey, decision: 'reviewed' | 'na' | 'acknowledged', note = '', month = OCT) => decideStep(data, settings, month, key, decision, note, TODAY, at(TODAY));

/** October with every step decided: reviewed, not applicable, or acknowledged. */
function readyOctober(data = closeShop().data) {
  let d = data;
  d = decide(d, 'sales', 'reviewed');
  d = decide(d, 'purchases', 'reviewed');
  d = decide(d, 'adjustments', 'acknowledged', 'The lamp was broken; I deleted it instead of writing it off.');
  d = decide(d, 'counts', 'na');
  d = decide(d, 'payouts', 'na');
  d = decide(d, 'refunds', 'na');
  d = decide(d, 'costs', 'reviewed');
  d = decide(d, 'summary', 'reviewed');
  return d;
}

/** Applies a change as the store does: ledger first, then the closed-month guard. */
function attempt(before: AppData, date: string, fn: (d: AppData) => { data: AppData }) {
  const after = trackChanges(before, fn(before).data, at(date));
  assertClosedMonthsUnchanged(before, after);
  return after;
}

describe('closing checklist', () => {
  it('nothing is complete until the user decides, even when a step has no records', () => {
    const { data } = closeShop();
    const s = steps(data);
    expect(s.map((x) => x.state)).toEqual(['todo', 'todo', 'attention', 'todo', 'todo', 'todo', 'todo', 'todo']);
    expect(step(data, 'counts')).toMatchObject({ canNA: true, canReview: false, naExplanation: expect.stringContaining('Not performed: no physical count was done in October 2026') });
    // No reports imported: reconciliation is "not performed", never "reconciled".
    expect(step(data, 'payouts')).toMatchObject({ canReview: false, canNA: true });
    expect(step(data, 'payouts').facts[0]).toContain('Not performed: no marketplace reports have been imported');
    expect(step(data, 'adjustments').issues[0].text).toContain('Lamp was deleted with $8.00 of stock at cost');
    expect(step(data, 'sales').records).toHaveLength(3);
    const list = closeChecklist(data, settings, OCT, TODAY);
    expect(list.ready).toBe(false);
    expect(list.blockers[0]).toContain('Step 1: Review recorded sales — To review');
  });

  it('decisions follow the rules, are logged, and go stale when the records change', () => {
    const shop = closeShop();
    let data = shop.data;
    expect(() => decide(data, 'adjustments', 'reviewed')).toThrow('has an open issue');
    expect(() => decide(data, 'adjustments', 'acknowledged')).toThrow('Say why these issues can stay open');
    expect(() => decide(data, 'sales', 'na')).toThrow('has records to review');
    expect(() => decide(data, 'payouts', 'reviewed')).toThrow('couldn’t be performed');
    data = decide(data, 'payouts', 'na');
    expect(step(data, 'payouts')).toMatchObject({ state: 'na', stateText: expect.stringContaining('Not applicable: Not performed: no marketplace reports') });
    data = decide(data, 'sales', 'reviewed');
    expect(step(data, 'sales').state).toBe('completed');
    expect(data.monthlyClose.audit.map((a) => a.detail)).toEqual([expect.stringContaining('Marked not applicable: Review marketplace payouts'), 'Marked reviewed: Review recorded sales']);
    // A new October sale changes what the step shows: the decision no longer counts.
    data = sell(data, shop.records.id, 1, 20, '2026-10-30').data;
    expect(step(data, 'sales')).toMatchObject({ state: 'todo', stale: true });
    data = undoDecision(data, OCT, 'payouts', at(TODAY));
    expect(step(data, 'payouts').state).toBe('todo');
    expect(data.monthlyClose.audit.at(-1)!.kind).toBe('undone');
  });

  it('flags missing costs and low margins', () => {
    let { data } = closeShop();
    const free = tracked(data, '2026-10-09', (d) => addItem(d, { name: 'Free box', quantity: 2, unitCost: 0, purchaseDate: '2026-10-09' }, at('2026-10-09')));
    data = sell(free.data, free.item.id, 1, 10, '2026-10-10').data;
    const s = step(data, 'costs');
    expect(s.issues.map((i) => i.text)).toEqual([expect.stringContaining('Free box (Oct 10, 2026) has no recorded cost'), expect.stringContaining('Free box is in stock with no cost')]);
    expect(step(data, 'purchases').issues[0].text).toContain('Free box was added with no cost per item');
  });
});

describe('closing and reopening a month', () => {
  it('a month can only be closed once it has ended and every step is done', () => {
    const { data } = closeShop();
    expect(() => closeMonth(data, settings, OCT, { acknowledged: true, note: '' }, TODAY, at(TODAY))).toThrow('October 2026 can’t be closed yet: Step 1');
    expect(() => closeMonth(data, settings, '2026-11', { acknowledged: true, note: '' }, TODAY, at(TODAY))).toThrow('November 2026 isn’t over yet');
    const ready = readyOctober(data);
    expect(() => closeMonth(ready, settings, OCT, { acknowledged: false, note: '' }, TODAY, at(TODAY))).toThrow('Confirm that you’ve reviewed the issue still open');
  });

  it('closing keeps the figures, roll-forward, checklist, acknowledged issues and report', () => {
    const ready = readyOctober();
    const f = monthFigures(ready, settings, OCT, TODAY);
    const r = closeMonth(ready, settings, OCT, { acknowledged: true, note: 'Lamp to be written off properly next month.' }, TODAY, at(TODAY));
    const c = r.close;
    expect(c).toMatchObject({ month: OCT, version: 1, status: 'closed', closedAt: '2026-11-12T12:00:00.000Z' });
    expect(c.figures).toMatchObject({ revenue: f.totals.revenue, costOfGoods: 82.67, grossProfit: 335.33, fees: 40, shipping: 36, realizedProfit: 259.33, purchases: 36, beginningInventory: 348, endingInventory: 298.33 });
    expect(c.rollForward).toMatchObject({ status: 'verified', difference: 0, expectedEnding: 298.33 });
    expect(c.checklist.map((s) => s.state)).toEqual(['completed', 'completed', 'completed', 'na', 'na', 'na', 'completed', 'completed']);
    expect(c.unresolved).toEqual([expect.stringContaining('Lamp was deleted with $8.00 of stock at cost')]);
    expect(c.report.title).toBe('Controller’s Report: October 2026');
    expect(r.data.monthlyClose.decisions[OCT]).toBeUndefined();
    expect(r.data.monthlyClose.audit.at(-1)!.detail).toBe('Closed October 2026 (version 1) with 1 acknowledged open issue — Lamp to be written off properly next month.');
    // Next month starts from the closed figure.
    const nov = rollForward(r.data, settings, '2026-11', TODAY);
    expect(nov.beginning).toBe(298.33);
    expect(nov.beginningBasis).toContain('Ending inventory cost when October 2026 was closed');
    expect(() => decide(r.data, 'sales', 'reviewed')).toThrow('October 2026 is closed');
  });

  it('a closed month is protected: changes to its figures are refused, others go through', () => {
    const { data: shopData, records, cards } = closeShop();
    const closed = closeMonth(readyOctober(shopData), settings, OCT, { acknowledged: true, note: '' }, TODAY, at(TODAY)).data;
    const octSale = closed.sales.find((s) => s.saleDate === '2026-10-20')!;
    const msg = 'That would change October 2026, which is closed. Reopen October 2026 first';
    expect(() => attempt(closed, TODAY, (d) => updateSale(d, octSale.id, { itemId: octSale.itemId, quantity: 5, salePrice: 380, priceMode: 'total', fees: 40, shipping: 36, saleDate: octSale.saleDate }, at(TODAY)))).toThrow(msg);
    expect(() => attempt(closed, TODAY, (d) => deleteSale(d, octSale.id, at(TODAY)))).toThrow(msg);
    expect(() => attempt(closed, TODAY, (d) => recordSale(d, { itemId: records.id, quantity: 1, salePrice: 20, priceMode: 'total', saleDate: '2026-10-31' }, at(TODAY)))).toThrow(msg);
    expect(() => attempt(closed, TODAY, (d) => addItem(d, { name: 'Late receipt', quantity: 1, unitCost: 9, purchaseDate: '2026-10-12' }, at(TODAY)))).toThrow(msg);
    // Rewriting the cost on recorded sales would change October's cost of goods sold.
    const card = closed.items.find((i) => i.id === cards.id)!;
    expect(() => attempt(closed, TODAY, (d) => updateItem(d, card.id, input(card, { unitCost: 4 }), { applyCostToSales: true }, at(TODAY)))).toThrow(msg);
    const rec = closed.items.find((i) => i.id === records.id)!;
    // Today's work, a cost correction dated today, and a rename all leave October unchanged.
    let ok = attempt(closed, TODAY, (d) => recordSale(d, { itemId: records.id, quantity: 1, salePrice: 20, priceMode: 'total', saleDate: TODAY }, at(TODAY)));
    ok = attempt(ok, TODAY, (d) => updateItem(d, rec.id, input(ok.items.find((i) => i.id === rec.id)!, { unitCost: 7, name: 'LP records' }), {}, at(TODAY)));
    const c = ok.items.find((i) => i.id === cards.id)!;
    ok = attempt(ok, TODAY, (d) => updateItem(d, c.id, input(c, { category: 'Cards' }), {}, at(TODAY)));
    expect(rollForward(ok, settings, OCT, TODAY).difference).toBe(0);
  });

  it('reopening needs a reason, keeps the original close as superseded, and requires the checks again', () => {
    const { data: shopData } = closeShop();
    const v1 = closeMonth(readyOctober(shopData), settings, OCT, { acknowledged: true, note: '' }, TODAY, at(TODAY));
    const original = structuredClone(v1.close);
    expect(() => reopenMonth(v1.data, OCT, '  ', at(TODAY))).toThrow('Say why you’re reopening');
    let data = reopenMonth(v1.data, OCT, 'A drill sale was entered at the wrong price.', at('2026-11-13'));
    expect(data.monthlyClose.closes[0]).toMatchObject({ status: 'superseded', supersededAt: '2026-11-13T12:00:00.000Z', reopenReason: 'A drill sale was entered at the wrong price.' });
    expect(data.monthlyClose.audit.at(-1)).toMatchObject({ kind: 'reopened', version: 1, detail: 'Reopened October 2026 (version 1 superseded) — A drill sale was entered at the wrong price.' });
    expect(closeChecklist(data, settings, OCT, '2026-11-13').steps.every((s) => s.state === 'todo' || s.state === 'attention')).toBe(true);
    // Corrections are allowed now.
    const octSale = data.sales.find((s) => s.saleDate === '2026-10-20')!;
    data = attempt(data, '2026-11-13', (d) => updateSale(d, octSale.id, { itemId: octSale.itemId, quantity: 5, salePrice: 420, priceMode: 'total', fees: 42, shipping: 36, saleDate: octSale.saleDate }, at('2026-11-13')));
    const v2 = closeMonth(readyOctober(data), settings, OCT, { acknowledged: true, note: 'Corrected the drill sale.' }, '2026-11-13', at('2026-11-13'));
    expect(v2.close.version).toBe(2);
    expect(v2.close.figures.realizedProfit).toBe(277.33); // +$20 revenue, +$2 fees
    // The original close is kept exactly as it was.
    const kept = v2.data.monthlyClose.closes.find((c) => c.version === 1)!;
    expect({ ...kept, status: 'closed', supersededAt: null, reopenReason: '' }).toEqual(original);
    expect(kept.figures.realizedProfit).toBe(259.33);
    expect(v2.data.monthlyClose.audit.map((a) => a.kind).filter((k) => k === 'closed' || k === 'reopened')).toEqual(['closed', 'reopened', 'closed']);
  });

  it('closes, decisions and the audit log survive a backup round trip', () => {
    const v1 = closeMonth(readyOctober(), settings, OCT, { acknowledged: true, note: 'ok' }, TODAY, at(TODAY));
    const withDecision = decide(v1.data, 'sales', 'reviewed', '', '2026-09');
    const back = parseBackup(JSON.stringify(createBackup('real', settings, withDecision, []))).data;
    expect(back.monthlyClose).toEqual(withDecision.monthlyClose);
  });
});

describe("controller's report", () => {
  it('explains the change in profit with verified arithmetic that adds up to the cent', () => {
    const { data } = closeShop();
    const r = controllerReport(data, settings, OCT, TODAY, '2026-11-12T12:00:00.000Z');
    // September $128.00 (records $60 + tools $68); October $259.33.
    expect(r.sections[0].lines[0]).toMatchObject({ kind: 'verified', text: 'Realized profit increased by $131.33 compared with September 2026: $128.00 → $259.33.' });
    expect(r.decomposition.map((d) => [d.key, d.amount])).toEqual([['revenue', 168], ['cogs', -5.67], ['fees', -13], ['shipping', -18], ['other', 0]]);
    expect(r.decomposition.reduce((c, d) => c + toCents(d.amount), 0)).toBe(13133);
    const changes = r.sections.find((s) => s.key === 'changes')!.lines;
    expect(changes[0].text).toBe('Realized profit changed by +$131.33. It splits exactly into: sales revenue +$168.00, cost of goods sold −$5.67, marketplace fees −$13.00, shipping −$18.00.');
    expect(changes.find((l) => l.kind === 'contributing')!.text).toBe('Tools: realized profit $68.00 in September 2026 → $248.00 in October 2026 (+$180.00); its margin increased from 45.33% to 62%.');
    // Fewer units but more profit: volume isn't offered as the reason.
    expect(changes.find((l) => l.kind === 'possible' && l.text.includes('Units sold went from 9 to 7'))!.text).toBe('Units sold went from 9 to 7. Profit moved the other way, so the number of units sold doesn’t explain the change.');
    expect(r.sections.find((s) => s.key === 'categories')!.lines.map((l) => l.text)).toEqual(['Best: Tools $248.00 (margin 62%).', 'Weakest: Collectibles $11.33 (margin 62.94%).']);
    const rows = r.sections.find((s) => s.key === 'profitability')!.rows!;
    expect(rows.find((x) => x.label === 'Sales revenue')).toEqual({ label: 'Sales revenue', current: '$418.00', previous: '$250.00', change: '+$168.00 (+67.2%)' });
    expect(r.sections.find((s) => s.key === 'limitations')!.lines.map((l) => l.text)).toContain('Payouts weren’t reconciled, so recorded sales weren’t checked against what the marketplace paid.');
  });

  it('names loss-making sales and margin drops from the records', () => {
    let { data } = closeShop();
    const sneakers = tracked(data, '2026-10-02', (d) => addItem(d, { name: 'Running sneakers', category: 'Sneakers', quantity: 3, unitCost: 100, purchaseDate: '2026-10-02' }, at('2026-10-02')));
    data = sneakers.data;
    for (const [fee, day] of [[8.33, '11'], [8.33, '12'], [8.34, '13']] as const) data = sell(data, sneakers.item.id, 1, 60, `2026-10-${day}`, fee).data;
    const r = controllerReport(data, settings, OCT, TODAY);
    const text = r.sections.flatMap((s) => s.lines.map((l) => l.text));
    expect(text).toContain('3 Sneakers sales generated $145.00 in recorded losses.');
    const loss = r.sections.find((s) => s.key === 'changes')!.lines.find((l) => l.text.includes('recorded losses'))!;
    expect(loss.links).toHaveLength(3);
  });

  it('the kept report and its downloadable HTML carry the same figures, escaped', () => {
    let { data, records } = closeShop();
    const rec = data.items.find((i) => i.id === records.id)!;
    data = tracked(data, '2026-10-29', (d) => updateItem(d, rec.id, input(rec, { category: 'Music <vinyl>' }), {}, at('2026-10-29'))).data;
    const snap = reportSnapshot(controllerReport(data, settings, OCT, TODAY, '2026-11-12T12:00:00.000Z'));
    expect(snap.sections[0]).toEqual({ title: 'About this report', lines: ['Generated from user-maintained StockPilot records. This is not an audited financial statement, and it is only as complete as the records it was made from.'] });
    const prof = snap.sections.find((s) => s.title === 'Revenue and profitability')!;
    expect(prof.lines[0]).toBe('Sales revenue: $418.00 (September 2026: $250.00; change +$168.00 (+67.2%))');
    expect(prof.lines).toContain('Realized profit: $259.33 (September 2026: $128.00; change +$131.33 (+102.6%))');
    const html = reportHtml(snap, { status: 'Draft — not closed' });
    expect(html).toContain('<h1>Controller’s Report: October 2026</h1>');
    expect(html).toContain('<li>Sales revenue: $418.00 (September 2026: $250.00; change +$168.00 (+67.2%))</li>');
    expect(html).toContain('Generated from user-maintained StockPilot records');
    expect(html).not.toContain('<vinyl>');
  });
});
