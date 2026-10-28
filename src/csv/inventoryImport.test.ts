import { describe, expect, it } from 'vitest';
import { applyInventoryImport, importTemplateCsv, previewInventoryImport } from './inventoryImport';
import { inventoryCsv } from './exports';
import { addItem } from '../domain/actions';
import { emptyData } from '../domain/types';

describe('inventory CSV import', () => {
  it('reports missing required columns', () => {
    const p = previewInventoryImport('title,price\nThing,5', emptyData());
    expect(p.missingColumns).toEqual(['quantity', 'unit_cost']);
    expect(p.rows).toHaveLength(0);
  });

  it('accepts header aliases and reports per-row errors with row numbers', () => {
    const csv = [
      'Item Name,Qty,Cost,Price,Purchase Date,Shoe Size',
      '"Jordan 1, Chicago",1,$250.00,400,3/5/2026,10',
      ',2,5,,,',
      'Bad qty,1.5,5,,,',
      'Bad cost,1,abc,,,',
      'Bad date,1,5,,2026-13-01,',
      'Negative,1,-5,,,',
    ].join('\n');
    const p = previewInventoryImport(csv, emptyData());
    expect(p.ignoredColumns).toEqual(['Shoe Size']);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].input).toMatchObject({ name: 'Jordan 1, Chicago', quantity: 1, unitCost: 250, askingPrice: 400, purchaseDate: '2026-03-05' });
    expect(p.errors.map((e) => e.rowNumber)).toEqual([3, 4, 5, 6, 7]);
    expect(p.errors[0].messages[0]).toBe('Name is required.');
    expect(p.errors[1].messages[0]).toContain('whole number');
  });

  it('flags duplicate SKUs within the file', () => {
    const p = previewInventoryImport('name,sku,quantity,unit_cost\nA,X1,1,1\nB,x1,1,1', emptyData());
    expect(p.rows).toHaveLength(1);
    expect(p.errors[0].messages[0]).toContain('also appears on row 2');
  });

  it('skips or updates duplicates of existing items instead of creating copies', () => {
    let data = addItem(emptyData(), { name: 'Widget', sku: 'W-1', quantity: 3, unitCost: 2, location: 'Bin A' }).data;
    data = addItem(data, { name: 'Gadget', category: 'Tools', quantity: 1, unitCost: 9 }).data;
    const csv = 'name,sku,category,quantity,unit_cost\nWidget renamed,W-1,,10,2.5\ngadget,,tools,4,9\nNew thing,,,1,1';
    const p = previewInventoryImport(csv, data);
    expect(p.rows.map((r) => r.duplicateBy)).toEqual(['sku', 'name', null]);

    const skipped = applyInventoryImport(data, p, 'skip');
    expect(skipped).toMatchObject({ added: 1, updated: 0, skipped: 2 });
    expect(skipped.data.items).toHaveLength(3);

    const updated = applyInventoryImport(data, p, 'update');
    expect(updated).toMatchObject({ added: 1, updated: 2, skipped: 0 });
    const widget = updated.data.items.find((i) => i.sku === 'W-1')!;
    expect(widget).toMatchObject({ name: 'Widget renamed', quantity: 10, unitCost: 2.5, location: 'Bin A' });
    expect(updated.data.adjustments.find((a) => a.itemId === widget.id)?.source).toBe('import');
  });

  it('re-importing an export creates no duplicates', () => {
    let data = addItem(emptyData(), { name: 'A', quantity: 1, unitCost: 1, askingPrice: 3, notes: 'line1\nline2' }).data;
    data = addItem(data, { name: 'B, with comma', quantity: 2, unitCost: 2 }).data;
    const p = previewInventoryImport(inventoryCsv(data.items), data);
    expect(p.errors).toEqual([]);
    expect(p.rows.every((r) => r.duplicateBy === 'sku')).toBe(true);
    expect(applyInventoryImport(data, p, 'skip').data.items).toHaveLength(2);
    // Into an empty inventory the same file restores both items.
    const fresh = applyInventoryImport(emptyData(), previewInventoryImport(inventoryCsv(data.items), emptyData()), 'skip');
    expect(fresh.data.items.map((i) => i.notes)).toEqual(['line1\nline2', '']);
  });

  it('the downloadable template imports cleanly', () => {
    const p = previewInventoryImport(importTemplateCsv(), emptyData());
    expect(p.errors).toEqual([]);
    expect(p.rows).toHaveLength(2);
  });
});
