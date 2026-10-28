import { describe, expect, it } from 'vitest';
import { answerQuestion, matchItem, parseTimeframe, SUGGESTED_QUESTIONS } from './assistant';
import { buildInsights } from './rules';
import { buildDemoData } from '../data/demo';
import { addItem, recordSale } from '../domain/actions';
import { periodRange } from '../domain/dates';
import { salesInRange, totalSales } from '../domain/calc';
import { formatMoney } from '../domain/money';
import { defaultSettings, emptyData } from '../domain/types';

const TODAY = '2026-10-28';
const settings = defaultSettings();
const demo = buildDemoData(TODAY);

describe('rule-based insights', () => {
  const report = buildInsights(demo, settings, TODAY);

  it('flags low and out-of-stock items against their own thresholds', () => {
    const names = report.lowStock.findings.map((f) => f.item.name);
    expect(names).toContain('Soy Candle — Cedar & Sage 8oz');
    expect(names).toContain('Soy Candle — Lavender 8oz');
    expect(names).not.toContain('Soy Candle — Vanilla Bean 8oz');
    expect(report.lowStock.severity).toBe('critical');
  });

  it('finds slow-moving items using the configured threshold', () => {
    const names = report.slowMoving.findings.map((f) => f.item.name);
    expect(names).toContain('EarthBound (SNES, complete in box)');
    expect(names).not.toContain('Patagonia Synchilla Fleece — M');
    const stricter = buildInsights(demo, { ...settings, slowMovingDays: 500 }, TODAY);
    expect(stricter.slowMoving.findings).toHaveLength(0);
  });

  it('flags sales at a loss and asking prices below cost', () => {
    expect(report.lowMarginSales.findings.map((f) => f.group.label)).toContain('Yeezy Boost 350 V2 "Bone" — Size 10.5');
    expect(report.pricingRisks.findings.map((f) => f.item.name)).toContain('Yeezy Boost 350 V2 "Bone" — Size 10.5');
    expect(report.rate.source).toBe('history');
  });

  it('reports discrepancies from Count Check', () => {
    expect(report.discrepancies.findings).toHaveLength(1);
    expect(report.discrepancies.findings[0].adjustment.reason).toContain('Damaged');
  });

  it('explains when there is not enough data', () => {
    const empty = buildInsights(emptyData(), settings, TODAY);
    expect(empty.lowStock.insufficient).toBeTruthy();
    expect(empty.topRevenue.insufficient).toBeTruthy();
    expect(empty.dataGaps[0]).toContain('first items');
  });
});

describe('assistant', () => {
  const ask = (q: string) => answerQuestion(q, { data: demo, settings, today: TODAY });

  it('answers every suggested question with a matching rule (never "unknown")', () => {
    for (const q of SUGGESTED_QUESTIONS) {
      const a = ask(q);
      expect(a.intent, q).not.toBe('unknown');
      expect(a.source).toBe('rules');
    }
  });

  it('routes the spec example questions to the right rules', () => {
    expect(ask('How much profit have I made this month?').intent).toBe('profit');
    expect(ask('Which items are making me the most money?').intent).toBe('top-items');
    expect(ask('What inventory has been sitting the longest?').intent).toBe('slow-moving');
    expect(ask('How much money do I have invested in unsold inventory?').intent).toBe('invested');
    expect(ask('Which categories are performing best?').intent).toBe('categories');
    expect(ask('What items should I consider discounting?').intent).toBe('discount');
    expect(ask('Which products are running low?').intent).toBe('low-stock');
  });

  it('uses real recorded numbers for profit answers', () => {
    const expected = totalSales(salesInRange(demo.sales, periodRange('this_month', TODAY))).netProfit;
    expect(ask('How much profit have I made this month?').text).toContain(formatMoney(expected));
  });

  it('filters profit by platform when one is mentioned', () => {
    const ebay = totalSales(demo.sales.filter((s) => s.platform === 'eBay')).netProfit;
    const a = ask('How much profit did I make on eBay overall?');
    expect(a.text).toContain('on eBay');
    expect(a.text).toContain(formatMoney(ebay));
  });

  it('looks up an item by name', () => {
    const a = ask('Tell me about the Charizard');
    expect(a.intent).toBe('item');
    expect(a.text).toContain('Charizard');
  });

  it('admits when it cannot answer', () => {
    expect(ask('What is the weather tomorrow?').intent).toBe('unknown');
    expect(answerQuestion('profit?', { data: emptyData(), settings, today: TODAY }).intent).toBe('no-data');
  });

  it('says so when there are no sales to analyse', () => {
    const { data } = addItem(emptyData(), { name: 'Lamp', quantity: 1, unitCost: 5 });
    expect(answerQuestion('How much profit this month?', { data, settings, today: TODAY }).text).toContain("haven't recorded any sales");
    const sold = recordSale(data, { itemId: data.items[0].id, quantity: 1, salePrice: 9, priceMode: 'per_unit', saleDate: '2026-01-05' }).data;
    expect(answerQuestion('profit this month', { data: sold, settings, today: TODAY }).text).toContain('no recorded sales this month');
  });
});

describe('timeframes and matching', () => {
  it('parses common phrases', () => {
    expect(parseTimeframe('profit last 7 days', TODAY)).toMatchObject({ start: '2026-10-22', end: TODAY });
    expect(parseTimeframe('sales in march', TODAY)).toMatchObject({ start: '2026-03-01', end: '2026-03-31' });
    expect(parseTimeframe('sales in december', TODAY)).toMatchObject({ start: '2025-12-01' });
    expect(parseTimeframe('profit this week', TODAY)).toMatchObject({ start: '2026-10-26' });
    expect(parseTimeframe('profit', TODAY)).toBeNull();
  });

  it('matches items by SKU or distinctive name words', () => {
    expect(matchItem('how is SP-0002 doing', demo.items)?.sku).toBe('SP-0002');
    expect(matchItem('ohtani card', demo.items)?.name).toContain('Ohtani');
    expect(matchItem('the', demo.items)).toBeNull();
  });
});
