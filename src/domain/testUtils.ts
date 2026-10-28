import { addItem, type ItemInput } from './actions';
import { emptyData, type AppData, type Item } from './types';

export const clock = (iso = '2026-10-28T12:00:00.000Z') => ({ now: new Date(iso) });

export function withItem(input: Partial<ItemInput> = {}, data: AppData = emptyData()): { data: AppData; item: Item } {
  return addItem(data, { name: 'Test item', quantity: 5, unitCost: 10, ...input }, clock());
}
