import { describe, expect, it } from 'vitest';
import { answerQuestion } from './assistant';
import { verifyCalculation } from './calculations';
import { sourcingIntent } from './sourcingAnswers';
import { assignSource, createSession, createSource, linkToSession } from '../domain/sourcing';
import { addItem } from '../domain/actions';
import { buildDemoData } from '../data/demo';
import { defaultSettings, emptyData, type AppData } from '../domain/types';
import { clock } from '../domain/testUtils';
import { sell, shop } from './sourcingFixture';

const settings = defaultSettings();
const TODAY = '2026-11-12';
const ask = (data: AppData, q: string) => {
  const a = answerQuestion(q, { data, settings, today: TODAY });
  if (a.calculation) expect(verifyCalculation(a.calculation), q).toEqual([]);
  return a;
};

/** Two thrift stores: West sold 6 mugs ($9 profit each), East 2 vases ($14 each). */
function withThrift(base: AppData) {
  let data = base;
  let r = createSource(data, { name: 'Goodwill — West Little Rock', type: 'thrift' }, clock());
  data = r.data;
  const west = r.source;
  r = createSource(data, { name: 'Savers East', type: 'thrift' }, clock());
  data = r.data;
  const east = r.source;
  const mugs = addItem(data, { name: 'Pyrex mug', category: 'Kitchen', quantity: 6, unitCost: 2, purchaseDate: '2026-10-01' }, clock());
  data = assignSource(mugs.data, 'item', mugs.item.id, west.id, clock());
  const vases = addItem(data, { name: 'Glass vase', category: 'Home', quantity: 2, unitCost: 4, purchaseDate: '2026-10-01' }, clock());
  data = assignSource(vases.data, 'item', vases.item.id, east.id, clock());
  data = sell(data, mugs.item.id, 6, 72, 6, 0, '2026-10-20'); // 72 − 12 − 6 = 54
  data = sell(data, vases.item.id, 2, 40, 4, 0, '2026-10-21'); // 40 − 8 − 4 = 28
  return data;
}

