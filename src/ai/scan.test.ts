import { describe, expect, it } from 'vitest';
import { parseScanResult, ScanResultError, SCAN_JSON_SCHEMA, toWire, type ScanResult } from './scanSchema';
import { suggestionToFields, suggestedName, suggestedNotes, type ScanFillableField } from './applySuggestion';

const wire = (overrides: Record<string, unknown> = {}) => ({
  status: 'identified',
  name: 'Nike Air Force 1 Low White',
  brand: 'Nike',
  model: 'Air Force 1 Low',
  category: 'Sneakers',
  description: 'White leather low-top sneakers with a white sole.',
  condition: 'good',
  condition_notes: 'Light creasing on the toe box.',
  confidence: 'high',
  notes: null,
  ...overrides,
});

describe('parseScanResult', () => {
  it('accepts a complete answer and converts it to camelCase', () => {
    const r = parseScanResult(wire());
    expect(r).toEqual({
      status: 'identified',
      name: 'Nike Air Force 1 Low White',
      brand: 'Nike',
      model: 'Air Force 1 Low',
      category: 'Sneakers',
      description: 'White leather low-top sneakers with a white sole.',
      condition: 'good',
      conditionNotes: 'Light creasing on the toe box.',
      confidence: 'high',
      notes: null,
    });
    // Round-trips through the backend's wire format.
    expect(parseScanResult(toWire(r))).toEqual(r);
  });

  it('drops any price, value or quantity the model adds', () => {
    const r = parseScanResult(wire({ price: 120, estimated_value: '$90', quantity: 3, cost: 40 })) as unknown as Record<string, unknown>;
    for (const key of ['price', 'estimated_value', 'quantity', 'cost']) expect(r).not.toHaveProperty(key);
  });

  it('treats "unknown"-style words, wrong types and missing fields as null', () => {
    const r = parseScanResult({ status: 'partial', name: 'Cordless drill', brand: 'Unknown', model: 42, category: ['Tools'], condition: 'mint', confidence: 'very' });
    expect(r).toMatchObject({ name: 'Cordless drill', brand: null, model: null, category: null, description: null, condition: 'unknown', confidence: 'low', conditionNotes: null });
  });

  it('keeps the status honest', () => {
    // Unrecognized never carries an identification.
    expect(parseScanResult(wire({ status: 'unrecognized' }))).toMatchObject({ status: 'unrecognized', name: null, brand: null, model: null });
    // "Identified" without a name is only partial.
    expect(parseScanResult(wire({ name: null })).status).toBe('partial');
    // Nothing usable at all is unrecognized.
    expect(parseScanResult({ status: 'identified', confidence: 'high' }).status).toBe('unrecognized');
  });

  it('rejects unusable answers', () => {
    expect(() => parseScanResult(null)).toThrow(ScanResultError);
    expect(() => parseScanResult('Nike shoes')).toThrow(ScanResultError);
    expect(() => parseScanResult([wire()])).toThrow(ScanResultError);
    expect(() => parseScanResult(wire({ status: 'maybe' }))).toThrow('no valid status');
    expect(() => parseScanResult({ name: 'Nike' })).toThrow('no valid status');
  });

  it('trims, strips control characters and caps length', () => {
    const r = parseScanResult(wire({ name: `  Nike\u0007 Air\n\nForce   1 `, description: `${'word '.repeat(200)}` }));
    expect(r.name).toBe('Nike Air Force 1');
    expect(r.description!.length).toBeLessThanOrEqual(400);
    expect(r.description!.endsWith('…')).toBe(true);
  });

  it('describes a schema with no price or quantity fields and every field required', () => {
    const props = Object.keys(SCAN_JSON_SCHEMA.properties);
    expect(props).not.toEqual(expect.arrayContaining(['price']));
    for (const forbidden of ['price', 'cost', 'value', 'quantity', 'estimated_value']) expect(props).not.toContain(forbidden);
    expect([...SCAN_JSON_SCHEMA.required].sort()).toEqual([...props].sort());
    expect(SCAN_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});

describe('suggestionToFields', () => {
  const empty: Record<ScanFillableField, string> = { name: '', category: '', condition: '', notes: '' };
  const result = (overrides: Partial<ScanResult> = {}): ScanResult => ({ ...parseScanResult(wire()), ...overrides });

  it('fills empty fields only with what the photo showed', () => {
    const fill = suggestionToFields(result(), empty, new Set(), []);
    expect(fill.values).toEqual({
      name: 'Nike Air Force 1 Low White',
      category: 'Sneakers',
      condition: 'Used — good',
      notes: 'White leather low-top sneakers with a white sole.\nBrand: Nike · Model: Air Force 1 Low\nVisible condition: Light creasing on the toe box.',
    });
    expect(fill.filled).toEqual(['name', 'category', 'condition', 'notes']);
    // The scanner can never set quantities, costs, prices or dates.
    for (const key of ['quantity', 'unitCost', 'askingPrice', 'estimatedValue', 'purchaseDate', 'sku', 'location']) {
      expect(fill.values).not.toHaveProperty(key);
    }
  });

  it('never overwrites what the user typed, but replaces an earlier scan', () => {
    const typed = { ...empty, name: 'My sneakers', condition: 'Worn twice' };
    const first = suggestionToFields(result(), typed, new Set(), []);
    expect(first.values).not.toHaveProperty('name');
    expect(first.values).not.toHaveProperty('condition');
    const rescanned = suggestionToFields(result({ name: 'Nike Air Force 1 07' }), { ...empty, name: 'Nike Air Force 1 Low White' }, new Set(['name']), []);
    expect(rescanned.values.name).toBe('Nike Air Force 1 07');
  });

  it('empties earlier AI suggestions the new scan has nothing for, but keeps typed values', () => {
    const current = { name: 'Nike Air Force 1 Low White', category: 'Sneakers', condition: 'Worn twice', notes: 'old AI notes' };
    const unrecognized = result({ status: 'unrecognized', name: null, brand: null, model: null, category: null, description: null, condition: 'unknown', conditionNotes: null });
    const fill = suggestionToFields(unrecognized, current, new Set(['name', 'category', 'notes']), []);
    expect(fill.filled).toEqual([]);
    expect(fill.cleared).toEqual(['name', 'category', 'notes']);
    expect(fill.values).toEqual({ name: '', category: '', notes: '' });
    // Condition was typed by the user, so it is left alone.
    expect(fill.values).not.toHaveProperty('condition');
  });

  it('reuses existing category spelling and leaves unknowns blank', () => {
    const fill = suggestionToFields(result({ category: 'sneakers', condition: 'unknown', conditionNotes: null }), empty, new Set(), ['Sneakers', 'Tools']);
    expect(fill.values.category).toBe('Sneakers');
    expect(fill.values).not.toHaveProperty('condition');
    const unknown = suggestionToFields(parseScanResult({ status: 'unrecognized', condition: 'unknown', confidence: 'low' }), empty, new Set(), []);
    expect(unknown).toEqual({ values: {}, filled: [], cleared: [] });
  });

  it('puts the brand in the name when the model left it out', () => {
    expect(suggestedName(result({ name: 'Switch OLED', brand: 'Nintendo' }))).toBe('Nintendo Switch OLED');
    expect(suggestedName(result({ name: 'Nintendo Switch OLED', brand: 'nintendo' }))).toBe('Nintendo Switch OLED');
    expect(suggestedNotes(result({ description: null, brand: null, model: null, conditionNotes: null }))).toBeNull();
  });
});
