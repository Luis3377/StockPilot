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

/** An in-progress physical count. Counts are compared against live recorded quantities. */
export interface CountDraft {
  id: string;
  startedAt: string;
  scope: CountScope;
  /** itemId -> physically counted quantity. Items without an entry are "not counted yet". */
  counts: Record<string, number>;
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

export interface AppData {
  schemaVersion: 1;
  items: Item[];
  sales: Sale[];
  adjustments: Adjustment[];
  countDraft: CountDraft | null;
  countHistory: CountRecord[];
  snapshots: ValueSnapshot[];
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
