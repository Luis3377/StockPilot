// The same financial figure must mean the same thing, and show the same number, on the
// dashboard, in Smart Insights and in the assistant's answers.

import { describe, expect, it } from 'vitest';
import { answerQuestion } from './assistant';
import { buildInsights } from './rules';
import { buildDemoData } from '../data/demo';
import { inventoryTotals, projectUnsold, salesByCategory, salesInRange } from '../domain/calc';
import { periodRange, type PeriodKey } from '../domain/dates';
import { formatMoney, formatPercent } from '../domain/money';
import { TERMS } from '../domain/terms';
import { defaultSettings } from '../domain/types';

const TODAY = '2026-10-28';
const settings = defaultSettings();
const demo = buildDemoData(TODAY);
const ask = (q: string) => answerQuestion(q, { data: demo, settings, today: TODAY });
const money = (n: number) => formatMoney(n, settings.currency);

describe('financial terms', () => {
  const t = inventoryTotals(demo.items);

  it('keeps inventory cost, total asking price and est. market value distinct in the data', () => {
    // The demo has all three, and they differ, so mixing them up would show.
    expect(new Set([t.costValue, t.askingValue, t.estimatedValue]).size).toBe(3);
  });

  it('answers "how much have I invested" with inventory cost — the dashboard figure — not market value', () => {
    for (const q of ['How much money do I have invested in unsold inventory?', 'How much money is tied up in stock?', 'how much did i spend on inventory']) {
      const a = ask(q);
      expect(a.intent, q).toBe('invested');
      expect(a.text, q).toContain(money(t.costValue));
      expect(a.text, q).not.toContain(money(t.estimatedValue));
      expect(a.text).toContain('inventory cost');
    }
  });

  it('answers "what is it worth" with all three figures, each named', () => {
    const a = ask('What is my inventory worth?');
    expect(a.intent).toBe('worth');
    expect(a.text).toContain(money(t.costValue));
    expect(a.text).toContain(money(t.askingValue));
    expect(a.text).toContain(money(t.estimatedValue));
    expect(a.table?.rows.map((r) => r[0])).toEqual([TERMS.inventoryCost.label, TERMS.totalAsking.label, TERMS.marketValue.label]);
    expect(a.table?.rows.map((r) => r[1])).toEqual([money(t.costValue), money(t.askingValue), money(t.estimatedValue)]);
  });

  it('reports projected profit with the same calculation as the dashboard', () => {
    const projection = projectUnsold(demo.items, demo.sales, settings);
    expect(ask('What is my inventory worth?').details.join(' ')).toContain(money(projection.projectedProfit));
  });

  it('explains terms with the same definitions the dashboard uses', () => {
    expect(ask('What does projected profit mean?').text).toBe(`${TERMS.projectedProfit.label}: ${TERMS.projectedProfit.definition}`);
    expect(ask('what is the difference between asking price and market value').details).toEqual([
      `${TERMS.totalAsking.label}: ${TERMS.totalAsking.definition}`,
      `${TERMS.marketValue.label}: ${TERMS.marketValue.definition}`,
    ]);
    // Unrelated "meaning" questions aren't mistaken for a definition request.
    expect(ask('What is the meaning of life?').intent).toBe('unknown');
  });
});

describe('reporting periods', () => {
  const keys: PeriodKey[] = ['this_month', 'last_30', 'last_90', 'this_year', 'all'];

  it('gives Smart Insights and the dashboard identical category margins for the same period', () => {
    for (const key of keys) {
      const range = periodRange(key, TODAY);
      const dashboard = salesByCategory(salesInRange(demo.sales, range)); // what "Profit by category" shows
      const insights = buildInsights(demo, settings, TODAY, range).categories;
      for (const g of dashboard) {
        const finding = insights.findings.find((f) => f.group.key === g.key);
        expect(finding, `${key} ${g.label}`).toBeDefined();
        expect(finding!.group.margin).toBe(g.margin);
        expect(finding!.detail).toContain(`${formatPercent(g.margin)} margin`);
      }
      expect(insights.findings).toHaveLength(dashboard.length);
      expect(insights.period).toBe(range.label);
    }
  });

  it('labels every insight with the time it covers', () => {
    const report = buildInsights(demo, settings, TODAY, periodRange('this_month', TODAY));
    expect(report.lowStock.period).toBe('today');
    expect(report.slowMoving.period).toBe('today');
    expect(report.pricingRisks.period).toBe('today');
    expect(report.lowMarginSales.period).toBe('this month');
    expect(report.topRevenue.period).toBe('this month');
    expect(report.categories.period).toBe('this month');
    expect(report.discrepancies.period).toBe('last 90 days');
    expect(report.lowMarginSales.rule).toContain('this month');
  });

  it('defaults to all time when no period is given (unchanged behaviour)', () => {
    expect(buildInsights(demo, settings, TODAY).categories.period).toBe('all time');
  });

  it('states the period in low-margin answers, defaulting to all time', () => {
    expect(ask('which items lost money this month?').text).toMatch(/this month|No sales this month/);
    expect(ask('which items lost money?').details[0]).toContain('all time');
  });
});

describe('slow-moving amounts', () => {
  it('say that the amount is inventory cost', () => {
    const report = buildInsights(demo, settings, TODAY);
    expect(report.slowMoving.findings.length).toBeGreaterThan(0);
    for (const f of report.slowMoving.findings) expect(f.detail).toContain('inventory cost');
    expect(report.slowMoving.rule).toContain('inventory cost');
  });
});
