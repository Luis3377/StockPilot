import { addItem, updateItem, type ItemInput } from '../domain/actions';
import { isDomainError } from '../domain/errors';
import { parseFlexibleDate } from '../domain/dates';
import { parseMoneyInput } from '../domain/money';
import type { AppData, Item } from '../domain/types';
import { parseCsv, toCsv } from './csv';

type Field = keyof Pick<
  ItemInput,
  | 'name'
  | 'sku'
  | 'category'
  | 'quantity'
  | 'unitCost'
  | 'askingPrice'
  | 'estimatedValue'
  | 'purchaseDate'
  | 'condition'
  | 'location'
  | 'lowStockThreshold'
  | 'notes'
>;

/** Accepted header spellings for each field (compared after lowercasing and stripping punctuation). */
const ALIASES: Record<Field, string[]> = {
  name: ['name', 'item name', 'item', 'title', 'product', 'product name', 'description short'],
  sku: ['sku', 'item id', 'product id', 'code', 'item code', 'id'],
  category: ['category', 'type', 'department'],
  quantity: ['quantity', 'qty', 'count', 'stock', 'on hand', 'quantity on hand', 'units'],
  unitCost: ['unit cost', 'cost', 'cost per item', 'cost per unit', 'purchase price', 'unit acquisition cost', 'acquisition cost', 'paid', 'buy price'],
  askingPrice: ['asking price', 'price', 'list price', 'selling price', 'retail price', 'sale price'],
  estimatedValue: ['estimated value', 'est value', 'value', 'market value', 'current value'],
  purchaseDate: ['purchase date', 'date purchased', 'acquired', 'acquisition date', 'date acquired', 'bought'],
  condition: ['condition'],
  location: ['location', 'storage location', 'storage', 'bin', 'shelf'],
  lowStockThreshold: ['low stock threshold', 'low stock alert', 'low stock', 'reorder point', 'reorder level', 'min qty', 'alert level'],
  notes: ['notes', 'note', 'description', 'comments'],
};

const REQUIRED: Field[] = ['name', 'quantity', 'unitCost'];

const LABELS: Record<Field, string> = {
  name: 'name',
  sku: 'sku',
  category: 'category',
  quantity: 'quantity',
  unitCost: 'unit_cost',
  askingPrice: 'asking_price',
  estimatedValue: 'estimated_value',
  purchaseDate: 'purchase_date',
  condition: 'condition',
  location: 'location',
  lowStockThreshold: 'low_stock_threshold',
  notes: 'notes',
};

export const TEMPLATE_HEADER = Object.values(LABELS);

export function importTemplateCsv(): string {
  return toCsv(TEMPLATE_HEADER, [
    ['Nike Dunk Low Panda (Size 10)', 'SNK-001', 'Sneakers', 1, 85, 140, 130, '2026-09-14', 'New', 'Closet shelf A', '', 'Bought at outlet'],
    ['Soy candle - Lavender 8oz', '', 'Candles', 24, 4.1, 18, '', '2026-10-01', 'New', 'Garage bin 3', 6, ''],
  ]);
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export interface ImportRow {
  rowNumber: number;
  input: ItemInput;
  /** Existing item this row appears to duplicate, matched by SKU, else name + category. */
  duplicateOf: Item | null;
  duplicateBy: 'sku' | 'name' | null;
}

export interface ImportIssue {
  rowNumber: number;
  messages: string[];
}

export interface ImportPreview {
  fileRows: number;
  rows: ImportRow[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** Required columns not found in the header. When non-empty nothing can be imported. */
  missingColumns: string[];
  ignoredColumns: string[];
  matchedColumns: string[];
}

function matchColumns(header: string[]) {
  const index: Partial<Record<Field, number>> = {};
  const ignored: string[] = [];
  header.forEach((raw, col) => {
    const h = normalizeHeader(raw);
    const field = (Object.keys(ALIASES) as Field[]).find(
      (f) => index[f] === undefined && ALIASES[f].some((a) => normalizeHeader(a) === h),
    );
    if (field) index[field] = col;
    else if (raw.trim()) ignored.push(raw.trim());
  });
  return { index, ignored };
}

function parseWhole(raw: string, label: string, errors: string[], required: boolean): number | null {
  const t = raw.trim().replace(/,/g, '');
  if (t === '') {
    if (required) errors.push(`${label} is required.`);
    return null;
  }
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n)) errors.push(`${label} "${raw.trim()}" must be a whole number.`);
  else if (n < 0) errors.push(`${label} can't be negative.`);
  else return n;
  return null;
}

