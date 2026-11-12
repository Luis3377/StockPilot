import { describe, expect, it } from 'vitest';
import { answerQuestion } from './assistant';
import { verifyCalculation } from './calculations';
import { planningIntent } from './planningAnswers';
import { addCategory, addEntry, addObligation, setTaxPercent } from '../domain/planning';
import { defaultSettings, type AppData } from '../domain/types';
import { at, closeShop, sell } from './closeFixture';

const settings = defaultSettings();
const TODAY = '2026-11-12';
const ask = (data: AppData, q: string) => {
  const a = answerQuestion(q, { data, settings, today: TODAY });
  if (a.calculation) expect(verifyCalculation(a.calculation), q).toEqual([]);
  return a;
};

function planned() {
  const s = closeShop();
  let data = setTaxPercent(s.data, 25, at('2026-11-01'));
  data = addCategory(data, { name: 'Equipment replacement', kind: 'equipment', mode: 'goal', goal: 500 }, at('2026-11-01')).data;
  const [tax, eq] = data.planning.categories;
  data = addEntry(data, { categoryId: tax.id, date: '2026-10-31', kind: 'deposit', amount: 50, note: 'Savings transfer' }, {}, at('2026-11-01')).data;
  data = addEntry(data, { categoryId: eq.id, date: '2026-11-02', kind: 'deposit', amount: 100 }, {}, at('2026-11-02')).data;
  data = addObligation(data, { description: 'Quarterly estimated tax payment', category: 'tax_payment', dueDate: '2027-01-15', amount: 150, recurrence: 'quarterly', reserveCategoryId: tax.id }, at(TODAY)).data;
  data = addObligation(data, { description: 'Insurance renewal', category: 'insurance', dueDate: '2026-11-20', amount: 420, recurrence: 'none' }, at(TODAY)).data;
  return { ...s, data };
}

describe('assistant: financial planning questions', () => {
  it('routes the six questions without taking over existing ones', () => {
    expect(planningIntent('how much profit should i consider reserving?')).toBe('reserve-suggested');
    expect(planningIntent('how much have i set aside?')).toBe('reserve-set-aside');
    expect(planningIntent('what is my remaining reserve goal?')).toBe('reserve-remaining');
    expect(planningIntent('what financial obligations are coming up?')).toBe('obligations');
    expect(planningIntent('how much profit remains after my planned reserves?')).toBe('after-reserves');
    expect(planningIntent('how did my reserve target change from last month?')).toBe('reserve-change');
    for (const q of ['how much profit have i made this month?', 'how much money do i have invested in unsold inventory?', 'what is my profit per hour?']) expect(planningIntent(q), q).toBeNull();
  });

  it('never assumes a tax rate', () => {
    const a = ask(closeShop().data, 'How much profit should I consider reserving in October?');
    expect(a.text).toContain('You haven’t chosen a reserve percentage yet. StockPilot doesn’t assume a tax rate');
    expect(a.calculation).toBeUndefined();
  });

  it('suggested reserve and profit remaining, from recorded sales at the user’s percentage', () => {
    const { data } = planned();
    const a = ask(data, 'How much profit should I consider reserving in October?');
    expect(a.text).toBe('At the 25% you chose, consider setting aside $64.83 for October 2026: $259.33 × 25% = $64.83.');
    expect(a.details).toContain('A planning estimate from your own percentage, not tax advice or what you actually owe; recorded profit isn’t taxable income or cash.');
    expect(a.calculation!.lines.map((l) => [l.label, l.op, l.amount])).toEqual([
      ['Recorded realized profit, October 2026', '+', 259.33],
      ['Taxes: 25% (your setting)', '-', 64.83],
      ['Profit remaining after planned reserves', '=', 194.5],
    ]);
    expect(a.calculation!.records).toHaveLength(3); // the month's sales
    expect(ask(data, 'How much profit remains after my planned reserves in October?').text).toBe('After your planned reserves ($64.83), $194.50 of recorded profit remains for October 2026.');
    // A month with no profit suggests nothing, and says why.
    expect(ask(data, 'How much profit should I consider reserving this month?').text).toBe('No profit is recorded for November 2026 (to date) ($0.00), so your 25% setting suggests $0.00. A loss doesn’t create a negative reserve, and you may still have obligations.');
  });

  it('what has been set aside, and what remains, from the user’s own entries', () => {
    const { data } = planned();
    const a = ask(data, 'How much have I set aside?');
    expect(a.text).toBe('You’ve recorded $150.00 as set aside: Taxes $50.00, Equipment replacement $100.00.');
    expect(a.details[0]).toContain('StockPilot doesn’t see your bank');
    expect(a.calculation!.records.map((r) => r.parts)).toEqual([{ c0: 50 }, { c1: 100 }]);
    const r = ask(data, 'What is my remaining reserve goal in October?');
    // The equipment deposit is dated Nov 2: at the end of October nothing was set aside for it yet.
    expect(r.text).toBe('You have $514.83 left to set aside toward your targets for October 2026: Taxes $14.83, Equipment replacement $500.00.');
    expect(ask(data, 'What is my remaining reserve goal this month?').text).toContain('Equipment replacement $400.00');
  });

  it('upcoming obligations: planning entries, not expenses', () => {
    const { data } = planned();
    const a = ask(data, 'What financial obligations are coming up?');
    expect(a.text).toBe('You’ve planned 2 payments in the next 90 days, $570.00 in total. The next is Insurance renewal: $420.00 on Nov 20, 2026.');
    expect(a.details).toContain('These are your own planning entries: they aren’t recorded as expenses and don’t change profit.');
    expect(a.calculation!.basis).toBe('estimate');
  });

  it('how the reserve target changed from last month follows recorded profit', () => {
    let { data, records } = planned();
    data = sell(data, records.id, 1, 70, '2026-11-05', 5).data; // November so far: $70 − $6 cost − $5 fees = $59
    const a = ask(data, 'How did my reserve target change from last month?');
    expect(a.text).toBe('At your 25% setting for Taxes, the suggested reserve is $14.75 for November 2026 (to date) (25% of $59.00), against $64.83 for October 2026 (25% of $259.33). It follows your recorded profit.');
    expect(a.calculation!.records).toHaveLength(4);
  });
});
