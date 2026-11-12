import { describe, expect, it } from 'vitest';
import { answerQuestion } from './assistant';
import { verifyCalculation } from './calculations';
import { yearIntent } from './yearAnswers';
import { defaultSettings, type AppData } from '../domain/types';
import { yearShop } from './yearFixture';

const settings = defaultSettings();
const TODAY = '2027-02-10';
const ask = (data: AppData, q: string, today = TODAY) => {
  const a = answerQuestion(q, { data, settings, today });
  if (a.calculation) expect(verifyCalculation(a.calculation), q).toEqual([]);
  return a;
};

describe('assistant: year-end questions', () => {
  it('routes the seven questions and leaves existing ones alone', () => {
    expect(yearIntent('how much inventory did i start the year with?')).toBe('year-beginning');
    expect(yearIntent('how much inventory did i purchase?')).toBe('year-purchases');
    expect(yearIntent('what was my cost of goods sold?')).toBe('year-cogs');
    expect(yearIntent("why doesn't my inventory reconcile?")).toBe('year-reconcile');
    expect(yearIntent('what inventory did i write off?')).toBe('year-writeoffs');
    expect(yearIntent('which months are missing information?')).toBe('year-missing-months');
    expect(yearIntent('is my year-end report ready for my accountant?')).toBe('year-ready');
    for (const q of ['how much have i spent on inventory?', 'how much money do i have invested in unsold inventory?', 'what inventory differences remain unexplained?', 'which items should i review for possible losses?']) expect(yearIntent(q), q).toBeNull();
  });

  it('beginning inventory, item by item', () => {
    const { data } = yearShop();
    const a = ask(data, 'How much inventory did I start the year with?');
    expect(a.intent).toBe('year-beginning');
    expect(a.text).toBe('You started 2026 with $120.83 of inventory at cost (what you paid for the goods on hand on Jan 1, 2026).');
    expect(a.calculation!.value).toBe(120.83);
    expect(a.calculation!.records.map((r) => [r.label, r.parts.items])).toEqual([
      ['Desk lamp', 37.5],
      ['Dinner plates', 33.33],
      ['Glass vase', 50],
    ]);
  });

  it('purchases, cost of goods sold and write-offs, re-added from their records', () => {
    const { data } = yearShop();
    const p = ask(data, 'How much inventory did I purchase in 2025?');
    expect(p.text).toBe('You bought $150.00 of inventory in 2025: $50.00 of individual items, $100.00 in bulk lots and $0.00 of restocks.');
    const c = ask(data, 'What was my cost of goods sold last year?');
    expect(c.text).toBe('Cost of goods sold in 2026 was $35.33: what the 3 units you sold had cost you, from 2 recorded sales.');
    expect(c.details[1]).toBe('The year-end worksheet’s “beginning + purchases − ending” comes to $118.50, because it also includes write-offs, deletions, returns and cost corrections. See Year-End Review.');
    const w = ask(data, 'What inventory did I write off?');
    expect(w.text).toBe('$143.10 of inventory (at cost) was written off or removed in 2026: $13.10 damaged, lost or otherwise written off, $50.00 used personally, and $80.00 in items deleted with stock.');
    expect(w.calculation!.records).toHaveLength(3);
    // Any period, not only years.
    expect(ask(data, 'What was my cost of goods sold in September?', '2026-11-12').text).toBe('Cost of goods sold in September 2026 was $27.00: what the 2 units you sold had cost you, from 1 recorded sale.');
  });

  it('why doesn’t my inventory reconcile: says when it does, and why when it doesn’t', () => {
    const { data, plates } = yearShop();
    expect(ask(data, 'Why doesn’t my inventory reconcile?').text).toBe('Your 2026 inventory does reconcile: beginning $120.83 plus the year’s recorded movements gives $60.33, and the item records show $60.33.');
    const tampered = { ...data, items: data.items.map((i) => (i.id === plates.id ? { ...i, quantity: 5 } : i)) };
    const a = ask(tampered, 'Why doesn’t my inventory reconcile?');
    expect(a.text).toBe('2026 doesn’t fully reconcile. Unexplained difference: $8.34. $8.34 between the item records and the dated movements (a change made outside StockPilot’s recorded actions).');
    expect(a.calculation!.lines.find((l) => l.label === 'Unexplained difference')!.amount).toBe(8.34);
  });

  it('which months are missing, and readiness for the accountant', () => {
    const { data } = yearShop();
    const m = ask(data, 'Which months are missing information?');
    expect(m.text).toContain('12 months of 2026 aren’t closed and verified: January 2026 (not closed)');
    const r = ask(data, 'Is my year-end report ready for my accountant?');
    expect(r.text).toBe('Not yet: 6 year-end steps are still open.');
  });
});