describe('assistant: sourcing questions', () => {
  it('routes the seven sourcing questions, and leaves other questions alone', () => {
    expect(sourcingIntent('where do i make the most money?')).toBe('source-profit');
    expect(sourcingIntent('which thrift store is most profitable?')).toBe('source-profit');
    expect(sourcingIntent('what is my profit per hour?')).toBe('profit-per-hour');
    expect(sourcingIntent('which category gives me the best return for my time?')).toBe('profit-per-hour');
    expect(sourcingIntent('how much inventory money is tied up at each source?')).toBe('source-tied-up');
    expect(sourcingIntent('which sourcing trips were most successful?')).toBe('source-trips');
    expect(sourcingIntent('where should i consider sourcing more inventory?')).toBe('source-recommend');
    // Selling platforms, plain inventory and item questions are not sourcing questions.
    for (const q of ['which platform earns me the most?', 'where should i sell my records?', 'how much money do i have invested in unsold inventory?', 'how much money is tied up in slow-moving inventory?', 'which items are making me the most money?', 'how much profit have my bulk lots made?']) {
      expect(sourcingIntent(q), q).toBeNull();
    }
    const demo = buildDemoData(TODAY);
    expect(ask(demo, 'Which platform earns me the most?').intent).toBe('platforms');
    expect(ask(demo, 'How much money do I have invested in unsold inventory?').intent).toBe('invested');
  });

  it('where do I make the most money: realized profit by source, with the records behind it', () => {
    const { data } = shop();
    const a = ask(data, 'Where do I make the most money?');
    expect(a.intent).toBe('source-profit');
    expect(a.text).toContain('Midwest Liquidation has made you the most all time: $620.00 realized profit from 25 units sold');
    expect(a.details.join(' ')).toContain('Saturday garage sales: $180.00 from 10 units');
    expect(a.details.join(' ')).toContain('$76.00 of Midwest Liquidation’s stock is still unsold');
    expect(a.calculation!.value).toBe(620);
    expect(a.calculation!.records).toHaveLength(2); // the tools and drills sales
    // Periods: only October's sales.
    const oct = ask(data, 'Where did I make the most money in October?');
    expect(oct.intent).toBe('source-profit');
    expect(oct.calculation!.period).toMatchObject({ start: '2026-10-01', end: '2026-10-31' });
  });

  it('which thrift store is most profitable: only thrift stores, with a small-sample caveat', () => {
    const data = withThrift(shop().data);
    const a = ask(data, 'Which thrift store is most profitable?');
    expect(a.text).toContain('Goodwill — West Little Rock has made you the most among your thrift store sources');
    expect(a.text).toContain('$54.00 realized profit from 6 units sold');
    expect(a.text).not.toContain('Midwest');
    expect(a.details.join(' ')).toContain('Savers East: $28.00 from 2 units (small sample)');
    expect(a.calculation!.value).toBe(54);
    // No thrift stores with sales: says so, invents nothing.
    const none = ask(shop().data, 'Which thrift store is most profitable?');
    expect(none.text).toContain('None of your thrift store sources has a recorded sale');
    expect(none.calculation).toBeUndefined();
  });

  it('profit per hour: realized profit ÷ logged hours, labelled as not a wage', () => {
    const { data } = shop();
    const a = ask(data, 'What is my profit per hour?');
    expect(a.intent).toBe('profit-per-hour');
    // $180 + $620 + $12 (the unsourced lamp) over 40 h.
    expect(a.text).toBe('Your realized profit per logged hour all time is $20.30: $812.00 realized profit ÷ 40 h logged.');
    expect(a.details.join(' ')).toContain('Midwest Liquidation: $31.00 per hour ($620.00 ÷ 20 h), still selling');
    expect(a.details.join(' ')).toContain('Saturday garage sales: $9.00 per hour ($180.00 ÷ 20 h)');
    expect(a.details.join(' ')).toContain('not an hourly wage');
    expect(a.calculation!.value).toBe(812);
    // No time logged: says there isn't enough data rather than dividing by zero.
    const bare = withThrift(emptyData());
    const none = ask(bare, 'What is my profit per hour?');
    expect(none.text).toContain('Not enough time data');
    expect(none.calculation!.value).toBe(82);
  });

  it('best return for my time by category uses only time linked to items or lots', () => {
    const { data } = shop();
    const a = ask(data, 'Which category gives me the best return for my time?');
    // 15 h on the pallet (all Tools); the garage time was linked to the source, not the records.
    expect(a.text).toContain('Tools gives you the most realized profit per logged hour all time: $41.33 ($620.00 ÷ 15 h)');
    expect(a.details.join(' ')).toContain('Only time linked to items or lots counts toward a category');
    expect(a.calculation!.value).toBe(620);
    expect(ask(withThrift(emptyData()), 'Which category gives me the best return for my time?').text).toContain('Not enough time data');
  });

  it('money tied up by source re-adds from the unsold items', () => {
    const data = withThrift(shop().data);
    const extra = addItem(data, { name: 'Unsold lamp', quantity: 3, unitCost: 5 }, clock());
    const a = ask(extra.data, 'How much inventory money is tied up at each source?');
    expect(a.intent).toBe('source-tied-up');
    expect(a.text).toContain('$91.00 of inventory cost is tied up in unsold stock across 2 sources');
    expect(a.text).toContain('The most is from Midwest Liquidation: $76.00 (5 units');
    expect(a.details.join(' ')).toContain('Unassigned source: $15.00 (3 units)');
    expect(a.calculation!.records.map((r) => r.label).sort()).toEqual(['Drills', 'Unsold lamp']);
  });

  it('best trips: only completed trips are ranked, by return after trip expenses', () => {
    const s = shop();
    // The pallet trip still has 5 drills: not completed.
    const open = ask(s.data, 'Which sourcing trips were most successful?');
    expect(open.text).toContain('Your trip isn’t completed yet');
    expect(open.text).toContain('Pallet pickup has the most realized profit: $620.00');
    // A garage-sale trip whose records all sold: $280 − $50 fees and shipping − $50 bought − $10 parking.
    const t = createSession(s.data, { name: 'Saturday loop', date: '2026-09-05', sourceIds: [s.garage.id], expenses: [{ label: 'Parking', amount: 10, kind: 'acquisition' }], split: null }, clock());
    const data = linkToSession(t.data, 'item', s.records.id, t.session.id);
    const a = ask(data, 'Which sourcing trips were most successful?');
    expect(a.text).toContain('Your most successful completed trip was Saturday loop');
    expect(a.text).toContain('$170.00 after what you paid and $10.00 of trip expenses, a 283.33% return');
    expect(a.details.join(' ')).toContain('1 trip still has stock to sell');
    expect(a.calculation!.value).toBe(170);
    expect(a.calculation!.lines.map((l) => [l.key, l.amount])).toEqual([['revenue', 280], ['selling', 50], ['bought', 50], ['trip', 10], ['result', 170]]);
    expect(ask(emptyData(), 'Which sourcing trips were most successful?').intent).toBe('no-data');
  });

  it('where to source more: observed history per logged hour, framed as the past, not a prediction', () => {
    const { data } = shop();
    const a = ask(data, 'Where should I consider sourcing more inventory?');
    expect(a.intent).toBe('source-recommend');
    expect(a.text).toContain('a record of the past, not a prediction');
    expect(a.text).toContain('Midwest Liquidation has done best: $31.00 realized profit per logged hour, from 25 units sold');
    expect(a.details.join(' ')).toContain('Estimated resale values aren’t counted');
    expect(a.details.join(' ')).toContain('Midwest Liquidation still has $76.00 of stock unsold');
    // Without time, it compares return on cost and says so.
    const b = ask(withThrift(emptyData()), 'Where should I consider sourcing more inventory?');
    expect(b.text).toContain('Goodwill — West Little Rock has done best: a 450% return on the cost of what sold');
    expect(b.text).not.toContain('Only');
    expect(b.details.join(' ')).toContain('No time is logged per source yet');
  });

  it('a source is never called profitable from estimated value alone', () => {
    let data = emptyData();
    const r = createSource(data, { name: 'Estate on Elm', type: 'estate_sale' }, clock());
    const item = addItem(r.data, { name: 'Oil painting', quantity: 1, unitCost: 40, estimatedValue: 900 }, clock());
    data = assignSource(item.data, 'item', item.item.id, r.source.id, clock());
    const a = ask(data, 'Where do I make the most money?');
    expect(a.text).toContain('no sales with a recorded source');
    expect(a.text).not.toContain('900');
    expect(a.calculation).toBeUndefined();
  });
});
