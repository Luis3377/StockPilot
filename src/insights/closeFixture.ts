// Test fixture for the monthly close tests (not used by the app).

import { trackChanges, startLedger } from '../domain/ledger';
import { addItem, adjustQuantity, deleteItem, recordSale, restockItem, updateItem, type ItemInput } from '../domain/actions';
import { createLot } from '../domain/lots';
import { emptyData, type AppData, type Item } from '../domain/types';
import { clock } from '../domain/testUtils';

export const at = (date: string) => clock(`${date}T12:00:00.000Z`);

/** Applies an action the way the app does: the ledger records what it changed. */
export function tracked<R extends { data: AppData }>(data: AppData, date: string, fn: (d: AppData) => R): R {
  const r = fn(data);
  return { ...r, data: trackChanges(data, r.data, at(date)) };
}

export const input = (i: Item, patch: Partial<ItemInput>): ItemInput => ({ name: i.name, sku: i.sku, category: i.category, quantity: i.quantity, unitCost: i.unitCost, askingPrice: i.askingPrice, estimatedValue: i.estimatedValue, purchaseDate: i.purchaseDate, condition: i.condition, location: i.location, lowStockThreshold: i.lowStockThreshold, notes: i.notes, ...patch });
export const sell = (data: AppData, itemId: string, quantity: number, price: number, date: string, fees = 0, shipping = 0) =>
  tracked(data, date, (d) => recordSale(d, { itemId, quantity, salePrice: price, priceMode: 'total', fees, shipping, saleDate: date, platform: 'eBay' }, at(date)));

/**
 * A shop whose ledger covers its whole history (started on an empty dataset). September:
 * records (10 × $5), a $380 pallet split into 20 tools at $11.40 and 10 drills at $15.20,
 * sales of 4 records and 5 tools, one record written off. October: a restock, three cards
 * bought for $10 ($3.3333 each), a deleted item, drill sales and a cost correction.
 */
export function closeShop() {
  let data = startLedger(emptyData(), at('2026-09-01'));
  const records = tracked(data, '2026-09-05', (d) => addItem(d, { name: 'Vinyl records', category: 'Music', quantity: 10, unitCost: 5, purchaseDate: '2026-09-05' }, at('2026-09-05')));
  data = records.data;
  const lot = tracked(data, '2026-09-10', (d) => createLot(d, { name: 'Pallet A', purchasePrice: 350, extraCosts: [{ label: 'Freight', amount: 30 }], purchaseDate: '2026-09-10', source: 'Midwest Liquidation', notes: '', method: 'relative_value', lines: [{ name: 'Hand tools', quantity: 20, estimatedUnitValue: 30, category: 'Tools' }, { name: 'Drills', quantity: 10, estimatedUnitValue: 40, category: 'Tools' }] }, at('2026-09-10')));
  data = lot.data;
  const [tools, drills] = lot.items;
  data = sell(data, records.item.id, 4, 100, '2026-09-20', 12, 8).data; // cogs 20
  data = sell(data, tools.id, 5, 150, '2026-09-21', 15, 10).data; // cogs 57 (5 × 11.40)
  data = tracked(data, '2026-09-25', (d) => adjustQuantity(d, records.item.id, 5, 'Warped, thrown away', at('2026-09-25'))).data; // −5
  // October
  data = tracked(data, '2026-10-03', (d) => restockItem(d, records.item.id, 3, 6, at('2026-10-03'))).data; // +18
  const cards = tracked(data, '2026-10-04', (d) => addItem(d, { name: 'Trading cards', category: 'Collectibles', quantity: 3, unitCost: 10 / 3, purchaseDate: '2026-10-04' }, at('2026-10-04')));
  data = cards.data;
  const lamp = tracked(data, '2026-10-05', (d) => addItem(d, { name: 'Lamp', category: 'Home', quantity: 2, unitCost: 4, purchaseDate: '2026-10-05' }, at('2026-10-05')));
  data = lamp.data;
  data = sell(data, cards.item.id, 1, 9, '2026-10-06').data;
  data = sell(data, cards.item.id, 1, 9, '2026-10-07').data;
  data = tracked(data, '2026-10-15', (d) => deleteItem(d, lamp.item.id)).data; // −8
  data = sell(data, drills.id, 5, 400, '2026-10-20', 40, 36).data; // cogs 76
  const rec = data.items.find((i) => i.id === records.item.id)!;
  data = tracked(data, '2026-10-22', (d) => updateItem(d, rec.id, input(rec, { unitCost: 6 }), {}, at('2026-10-22'))).data;
  return { data, records: records.item, tools, drills, cards: cards.item, lot: lot.lot };
}
