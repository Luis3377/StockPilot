// Test fixture shared by the sourcing engine and assistant tests (not used by the app).

import { addTimeEntry, assignSource, createSession, createSource, linkToSession } from '../domain/sourcing';
import { addItem, recordSale } from '../domain/actions';
import { createLot } from '../domain/lots';
import { emptyData, type AppData } from '../domain/types';
import { clock } from '../domain/testUtils';

export function sell(data: AppData, itemId: string, quantity: number, total: number, fees: number, shipping = 0, date = '2026-10-10') {
  return recordSale(data, { itemId, quantity, salePrice: total, priceMode: 'total', fees, shipping, saleDate: date, platform: 'eBay' }, clock(`${date}T12:00:00.000Z`)).data;
}

/**
 * The specification's example. Garage sales: 10 records bought for $5 each, sold for $280 with
 * $30 fees and $20 shipping → realized profit $180, over 20 hours. Liquidation: a $380 pallet
 * ($350 + $30 freight) of 20 tools (est. $30) and 10 drills (est. $40), split by value into
 * $11.40 and $15.20 each; all tools sold for $700 ($70 fees, $30 shipping) and 5 drills for $400
 * ($40 fees, $36 shipping) → realized profit $620, over 20 hours. Plus one unsourced lamp.
 */
export function shop() {
  let data = emptyData();
  let r = createSource(data, { name: 'Saturday garage sales', type: 'garage_sale' }, clock());
  data = r.data;
  const garage = r.source;
  r = createSource(data, { name: 'Midwest Liquidation', type: 'liquidation', location: 'Springfield warehouse' }, clock());
  data = r.data;
  const pallets = r.source;
  const records = addItem(data, { name: 'Vinyl records', category: 'Music', quantity: 10, unitCost: 5, purchaseDate: '2026-09-05' }, clock());
  data = assignSource(records.data, 'item', records.item.id, garage.id, clock());
  const lot = createLot(data, { name: 'Pallet A', purchasePrice: 350, extraCosts: [{ label: 'Freight', amount: 30 }], purchaseDate: '2026-09-01', source: 'Midwest Liquidation', notes: '', method: 'relative_value', lines: [{ name: 'Hand tools', quantity: 20, estimatedUnitValue: 30, category: 'Tools' }, { name: 'Drills', quantity: 10, estimatedUnitValue: 40, category: 'Tools' }] }, clock());
  data = lot.data;
  const [tools, drills] = lot.items;
  const lamp = addItem(data, { name: 'Old lamp', category: 'Home', quantity: 1, unitCost: 8 }, clock('2026-09-20T10:00:00.000Z'));
  data = lamp.data;
  data = sell(data, records.item.id, 10, 280, 30, 20, '2026-09-25');
  data = sell(data, tools.id, 20, 700, 70, 30, '2026-10-05');
  data = sell(data, drills.id, 5, 400, 40, 36, '2026-10-20');
  data = sell(data, lamp.item.id, 1, 25, 5, 0, '2026-10-01');
  // 20 hours each: garage time linked to the source, pallet time to the lot and a pickup trip.
  const trip = createSession(data, { name: 'Pallet pickup', date: '2026-09-01', sourceIds: [pallets.id], expenses: [{ label: 'Fuel', amount: 24, kind: 'operating' }], split: null }, clock());
  data = linkToSession(trip.data, 'lot', lot.lot.id, trip.session.id);
  for (const [minutes, links, activity] of [
    [600, [{ kind: 'source' as const, id: garage.id, sharePct: null }], 'sourcing'],
    [600, [{ kind: 'source' as const, id: garage.id, sharePct: null }], 'listing'],
    [900, [{ kind: 'lot' as const, id: lot.lot.id, sharePct: null }], 'listing'],
    [300, [{ kind: 'session' as const, id: trip.session.id, sharePct: null }], 'shipping'],
  ] as const) {
    data = addTimeEntry(data, { date: '2026-10-01', minutes, activity, links: [...links], split: 'equal' }, clock()).data;
  }
  return { data, garage, pallets, lot: lot.lot, tools, drills, records: records.item, lamp: lamp.item, trip: trip.session };
}
