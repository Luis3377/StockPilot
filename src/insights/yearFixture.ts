// Test fixture for the year-end tests (not used by the app): two calendar years of activity,
// recorded through the app's actions with the inventory ledger running from the start.
//
// 2025: a lamp (4 × $12.50); an estate lot ($90 + $10 freight) split into a $50 vase and six
//       plates at $8.3333; a lamp sold Dec 20; two plates sold Dec 31.
// 2026: a plate sold Jan 2; 2 lamps restocked at $14 (cost averages to $13.10); a damaged lamp
//       written off; the vase used personally; a plate returned; a $80 rug added and deleted;
//       the lamp cost corrected to $13.50; two lamps sold in September.

import { startLedger } from '../domain/ledger';
import { addItem, adjustQuantity, completeCount, deleteItem, restockItem, setCount, startCount, updateItem, type CountDecision } from '../domain/actions';
import { createLot } from '../domain/lots';
import { decideStep, closeMonth } from '../domain/close';
import { closeChecklist } from './closeChecklist';
import { defaultSettings, emptyData, type AppData } from '../domain/types';
import { at, input, sell, tracked } from './closeFixture';

export function yearShop() {
  let data = startLedger(emptyData(), at('2025-11-01'));
  const lamp = tracked(data, '2025-11-05', (d) => addItem(d, { name: 'Desk lamp', category: 'Lighting', quantity: 4, unitCost: 12.5, purchaseDate: '2025-11-05' }, at('2025-11-05')));
  data = lamp.data;
  const lot = tracked(data, '2025-12-10', (d) => createLot(d, { name: 'Estate box', purchasePrice: 90, extraCosts: [{ label: 'Freight', amount: 10 }], purchaseDate: '2025-12-10', source: '', notes: '', method: 'relative_value', lines: [{ name: 'Glass vase', quantity: 1, estimatedUnitValue: 60, category: 'Decor' }, { name: 'Dinner plates', quantity: 6, estimatedUnitValue: 10, category: 'Kitchen' }] }, at('2025-12-10')));
  data = lot.data;
  const [vase, plates] = lot.items;
  data = sell(data, lamp.item.id, 1, 30, '2025-12-20', 3).data;
  data = sell(data, plates.id, 2, 40, '2025-12-31', 4).data;
  // 2026
  data = sell(data, plates.id, 1, 20, '2026-01-02', 2).data;
  data = tracked(data, '2026-01-15', (d) => restockOf(d, lamp.item.id)).data;
  data = tracked(data, '2026-02-03', (d) => adjustQuantity(d, lamp.item.id, 4, 'Damaged', at('2026-02-03'))).data;
  data = tracked(data, '2026-03-01', (d) => adjustQuantity(d, vase.id, 0, 'Used personally', at('2026-03-01'))).data;
  data = tracked(data, '2026-04-10', (d) => adjustQuantity(d, plates.id, 4, 'Returned to stock', at('2026-04-10'))).data;
  const rug = tracked(data, '2026-05-05', (d) => addItem(d, { name: 'Wool rug', category: 'Decor', quantity: 1, unitCost: 80, purchaseDate: '2026-05-05' }, at('2026-05-05')));
  data = rug.data;
  data = tracked(data, '2026-06-01', (d) => deleteItem(d, rug.item.id)).data;
  const l = data.items.find((i) => i.id === lamp.item.id)!;
  data = tracked(data, '2026-07-01', (d) => updateItem(d, l.id, input(l, { unitCost: 13.5 }), {}, at('2026-07-01'))).data;
  data = sell(data, lamp.item.id, 2, 60, '2026-09-15', 6).data;
  return { data, lamp: lamp.item, vase, plates, lot: lot.lot };
}

function restockOf(d: AppData, id: string) {
  return restockItem(d, id, 2, 14, at('2026-01-15'));
}

/** A completed Count Check on `date` with the given counted quantities. */
export function countOn(data: AppData, date: string, counts: Record<string, number>, apply: boolean) {
  let d = startCount(data, { category: null, location: null }, at(date));
  for (const [id, n] of Object.entries(counts)) d = setCount(d, id, n);
  const decisions: CountDecision[] = Object.keys(counts).map((itemId) => ({ itemId, apply, reason: apply ? 'Missing at year-end count' : '' }));
  const before = d;
  const r = completeCount(d, decisions, at(date));
  return tracked(before, date, () => r);
}

/** Decides every checklist step of a month (acknowledging any issues) and closes it. */
export function closeWholeMonth(data: AppData, month: string, today: string): AppData {
  const settings = defaultSettings();
  let d = data;
  for (const s of closeChecklist(d, settings, month, today).steps) {
    const attention = s.issues.some((i) => i.severity === 'attention');
    d = decideStep(d, settings, month, s.step, attention ? 'acknowledged' : s.canReview ? 'reviewed' : 'na', attention ? 'Known; noted for the accountant.' : '', today, at(today));
  }
  return closeMonth(d, settings, month, { acknowledged: true, note: '' }, today, at(today)).data;
}
