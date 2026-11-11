// Core data model. Every mode (reseller, collector, small business) reads and writes
// these same records — modes only change which views and metrics are emphasised.

export type UserMode = 'reseller' | 'collector' | 'business';
export type DatasetId = 'real' | 'demo';
export type ThemePreference = 'system' | 'light' | 'dark';

/** A dated per-unit estimated value, used to chart how an item's worth changes. */
export interface ValuePoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface Item {
  id: string;
  name: string;
  sku: string;
  category: string;
  /** Units currently on hand. Always a whole number >= 0. */
  quantity: number;
  /** Acquisition cost per unit. */
  unitCost: number;
  /** Price per unit the user intends to sell at. */
  askingPrice: number | null;
  /** Estimated current market value per unit. */
  estimatedValue: number | null;
  purchaseDate: string | null; // YYYY-MM-DD
  condition: string;
  location: string;
  /** Alert when quantity is at or below this number. null = no alert. */
  lowStockThreshold: number | null;
  photoIds: string[];
  notes: string;
  valueHistory: ValuePoint[];
  createdAt: string; // ISO timestamp
  updatedAt: string;
}

/** Whether the entered sale price is per unit or the total for all units sold. */
export type PriceMode = 'per_unit' | 'total';

export interface Sale {
  id: string;
  itemId: string;
  /** Snapshots keep sale history readable even if the item is later renamed or deleted. */
  itemName: string;
  itemSku: string;
  itemCategory: string;
  quantity: number;
  salePrice: number;
  priceMode: PriceMode;
  /** Unit acquisition cost captured when the sale was recorded (used for cost of goods sold). */
  unitCost: number;
  platform: string;
  /** Marketplace / payment fees, total for this sale. */
  fees: number;
  /** Shipping paid by the seller, total for this sale. */
  shipping: number;
  /** Any other expense tied to this sale (packaging, promotion, etc.). */
  otherExpenses: number;
  saleDate: string; // YYYY-MM-DD
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type AdjustmentSource = 'count_check' | 'manual' | 'edit' | 'restock' | 'import';

/** A recorded change to an item's quantity that did not come from a sale. */
export interface Adjustment {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string;
  previousQuantity: number;
  newQuantity: number;
  difference: number;
  unitCost: number;
  valueDifference: number;
  reason: string;
  source: AdjustmentSource;
  countId: string | null;
  date: string; // ISO timestamp
}

export interface CountScope {
  category: string | null;
  location: string | null;
}

/**
 * An in-progress physical count, which may span several sessions. Counts are compared against
 * live recorded quantities; when an item's stock changes after it was counted (a sale, a
 * restock), the row is flagged so the user can recount rather than see a false difference.
 */
export interface CountDraft {
  id: string;
  startedAt: string;
  scope: CountScope;
  /** itemId -> physically counted quantity. Items without an entry are "not counted yet". */
  counts: Record<string, number>;
  /**
   * itemId -> recorded quantity at the moment the item was counted. Empty for drafts saved
   * before this existed, which simply aren't flagged.
   */
  recordedAtCount: Record<string, number>;
}

export type CountLineStatus = 'match' | 'missing' | 'excess';

export interface CountLine {
  itemId: string;
  itemName: string;
  itemSku: string;
  recordedQuantity: number;
  countedQuantity: number;
  difference: number;
  unitCost: number;
  valueDifference: number;
  status: CountLineStatus;
  applied: boolean;
  reason: string;
}

export interface CountRecord {
  id: string;
  startedAt: string;
  completedAt: string;
  scope: CountScope;
  lines: CountLine[];
}

/** One point per day of total inventory value, used for value-over-time charts. */
export interface ValueSnapshot {
  date: string; // YYYY-MM-DD
  units: number;
  cost: number;
  /** Estimated value, with items lacking an estimate counted at cost. */
  value: number;
}

// ---------------------------------------------------------------------------
// Bulk lots: several items bought together for one price, with the cost split across them.
// Each lot item is an ordinary Item (with its share of the cost as unitCost); the lot keeps
// the purchase, how the cost was split, and a history of changes. Added without a schema
// bump: data and backups without `lots` load with an empty list.
// ---------------------------------------------------------------------------

/** How a lot's cost is split: by each item's estimated resale value, or equally per unit. */
export type LotAllocationMethod = 'relative_value' | 'equal';

/**
 * Where an estimated resale value came from. Only the user's own estimate exists today; AI
 * identification never sets a price. A future market-price lookup would add a value here.
 */
export type EstimateSource = 'user';

export interface LotExtraCost {
  id: string;
  /** e.g. "Shipping / freight", "Buyer's premium". */
  label: string;
  amount: number;
}

export interface LotLine {
  id: string;
  /** The inventory record created for this line. It may later be deleted; the line stays. */
  itemId: string;
  /** Name when the lot was saved, so the lot stays readable if the item is deleted. */
  itemName: string;
  /** Units bought in the lot. */
  quantity: number;
  /** Estimated resale value per unit used to split the cost (null when not given). */
  estimatedUnitValue: number | null;
  estimateSource: EstimateSource;
  /**
   * Total cost assigned to this line's units, in currency units with whole cents. Across all
   * lines this always adds up to the lot's purchase price + extra costs exactly.
   */
  allocatedCost: number;
}

export interface LotLineChange {
  lineId: string;
  itemId: string;
  itemName: string;
  /** Units on hand that the change applied to. */
  unitsAffected: number;
  previousUnitCost: number;
  newUnitCost: number;
  previousRemainingCost: number;
  newRemainingCost: number;
  previousEstimate: number | null;
  newEstimate: number | null;
}

export interface LotChange {
  id: string;
  date: string; // ISO timestamp
  kind: 'created' | 'costs' | 'details';
  /** Which lot fields changed (e.g. "purchasePrice", "estimates", "name"). */
  changedFields: string[];
  /** The user's reason, if they gave one. */
  note: string;
  previousTotal: number;
  newTotal: number;
  previousMethod: LotAllocationMethod;
  newMethod: LotAllocationMethod;
  /** Cost already in completed sales or written off when the change was made (never changed). */
  lockedCost: number;
  lines: LotLineChange[];
}

export interface Lot {
  id: string;
  name: string;
  /** What was paid for the lot itself. */
  purchasePrice: number;
  /** Freight, buyer's premium and other costs of acquiring the lot. Part of its cost. */
  extraCosts: LotExtraCost[];
  purchaseDate: string | null; // YYYY-MM-DD
  /** Where it was bought (auction, estate sale, wholesaler…). */
  source: string;
  notes: string;
  method: LotAllocationMethod;
  lines: LotLine[];
  history: LotChange[];
  createdAt: string;
  updatedAt: string;
}

export interface AppData {
  schemaVersion: 1;
  items: Item[];
  sales: Sale[];
  adjustments: Adjustment[];
  countDraft: CountDraft | null;
  countHistory: CountRecord[];
  snapshots: ValueSnapshot[];
  /** Bulk lots. Missing in data saved before lots existed (loads as []). */
  lots: Lot[];
}

export interface Settings {
  onboarded: boolean;
  mode: UserMode;
  theme: ThemePreference;
  currency: string;
  /** Pre-filled low-stock alert level for new items (null = none). */
  defaultLowStockThreshold: number | null;
  /** Items unsold for at least this many days are "slow-moving". */
  slowMovingDays: number;
  /** Sales or prices below this margin percentage are flagged. */
  lowMarginPercent: number;
  /** Selling costs as % of price for projections. null = learn from recorded sales. */
  sellingCostPercent: number | null;
  /** Collectors can opt in to sales & profit tracking. */
  collectorSalesEnabled: boolean;
  demoActive: boolean;
  lastBackupAt: string | null;
  inventoryView: 'grid' | 'list';
}

export interface PhotoRecord {
  id: string;
  dataset: DatasetId;
  /** JPEG data URL, max ~1600px. */
  full: string;
  /** JPEG data URL, max ~400px, for lists. */
  thumb: string;
  createdAt: string;
}

export function emptyData(): AppData {
  return {
    schemaVersion: 1,
    items: [],
    sales: [],
    adjustments: [],
    countDraft: null,
    countHistory: [],
    snapshots: [],
    lots: [],
  };
}

export function defaultSettings(): Settings {
  return {
    onboarded: false,
    mode: 'reseller',
    theme: 'system',
    currency: 'USD',
    defaultLowStockThreshold: null,
    slowMovingDays: 60,
    lowMarginPercent: 15,
    sellingCostPercent: null,
    collectorSalesEnabled: false,
    demoActive: false,
    lastBackupAt: null,
    inventoryView: 'grid',
  };
}
