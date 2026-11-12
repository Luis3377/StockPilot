import { describe, expect, it } from 'vitest';
import { answerQuestion } from './assistant';
import { verifyCalculation } from './calculations';
import { monthIntent } from './closeAnswers';
import { closeMonth, decideStep } from '../domain/close';
import { addItem } from '../domain/actions';
import { defaultSettings, type AppData } from '../domain/types';
import { at, closeShop, sell, tracked } from './closeFixture';

const settings = defaultSettings();
const TODAY = '2026-11-12';
const ask = (data: AppData, q: string) => {
  const a = answerQuestion(q, { data, settings, today: TODAY });
  if (a.calculation) expect(verifyCalculation(a.calculation), q).toEqual([]);
  return a;
};

describe('assistant: monthly close questions', () => {
  it('routes the eight questions and leaves existing ones alone', () => {
    expect(monthIntent('how did my business perform this month?')).toBe('month-performance');
    expect(monthIntent('why did my profit decline?')).toBe('month-changes');
    expect(monthIntent('which expenses increased?')).toBe('month-expenses');
    expect(monthIntent('what changed compared with last month?')).toBe('month-changes');
    expect(monthIntent('what should i review before closing?')).toBe('close-review');
    expect(monthIntent('which products hurt my profitability?')).toBe('products-hurt');
    expect(monthIntent('are my payouts reconciled?')).toBe('payouts-reconciled');
    expect(monthIntent('what inventory differences remain unexplained?')).toBe('inventory-unexplained');
    for (const q of ['explain my latest payout', 'how much profit have i made this month?', 'which items are losing money?', 'what are my biggest selling expenses?', 'what inventory has been sitting the longest?']) expect(monthIntent(q), q).toBeNull();
  });

  it('how did my business perform: the month’s realized profit, compared with the month before', () => {
    const { data } = closeShop();
    const a = ask(data, 'How did my business perform in October?');
    expect(a.intent).toBe('month-performance');
    expect(a.text).toBe('In October 2026 you made $259.33 realized profit on $418.00 of sales (3 sales, 62.04% margin). That’s +$131.33 compared with September 2026 ($128.00).');
    expect(a.calculation!.value).toBe(259.33);
    expect(ask(data, 'How did my business perform this month?').text).toContain('no sales recorded in November 2026 (to date)');
  });

  it('why did my profit change: an exact split, re-added from both months’ sales', () => {
    let { data, drills } = closeShop();
    // November: one drill sold at a loss, so profit falls.
    data = sell(data, drills.id, 1, 10, '2026-11-05', 5).data;
    const a = ask(data, 'Why did my profit decline?');
    expect(a.intent).toBe('month-changes');
    expect(a.text).toBe('Realized profit fell by $269.53 in November 2026 (to date) compared with October 2026 ($259.33 → -$10.20). It splits exactly into: sales revenue −$408.00, cost of goods sold +$67.47, marketplace fees +$35.00, shipping +$36.00.');
    const calc = a.calculation!;
    expect(calc.lines.map((l) => [l.label, l.op, l.amount])).toEqual([
      ['Realized profit in October 2026', '+', 259.33],
      ['Change in sales revenue', '-', 408],
      ['Change in cost of goods sold (lower is better)', '+', 67.47],
      ['Change in marketplace fees (lower is better)', '+', 35],
      ['Change in shipping (lower is better)', '+', 36],
      ['Change in other selling expenses (lower is better)', '+', 0],
      ['Realized profit in November 2026', '=', 10.2],
    ]);
    expect(calc.value).toBe(-10.2);
    expect(calc.records).toHaveLength(4);
    const e = ask(data, 'Which expenses increased in October?');
    expect(e.text).toBe('Compared with September 2026, these increased in October 2026: cost of goods sold $77.00 → $82.67 (+$5.67); marketplace fees $27.00 → $40.00 (+$13.00); shipping $18.00 → $36.00 (+$18.00).');
  });

  it('which products hurt my profitability: the loss-making sales, as a calculation', () => {
    let { data } = closeShop();
    const sn = tracked(data, '2026-10-02', (d) => addItem(d, { name: 'Running sneakers', category: 'Sneakers', quantity: 3, unitCost: 100, purchaseDate: '2026-10-02' }, at('2026-10-02')));
    data = sn.data;
    for (const [fee, day] of [[8.33, '11'], [8.33, '12'], [8.34, '13']] as const) data = sell(data, sn.item.id, 1, 60, `2026-10-${day}`, fee).data;
    const a = ask(data, 'Which products hurt my profitability in October?');
    expect(a.text).toBe('In October 2026, 3 sales lost money: -$145.00 in recorded losses, led by Running sneakers (-$145.00).');
    expect(a.calculation!.value).toBe(-145);
    expect(a.items).toEqual([{ id: sn.item.id, name: 'Running sneakers' }]);
  });

  it('what should I review before closing: the open steps of the latest unclosed month', () => {
    const { data } = closeShop();
    const a = ask(data, 'What should I review before closing?');
    expect(a.intent).toBe('close-review');
    expect(a.text).toBe('Before closing October 2026, 8 checklist steps are still open.');
    expect(a.details[2]).toContain('Step 3, Review adjustments and write-offs: Needs attention: 1 issue. Lamp was deleted with $8.00 of stock at cost');
  });

  it('are my payouts reconciled: says when it wasn’t performed', () => {
    const { data } = closeShop();
    const a = ask(data, 'Are my payouts reconciled for October?');
    expect(a.intent).toBe('payouts-reconciled');
    expect(a.text).toBe('October 2026: Not performed: no marketplace reports have been imported, so October 2026’s payouts weren’t compared with your sales.');
    expect(a.calculation).toBeUndefined();
  });

  it('what inventory differences remain unexplained: the roll-forward as a calculation', () => {
    const { data, cards } = closeShop();
    const a = ask(data, 'What inventory differences remain unexplained in October?');
    expect(a.text).toBe('No unexplained inventory difference in October 2026: beginning inventory plus the month’s recorded movements equals the item records ($298.33).');
    expect(a.calculation!.lines.map((l) => [l.label, l.op, l.amount])).toEqual([
      ['Beginning inventory cost', '+', 348],
      ['Items bought', '+', 18],
      ['Restocks', '+', 18],
      ['Cost corrections', '+', 5],
      ['Cost of goods sold', '-', 82.67],
      ['Items deleted with stock', '-', 8],
      ['Expected ending inventory cost', '=', 298.33],
      ['Ending inventory cost from the item records', 'info', 298.33],
      ['Unexplained difference', 'info', 0],
    ]);
    const tampered = { ...data, items: data.items.map((i) => (i.id === cards.id ? { ...i, quantity: 2 } : i)) };
    expect(ask(tampered, 'What inventory differences remain unexplained in October?').text).toBe('$3.34 of inventory cost remains unexplained in October 2026: the item records show $301.67, while beginning inventory plus recorded movements gives $298.33.');
  });

  it('a closed month is reported as closed', () => {
    const { data } = closeShop();
    let d = data;
    for (const [k, dec, note] of [['sales', 'reviewed', ''], ['purchases', 'reviewed', ''], ['adjustments', 'acknowledged', 'Lamp: will write off.'], ['counts', 'na', ''], ['payouts', 'na', ''], ['refunds', 'na', ''], ['costs', 'reviewed', ''], ['summary', 'reviewed', '']] as const) d = decideStep(d, settings, '2026-10', k, dec, note, TODAY, at(TODAY));
    d = closeMonth(d, settings, '2026-10', { acknowledged: true, note: '' }, TODAY, at(TODAY)).data;
    expect(ask(d, 'What should I review before closing October?').text).toContain('October 2026 is already closed (version 1');
    // With October closed, the default is the next unclosed month that has ended… none yet: still October’s neighbour.
    expect(ask(d, 'What should I review before closing?').text).toContain('September 2026');
  });
});
