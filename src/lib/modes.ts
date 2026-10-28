import type { Settings, UserMode } from '../domain/types';

export interface ModeInfo {
  id: UserMode;
  name: string;
  tagline: string;
  features: string[];
}

export const MODES: ModeInfo[] = [
  {
    id: 'reseller',
    name: 'Reseller',
    tagline: 'I buy items and resell them on eBay, Marketplace, Poshmark and more.',
    features: ['Profit after fees & shipping', 'What’s unsold and for how long', 'Best items & categories'],
  },
  {
    id: 'collector',
    name: 'Collector',
    tagline: 'I collect sneakers, cards, games, memorabilia or other valuables.',
    features: ['A photo catalog of your collection', 'What it cost vs. what it’s worth', 'Value changes over time'],
  },
  {
    id: 'business',
    name: 'Small business',
    tagline: 'I run a small or side business with products in stock.',
    features: ['Stock levels & low-stock alerts', 'Sales and product profitability', 'Physical count vs. records'],
  },
];

export function modeInfo(mode: UserMode): ModeInfo {
  return MODES.find((m) => m.id === mode)!;
}

/** Collectors opt in to selling; the other modes always track sales. */
export function salesEnabled(settings: Pick<Settings, 'mode' | 'collectorSalesEnabled'>): boolean {
  return settings.mode !== 'collector' || settings.collectorSalesEnabled;
}

export const PLATFORM_SUGGESTIONS = [
  'eBay', 'Facebook Marketplace', 'Poshmark', 'Mercari', 'Depop', 'Etsy', 'StockX', 'GOAT', 'Amazon',
  'Shopify', 'OfferUp', 'Whatnot', 'TCGplayer', 'Craft fair', 'In person',
];

export const CONDITION_SUGGESTIONS = [
  'New', 'New with box', 'New with tags', 'Sealed', 'Like new', 'Open box', 'Used — excellent', 'Used — good',
  'Used — fair', 'Pre-owned', 'Graded', 'For parts',
];

export const CURRENCIES = [
  { code: 'USD', label: 'US dollar ($)' },
  { code: 'CAD', label: 'Canadian dollar ($)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'GBP', label: 'British pound (£)' },
  { code: 'AUD', label: 'Australian dollar ($)' },
  { code: 'MXN', label: 'Mexican peso ($)' },
  { code: 'JPY', label: 'Japanese yen (¥)' },
];
