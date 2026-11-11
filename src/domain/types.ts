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
  /** The marketplace's order number (e.g. eBay "Order number"), used to match payouts. '' when not entered. */
  orderNumber: string;
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

// ---------------------------------------------------------------------------
// Marketplace payout reconciliation. Imported marketplace reports are kept as their own
// records: they never create, change or replace sales. Added without a schema bump; data and
// backups without `marketplace` load with an empty one.
// ---------------------------------------------------------------------------

export type MarketplaceId = 'ebay';

/** What a marketplace transaction is, normalised from the report's own "Type" text. */
export type MarketplaceTxnKind =
  | 'sale'
  | 'refund'
  | 'shipping_label'
  | 'fee'
  | 'claim'
  | 'dispute'
  | 'hold'
  | 'charge'
  | 'adjustment'
  | 'credit'
  | 'payout'
  | 'other';

export interface MarketplaceFee {
  /** Column name as it appears in the report. */
  label: string;
  /** Positive = charged to the seller. */
  amount: number;
}

/**
 * One row of a marketplace transaction report. Amounts are currency units with whole cents,
 * as reported; null when the report didn't include that column. Buyer names and addresses are
 * deliberately not stored.
 */
export interface MarketplaceTxn {
  id: string;
  marketplace: MarketplaceId;
  /** Stable key that recognises this transaction when it appears in a later report. */
  key: string;
  /** Imports that contained this row; the first is where it was first seen. */
  importIds: string[];
  /** The 1-based row number in the first file it came from. */
  sourceRow: number;
  kind: MarketplaceTxnKind;
  /** The report's "Type" text, exactly. */
  rawType: string;
  /** Transaction creation date (YYYY-MM-DD). */
  date: string;
  orderNumber: string;
  legacyOrderId: string;
  /** The marketplace's own transaction ID (eBay: buyer + item + price). */
  transactionRef: string;
  /** eBay "Reference ID": the payment transaction's unique ID. */
  referenceId: string;
  itemId: string;
  title: string;
  /** Seller's SKU ("Custom label"). */
  customLabel: string;
  quantity: number | null;
  description: string;
  /** Amount after fees and credits: what this row adds to (or takes from) the payout. */
  net: number;
  gross: number | null;
  itemSubtotal: number | null;
  shippingAndHandling: number | null;
  sellerCollectedTax: number | null;
  marketplaceCollectedTax: number | null;
  /** Σ fee columns present on the row (null when the export has no fee columns). */
  fees: number | null;
  feeBreakdown: MarketplaceFee[];
  payoutId: string;
  payoutDate: string | null;
  payoutStatus: string;
  holdReason: string;
  currency: string;
  transactionCurrency: string;
}

/** A transfer from the marketplace to the seller's bank (from the payout report). */
export interface MarketplacePayout {
  id: string;
  marketplace: MarketplaceId;
  key: string;
  importIds: string[];
  /** The marketplace's payout reference (eBay "Payout ID"). */
  payoutId: string;
  date: string | null;
  /** Amount actually paid out; null when no report has given it yet. */
  amount: number | null;
  /** Status text exactly as reported (e.g. "Succeeded"). */
  status: string;
  method: string;
  currency: string;
  payoutType: string;
  memo: string;
}

export type MarketplaceReportFormat = 'ebay_transactions' | 'ebay_payouts';

export interface MarketplaceImport {
  id: string;
  marketplace: MarketplaceId;
  format: MarketplaceReportFormat;
  fileName: string;
  /** Fingerprint of the file's contents, to recognise the same file imported twice. */
  fingerprint: string;
  importedAt: string;
  added: number;
  updated: number;
  unchanged: number;
  periodStart: string | null;
  periodEnd: string | null;
}

/** A user-confirmed link between a marketplace sale row and a StockPilot sale. */
export interface SaleMatch {
  id: string;
  txnId: string;
  saleId: string;
  createdAt: string;
}

/**
 * A user's decision about a reconciliation item, with their reason. `amount` is the amount in
 * question when they decided: if it later changes, the decision no longer covers it.
 */
export interface ReconciliationReview {
  id: string;
  /** What was reviewed, e.g. "finding:<payout>:<key>", "payout:<payout>", "adjustment:<txn key>". */
  target: string;
  decision: 'resolved' | 'not_tracked' | 'reviewed';
  reason: string;
  amount: number;
  createdAt: string;
  undoneAt: string | null;
}

export interface ReconciliationEvent {
  id: string;
  date: string;
  action: 'import' | 'match' | 'unmatch' | 'review' | 'undo_review';
  summary: string;
  /** Related payout references, transaction keys, sale ids… */
  refs: string[];
}

export interface MarketplaceData {
  imports: MarketplaceImport[];
  transactions: MarketplaceTxn[];
  payouts: MarketplacePayout[];
  matches: SaleMatch[];
  reviews: ReconciliationReview[];
  log: ReconciliationEvent[];
}

export function emptyMarketplace(): MarketplaceData {
  return { imports: [], transactions: [], payouts: [], matches: [], reviews: [], log: [] };
}

