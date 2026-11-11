// The contract between the AI Inventory Scanner backend (worker/) and the app.
//
// This file is shared: the Cloudflare Worker imports it to build the structured-output schema
// and to validate Claude's answer before returning it, and the app validates the response
// again before anything reaches the Add Item form. It has no browser or Worker dependencies.
//
// The schema deliberately has no price, cost, value or quantity fields: the scanner only
// describes what is visible in the photo. Anything the model is unsure about must be null.

export type ScanStatus = 'identified' | 'partial' | 'unrecognized';
export type ScanCondition = 'new' | 'like_new' | 'good' | 'fair' | 'poor' | 'unknown';
export type ScanConfidence = 'high' | 'medium' | 'low';

export interface ScanResult {
  /** identified: product is clear; partial: some details only; unrecognized: nothing reliable. */
  status: ScanStatus;
  name: string | null;
  brand: string | null;
  model: string | null;
  category: string | null;
  description: string | null;
  condition: ScanCondition;
  conditionNotes: string | null;
  confidence: ScanConfidence;
  /** A short note for the user, e.g. "The model number isn't visible; check the label." */
  notes: string | null;
}

const STATUSES: readonly ScanStatus[] = ['identified', 'partial', 'unrecognized'];
const CONDITIONS: readonly ScanCondition[] = ['new', 'like_new', 'good', 'fair', 'poor', 'unknown'];
const CONFIDENCES: readonly ScanConfidence[] = ['high', 'medium', 'low'];

/** Longest value kept per field; longer text is cut at a word boundary. */
export const FIELD_LIMITS = {
  name: 120,
  brand: 60,
  model: 80,
  category: 40,
  description: 400,
  conditionNotes: 300,
  notes: 300,
} as const;

const nullableString = (description: string) => ({
  anyOf: [{ type: 'string' }, { type: 'null' }],
  description,
});

/**
 * JSON schema for Claude's structured output (snake_case on the wire). Every property is
 * required so the model must decide each one explicitly, using null when it can't tell.
 */
export const SCAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'name', 'brand', 'model', 'category', 'description', 'condition', 'condition_notes', 'confidence', 'notes'],
  properties: {
    status: {
      type: 'string',
      enum: [...STATUSES],
      description: 'identified = the product is clearly recognizable; partial = only some details are visible; unrecognized = no reliable identification.',
    },
    name: nullableString('Short listing-style product name including the brand, e.g. "Nike Air Force 1 Low White". Null if not identifiable.'),
    brand: nullableString('Brand or maker, only if visible or unmistakable. Null otherwise.'),
    model: nullableString('Model name or number, only if visible or unmistakable. Null otherwise.'),
    category: nullableString('One general inventory category in Title Case, e.g. "Sneakers", "Electronics", "Clothing", "Trading Cards", "Tools", "Video Games", "Collectibles", "Home Goods".'),
    description: nullableString('One or two plain sentences describing what is visible (type, color, material, notable features). No prices.'),
    condition: {
      type: 'string',
      enum: [...CONDITIONS],
      description: 'Visible condition. Use unknown when the photo does not show enough.',
    },
    condition_notes: nullableString('Visible wear, damage, missing parts or packaging details. Null if none can be seen.'),
    confidence: { type: 'string', enum: [...CONFIDENCES], description: 'Overall confidence in the identification.' },
    notes: nullableString('A brief tip for the person, e.g. what to check or photograph to confirm the model. Null if nothing to add.'),
  },
} as const;

export const SCAN_SYSTEM_PROMPT = `You help people add items to a personal inventory app by describing a single photo of an item.

Rules:
- Describe only what you can see or what is unmistakable from the photo (logos, labels, distinctive design). Never guess a brand, model, edition, size or year you cannot support from the image; use null instead.
- If the photo does not show a recognizable product (blurry, too dark, not an object for sale, several unrelated items), set status to "unrecognized" and leave name, brand and model null.
- Never estimate or mention prices, values, costs, quantities, purchase dates or sales history.
- Do not identify people. If people appear, describe only the item.
- Keep text short and factual, suitable for an inventory record.`;

export const SCAN_USER_PROMPT = 'Describe this item for my inventory.';

export class ScanResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanResultError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Values a model sometimes uses to mean "don't know" instead of null. */
const UNKNOWN_WORDS = new Set(['', 'unknown', 'n/a', 'na', 'none', 'null', 'not visible', 'not applicable', 'unidentified', 'unclear', '-', '—']);

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // Drop control characters and collapse whitespace.
  let text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (UNKNOWN_WORDS.has(text.toLowerCase())) return null;
  if (text.length > max) {
    const cut = text.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    text = `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }
  return text;
}

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * Validates and normalises a scan result from the model (snake_case) or from the backend
 * (camelCase). Unknown keys — including any price or quantity the model might add — are
 * dropped. Missing or wrongly typed fields become null. Throws ScanResultError only when the
 * answer is unusable (not an object, or no valid status).
 */
export function parseScanResult(raw: unknown): ScanResult {
  if (!isObj(raw)) throw new ScanResultError('The AI response was not an object.');
  const status = pick(raw.status, STATUSES);
  if (!status) throw new ScanResultError('The AI response had no valid status.');

  const result: ScanResult = {
    status,
    name: cleanText(raw.name, FIELD_LIMITS.name),
    brand: cleanText(raw.brand, FIELD_LIMITS.brand),
    model: cleanText(raw.model, FIELD_LIMITS.model),
    category: cleanText(raw.category, FIELD_LIMITS.category),
    description: cleanText(raw.description, FIELD_LIMITS.description),
    condition: pick(raw.condition, CONDITIONS) ?? 'unknown',
    conditionNotes: cleanText(raw.condition_notes ?? raw.conditionNotes, FIELD_LIMITS.conditionNotes),
    confidence: pick(raw.confidence, CONFIDENCES) ?? 'low',
    notes: cleanText(raw.notes, FIELD_LIMITS.notes),
  };

  // Keep the status consistent with what was actually returned.
  if (result.status === 'unrecognized') {
    result.name = null;
    result.brand = null;
    result.model = null;
  } else if (!result.name && !result.brand && !result.model && !result.category && !result.description) {
    result.status = 'unrecognized';
  } else if (result.status === 'identified' && !result.name) {
    result.status = 'partial';
  }
  return result;
}

/** Converts a validated result to the snake_case wire shape (used by the backend response). */
export function toWire(result: ScanResult): Record<string, unknown> {
  return {
    status: result.status,
    name: result.name,
    brand: result.brand,
    model: result.model,
    category: result.category,
    description: result.description,
    condition: result.condition,
    condition_notes: result.conditionNotes,
    confidence: result.confidence,
    notes: result.notes,
  };
}