function parseMoney(raw: string, label: string, errors: string[], required: boolean): number | null {
  const v = parseMoneyInput(raw);
  if (v === null) {
    if (required) errors.push(`${label} is required.`);
    return null;
  }
  if (Number.isNaN(v)) errors.push(`${label} "${raw.trim()}" isn't a valid amount.`);
  else if (v < 0) errors.push(`${label} can't be negative.`);
  else return v;
  return null;
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

export function previewInventoryImport(text: string, data: AppData): ImportPreview {
  const table = parseCsv(text);
  const empty: ImportPreview = { fileRows: 0, rows: [], errors: [], warnings: [], missingColumns: [], ignoredColumns: [], matchedColumns: [] };
  if (table.length === 0) {
    return { ...empty, missingColumns: REQUIRED.map((f) => LABELS[f]) };
  }
  const [header, ...body] = table;
  const { index, ignored } = matchColumns(header);
  const missingColumns = REQUIRED.filter((f) => index[f] === undefined).map((f) => LABELS[f]);
  const matchedColumns = (Object.keys(index) as Field[]).map((f) => LABELS[f]);
  if (missingColumns.length) {
    return { ...empty, fileRows: body.length, missingColumns, ignoredColumns: ignored, matchedColumns };
  }

  const cell = (row: string[], f: Field) => (index[f] === undefined ? '' : (row[index[f]!] ?? ''));
  const has = (f: Field) => index[f] !== undefined;
  const rows: ImportRow[] = [];
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const skusInFile = new Map<string, number>();
  const namesInFile = new Map<string, number>();

  body.forEach((row, i) => {
    const rowNumber = i + 2; // 1-based, after the header line
    const problems: string[] = [];
    const name = cell(row, 'name').trim();
    if (!name) problems.push('Name is required.');
    else if (name.length > 200) problems.push('Name must be 200 characters or fewer.');
    const quantity = parseWhole(cell(row, 'quantity'), 'Quantity', problems, true);
    const unitCost = parseMoney(cell(row, 'unitCost'), 'Unit cost', problems, true);
    const askingPrice = parseMoney(cell(row, 'askingPrice'), 'Asking price', problems, false);
    const estimatedValue = parseMoney(cell(row, 'estimatedValue'), 'Estimated value', problems, false);
    const lowStockThreshold = parseWhole(cell(row, 'lowStockThreshold'), 'Low-stock threshold', problems, false);
    const rawDate = cell(row, 'purchaseDate').trim();
    const purchaseDate = parseFlexibleDate(rawDate);
    if (rawDate && !purchaseDate) problems.push(`Purchase date "${rawDate}" isn't a recognised date (use YYYY-MM-DD).`);

    const sku = cell(row, 'sku').trim();
    if (sku) {
      const firstRow = skusInFile.get(sku.toLowerCase());
      if (firstRow) problems.push(`SKU "${sku}" also appears on row ${firstRow}.`);
      else skusInFile.set(sku.toLowerCase(), rowNumber);
    }

    if (problems.length) {
      errors.push({ rowNumber, messages: problems });
      return;
    }

    const category = cell(row, 'category').trim();
    const input: ItemInput = {
      name,
      sku,
      category,
      quantity,
      unitCost,
      askingPrice,
      estimatedValue,
      purchaseDate,
      condition: cell(row, 'condition').trim(),
      location: cell(row, 'location').trim(),
      lowStockThreshold,
      notes: cell(row, 'notes').trim(),
    };

    let duplicateOf: Item | null = null;
    let duplicateBy: ImportRow['duplicateBy'] = null;
    if (sku) {
      duplicateOf = data.items.find((it) => norm(it.sku) === norm(sku)) ?? null;
      if (duplicateOf) duplicateBy = 'sku';
    } else {
      // Without a category column, a matching name alone counts as a duplicate.
      duplicateOf =
        data.items.find((it) => norm(it.name) === norm(name) && (!has('category') || norm(it.category) === norm(category))) ?? null;
      if (duplicateOf) duplicateBy = 'name';
      const key = `${norm(name)}|${norm(category)}`;
      const firstRow = namesInFile.get(key);
      if (firstRow) warnings.push({ rowNumber, messages: [`Same name and category as row ${firstRow} — both will be imported as separate items.`] });
      else namesInFile.set(key, rowNumber);
    }
    rows.push({ rowNumber, input, duplicateOf, duplicateBy });
  });

  // Only pass through optional fields the file actually has, so "update existing" never blanks
  // out data the file didn't mention.
  for (const r of rows) {
    for (const f of Object.keys(LABELS) as Field[]) {
      if (!has(f) && !REQUIRED.includes(f)) delete (r.input as unknown as Record<string, unknown>)[f];
    }
  }

  return { fileRows: body.length, rows, errors, warnings, missingColumns, ignoredColumns: ignored, matchedColumns };
}

export type DuplicateHandling = 'skip' | 'update';

export interface ImportResult {
  data: AppData;
  added: number;
  updated: number;
  skipped: number;
  failed: ImportIssue[];
}

export function applyInventoryImport(data: AppData, preview: ImportPreview, handling: DuplicateHandling): ImportResult {
  let next = data;
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const failed: ImportIssue[] = [];
  for (const row of preview.rows) {
    try {
      // Re-check against the live data in case it changed since the preview.
      const dup = row.duplicateOf ? next.items.find((i) => i.id === row.duplicateOf!.id) : undefined;
      if (dup) {
        if (handling === 'skip') {
          skipped++;
          continue;
        }
        const base: ItemInput = {
          name: dup.name,
          sku: dup.sku,
          category: dup.category,
          quantity: dup.quantity,
          unitCost: dup.unitCost,
          askingPrice: dup.askingPrice,
          estimatedValue: dup.estimatedValue,
          purchaseDate: dup.purchaseDate,
          condition: dup.condition,
          location: dup.location,
          lowStockThreshold: dup.lowStockThreshold,
          notes: dup.notes,
          photoIds: dup.photoIds,
        };
        const merged: ItemInput = { ...base, ...row.input };
        if (!merged.sku) merged.sku = dup.sku;
        next = updateItem(next, dup.id, merged, { adjustmentReason: 'Updated by CSV import', adjustmentSource: 'import' }).data;
        updated++;
      } else {
        next = addItem(next, row.input).data;
        added++;
      }
    } catch (e) {
      failed.push({ rowNumber: row.rowNumber, messages: [isDomainError(e) ? e.message : 'Could not import this row.'] });
    }
  }
  return { data: next, added, updated, skipped, failed };
}