// ---------------------------------------------------------------------------
// Max bid plans: estimates made BEFORE buying a lot. Planning data only: they never count as
// inventory, revenue, expenses or purchases. A plan becomes linked to a real bulk lot only
// when the user records the purchase, and its assumptions are then kept unchanged so a
// later "predicted vs actual" comparison has the original estimate.
// Added without a schema bump; data and backups without bid plans load with none.
// ---------------------------------------------------------------------------

export type BidPlanStatus = 'draft' | 'purchased' | 'passed' | 'lost';
export type BidLotKind = 'storage_unit' | 'pallet' | 'estate_sale' | 'garage_sale' | 'collectibles' | 'retail_lot' | 'other';
export type BidScenarioKey = 'conservative' | 'expected' | 'optimistic';
export type BidShippingMode = 'per_item' | 'percent';

/** One item the user expects in the lot. The resale estimate is always the user's own. */
export interface BidItem {
  id: string;
  name: string;
  quantity: number;
  /** User's estimate of what ONE sells for. null = not estimated yet. */
  unitValue: number | null;
  category: string;
  condition: string;
  notes: string;
  /** Fields last filled by the AI scanner and not edited since (name, category, condition, notes). */
  aiFields: string[];
}

export interface BidScenarioInputs {
  /** Resale values as a % of the user's estimate (100 = as estimated). */
  resalePct: number | null;
  /** % of the resale value expected not to sell (unsellable, damaged, unsold). */
  unsoldPct: number | null;
  /** Marketplace/selling fees as a % of what sells. */
  sellingFeePct: number | null;
}

export interface BidFixedCost {
  id: string;
  label: string;
  amount: number | null;
}

/** Everything the max bid is calculated from. Amounts in currency units, percentages as 0–100. */
export interface BidAssumptions {
  /** One estimate for the whole lot, or a list of items. */
  valueMode: 'total' | 'items';
  totalResaleValue: number | null;
  /** Number of items in the lot when estimating a total (used for per-item shipping). */
  itemCount: number | null;
  items: BidItem[];
  /** Outbound shipping you pay: $ per item sold, or % of what sells. */
  shippingMode: BidShippingMode;
  shippingValue: number | null;
  /** Buying costs that don't depend on the bid: transport, cleanout, storage, entry fees. */
  fixedCosts: BidFixedCost[];
  /** Buyer's premium as a % of the bid. */
  buyerPremiumPct: number | null;
  /** Sales tax on the purchase as a %. */
  salesTaxPct: number | null;
  /** Whether sales tax is also charged on the buyer's premium. */
  taxOnPremium: boolean;
  targetRoiPct: number | null;
  /** Most the user can spend in total (bid + premium + tax + fixed costs). */
  budget: number | null;
  /** A bid the user is considering, to check against the maximum. */
  plannedBid: number | null;
  scenarios: Record<BidScenarioKey, BidScenarioInputs>;
}

/** The headline figures of one scenario, as shown when a decision was recorded. */
export interface BidScenarioSnapshot {
  maxBid: number | null;
  maxAllIn: number;
  expectedSales: number;
  sellingFees: number;
  shipping: number;
  netProceeds: number;
  allInAtMaxBid: number | null;
  profitAtMaxBid: number | null;
  roiAtMaxBidPct: number | null;
}

/** A frozen copy of the plan when the purchase was recorded: what was predicted. */
export interface BidSnapshot {
  takenAt: string;
  assumptions: BidAssumptions;
  /** null for a scenario that couldn't be calculated. */
  results: Record<BidScenarioKey, BidScenarioSnapshot | null>;
  /** The bid recommended at the time (expected scenario, limited by budget). */
  recommendedBid: number | null;
}

export interface BidPurchase {
  lotId: string;
  lotName: string;
  /** created: the lot was made from this plan; linked: an existing lot was attached. */
  how: 'created' | 'linked';
  recordedAt: string;
  purchaseDate: string | null;
  /** What was actually paid for the lot (the winning bid / price). */
  pricePaid: number;
  /** Buyer's premium, tax and other acquisition costs actually recorded on the lot. */
  additionalCosts: number;
  /** Bid items → the inventory items they became (for later predicted vs actual). */
  itemLinks: { bidItemId: string; itemId: string }[];
}

export interface BidStatusChange {
  id: string;
  at: string;
  from: BidPlanStatus;
  to: BidPlanStatus;
  note: string;
}

export interface BidPlan {
  id: string;
  name: string;
  description: string;
  kind: BidLotKind;
  status: BidPlanStatus;
  assumptions: BidAssumptions;
  /** Set when the purchase is recorded; never changed afterwards. */
  snapshot: BidSnapshot | null;
  purchase: BidPurchase | null;
  history: BidStatusChange[];
  duplicatedFromId: string | null;
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
  /** Imported marketplace reports and reconciliation decisions. Missing in older data (loads empty). */
  marketplace: MarketplaceData;
  /** Max bid plans (planning data, never inventory or money). Missing in older data (loads as []). */
  bidPlans: BidPlan[];
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
    marketplace: emptyMarketplace(),
    bidPlans: [],
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
