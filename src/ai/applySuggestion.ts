import { existingSpelling } from '../domain/actions';
import type { ScanCondition, ScanResult } from './scanSchema';

/**
 * The only Add Item fields the scanner may fill. Quantity, cost, prices, estimated value,
 * purchase date, SKU, location and alert levels are never touched: the photo can't tell us
 * those, and inventing them would corrupt profit calculations.
 */
export type ScanFillableField = 'name' | 'category' | 'condition' | 'notes';
export const SCAN_FILLABLE_FIELDS: readonly ScanFillableField[] = ['name', 'category', 'condition', 'notes'];

const CONDITION_LABELS: Record<ScanCondition, string | null> = {
  new: 'New',
  like_new: 'Like new',
  good: 'Used — good',
  fair: 'Used — fair',
  poor: 'Used — poor',
  unknown: null,
};

export function conditionLabel(condition: ScanCondition): string | null {
  return CONDITION_LABELS[condition];
}

/** Listing name, with the brand in front when the model left it out. */
export function suggestedName(result: ScanResult): string | null {
  const { name, brand } = result;
  if (!name) return null;
  if (brand && !name.toLowerCase().includes(brand.toLowerCase())) return `${brand} ${name}`.slice(0, 120);
  return name;
}

/** Notes built only from what the scanner reported; null when there is nothing to add. */
export function suggestedNotes(result: ScanResult): string | null {
  const lines: string[] = [];
  if (result.description) lines.push(result.description);
  const ids = [result.brand && `Brand: ${result.brand}`, result.model && `Model: ${result.model}`].filter(Boolean);
  if (ids.length) lines.push(ids.join(' · '));
  if (result.conditionNotes) lines.push(`Visible condition: ${result.conditionNotes}`);
  return lines.length ? lines.join('\n') : null;
}

export interface ScanFill {
  values: Partial<Record<ScanFillableField, string>>;
  filled: ScanFillableField[];
}

/**
 * Decides which form fields to fill from a scan. A field is filled only when it is empty or
 * was filled by an earlier scan, so nothing the user typed is overwritten. Categories reuse
 * the spelling already in the inventory ("sneakers" → "Sneakers").
 */
export function suggestionToFields(
  result: ScanResult,
  current: Record<ScanFillableField, string>,
  aiFilled: ReadonlySet<ScanFillableField>,
  existingCategories: readonly string[],
): ScanFill {
  const suggestions: Record<ScanFillableField, string | null> = {
    name: suggestedName(result),
    category: result.category ? existingSpelling(result.category, existingCategories) : null,
    condition: conditionLabel(result.condition),
    notes: suggestedNotes(result),
  };
  const values: Partial<Record<ScanFillableField, string>> = {};
  const filled: ScanFillableField[] = [];
  for (const field of SCAN_FILLABLE_FIELDS) {
    const suggestion = suggestions[field];
    if (!suggestion) continue;
    if (current[field].trim() !== '' && !aiFilled.has(field)) continue;
    values[field] = suggestion;
    filled.push(field);
  }
  return { values, filled };
}
