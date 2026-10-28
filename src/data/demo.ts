// Clearly-labelled sample inventory for Demo mode. It lives in its own dataset, so exploring
// the demo never mixes with (or overwrites) the user's real records.

import { addItem, completeCount, recordSale, setCount, startCount, upsertSnapshot, type ItemInput } from '../domain/actions';
import { addDays, todayISO } from '../domain/dates';
import { roundMoney } from '../domain/money';
import { emptyData, type AppData, type ValueSnapshot } from '../domain/types';

interface DemoItem extends ItemInput {
  ageDays: number;
  sales?: { daysAgo: number; qty: number; price: number; platform: string; fees: number; shipping?: number; other?: number }[];
}

const SAMPLE_NOTE = 'Sample item (demo data).';

const ITEMS: DemoItem[] = [
  // Sneakers
  { name: 'Nike Dunk Low "Panda" — Size 10', category: 'Sneakers', quantity: 2, unitCost: 85, askingPrice: 135, estimatedValue: 128, condition: 'New with box', location: 'Closet shelf A', ageDays: 48,
    sales: [{ daysAgo: 20, qty: 1, price: 132, platform: 'eBay', fees: 17.49, shipping: 14.2 }] },
  { name: 'Air Jordan 1 High OG "Lost & Found" — Size 9.5', category: 'Sneakers', quantity: 1, unitCost: 180, askingPrice: 340, estimatedValue: 355, condition: 'New with box', location: 'Closet shelf A', ageDays: 75 },
  { name: 'New Balance 550 White/Green — Size 11', category: 'Sneakers', quantity: 3, unitCost: 70, askingPrice: 115, estimatedValue: 104, condition: 'New with box', location: 'Closet shelf B', ageDays: 96,
    sales: [{ daysAgo: 61, qty: 1, price: 118, platform: 'StockX', fees: 11.8, shipping: 0 }] },
  { name: 'Adidas Samba OG Black — Size 8', category: 'Sneakers', quantity: 2, unitCost: 62, askingPrice: 98, condition: 'New with box', location: 'Closet shelf B', ageDays: 140,
    sales: [{ daysAgo: 110, qty: 1, price: 105, platform: 'Mercari', fees: 10.5, shipping: 9.5 }, { daysAgo: 12, qty: 1, price: 95, platform: 'eBay', fees: 12.59, shipping: 13.1 }] },
  { name: 'Yeezy Boost 350 V2 "Bone" — Size 10.5', category: 'Sneakers', quantity: 2, unitCost: 230, askingPrice: 215, estimatedValue: 198, condition: 'New with box', location: 'Closet shelf A', ageDays: 205,
    sales: [{ daysAgo: 150, qty: 1, price: 220, platform: 'StockX', fees: 22, shipping: 0 }] },
  { name: 'Travis Scott x Jordan 1 Low "Mocha" — Size 9', category: 'Sneakers', quantity: 1, unitCost: 610, askingPrice: 980, condition: 'New with box', location: 'Closet shelf A', ageDays: 230,
    sales: [{ daysAgo: 190, qty: 1, price: 1015, platform: 'StockX', fees: 101.5, shipping: 0 }] },
  // Trading cards
  { name: 'Charizard ex 199/165 SIR (PSA 10)', category: 'Trading Cards', quantity: 1, unitCost: 210, askingPrice: 300, estimatedValue: 288, condition: 'Graded PSA 10', location: 'Card safe', ageDays: 160 },
  { name: 'Umbreon VMAX Alt Art 215/203 (Raw NM)', category: 'Trading Cards', quantity: 1, unitCost: 520, estimatedValue: 640, condition: 'Near mint', location: 'Card safe', ageDays: 300 },
  { name: '2018 Topps Update Shohei Ohtani RC #US1', category: 'Trading Cards', quantity: 3, unitCost: 40, askingPrice: 70, estimatedValue: 66, condition: 'Near mint', location: 'Card binder 2', ageDays: 88,
    sales: [{ daysAgo: 33, qty: 1, price: 72, platform: 'eBay', fees: 9.54, shipping: 1.5 }] },
  { name: 'Pokémon 151 Booster Bundle (Sealed)', category: 'Trading Cards', quantity: 6, unitCost: 26, askingPrice: 38, estimatedValue: 36, condition: 'Sealed', location: 'Card binder 2', lowStockThreshold: 3, ageDays: 70,
    sales: [{ daysAgo: 40, qty: 2, price: 39, platform: 'Facebook Marketplace', fees: 0 }, { daysAgo: 9, qty: 2, price: 37, platform: 'In person', fees: 0 }] },
  { name: 'MTG Ragavan, Nimble Pilferer (MH2)', category: 'Trading Cards', quantity: 1, unitCost: 55, askingPrice: 58, estimatedValue: 44, condition: 'Lightly played', location: 'Card binder 2', ageDays: 180 },
  // Electronics
  { name: 'Nintendo Switch OLED — White', category: 'Electronics', quantity: 1, unitCost: 190, askingPrice: 260, estimatedValue: 245, condition: 'Used — excellent', location: 'Office closet', ageDays: 35 },
  { name: 'Apple AirPods Pro (2nd gen)', category: 'Electronics', quantity: 3, unitCost: 150, askingPrice: 199, estimatedValue: 189, condition: 'Sealed', location: 'Office closet', ageDays: 55,
    sales: [{ daysAgo: 44, qty: 1, price: 189, platform: 'eBay', fees: 25.05, shipping: 9.8 }, { daysAgo: 5, qty: 1, price: 195, platform: 'Facebook Marketplace', fees: 0 }] },
  { name: 'Sony WH-1000XM4 Headphones', category: 'Electronics', quantity: 1, unitCost: 120, askingPrice: 165, condition: 'Used — good', location: 'Office closet', ageDays: 150 },
  { name: 'GoPro HERO11 Black', category: 'Electronics', quantity: 1, unitCost: 210, askingPrice: 229, condition: 'Open box', location: 'Office closet', ageDays: 64 },
  // Video games
  { name: 'Zelda: Ocarina of Time (N64, cart only)', category: 'Video Games', quantity: 2, unitCost: 22, askingPrice: 42, estimatedValue: 38, condition: 'Good', location: 'Game shelf', ageDays: 120,
    sales: [{ daysAgo: 80, qty: 1, price: 45, platform: 'eBay', fees: 5.96, shipping: 5.2 }] },
  { name: 'Pokémon Emerald (GBA, authentic)', category: 'Video Games', quantity: 1, unitCost: 95, askingPrice: 175, estimatedValue: 162, condition: 'Very good', location: 'Game shelf', ageDays: 25 },
  { name: 'EarthBound (SNES, complete in box)', category: 'Video Games', quantity: 1, unitCost: 260, estimatedValue: 425, condition: 'Very good', location: 'Display cabinet', ageDays: 410 },
  // Vintage apparel
  { name: "Vintage Levi's 501 — W32 L30", category: 'Vintage Apparel', quantity: 3, unitCost: 18, askingPrice: 55, condition: 'Pre-owned', location: 'Garage rack', ageDays: 100,
    sales: [{ daysAgo: 70, qty: 1, price: 52, platform: 'Poshmark', fees: 10.4, shipping: 0 }, { daysAgo: 27, qty: 1, price: 58, platform: 'Depop', fees: 5.8, shipping: 7.5 }] },
  { name: 'Patagonia Synchilla Fleece — M', category: 'Vintage Apparel', quantity: 1, unitCost: 25, askingPrice: 85, condition: 'Pre-owned', location: 'Garage rack', ageDays: 15 },
  { name: 'Carhartt Detroit Jacket — L', category: 'Vintage Apparel', quantity: 1, unitCost: 60, askingPrice: 145, condition: 'Pre-owned', location: 'Garage rack', ageDays: 130,
    sales: [{ daysAgo: 95, qty: 1, price: 150, platform: 'eBay', fees: 19.88, shipping: 15.4 }] },
  { name: 'Grateful Dead 1993 Tour Tee — XL', category: 'Vintage Apparel', quantity: 1, unitCost: 40, askingPrice: 44, condition: 'Pre-owned', location: 'Garage rack', ageDays: 90,
    sales: [{ daysAgo: 58, qty: 1, price: 46, platform: 'Poshmark', fees: 9.2, shipping: 0, other: 3 }] },
  // Small-business stock (handmade candles)
  { name: 'Soy Candle — Lavender 8oz', category: 'Candles', quantity: 30, unitCost: 4.1, askingPrice: 18, condition: 'New', location: 'Workshop shelf 1', lowStockThreshold: 10, ageDays: 200,
    sales: [{ daysAgo: 160, qty: 4, price: 18, platform: 'Etsy', fees: 7.92, shipping: 0 }, { daysAgo: 120, qty: 5, price: 18, platform: 'Craft fair', fees: 0, other: 6 }, { daysAgo: 62, qty: 6, price: 18, platform: 'Etsy', fees: 11.88 }, { daysAgo: 14, qty: 9, price: 16, platform: 'Shopify', fees: 7.2 }] },
  { name: 'Soy Candle — Vanilla Bean 8oz', category: 'Candles', quantity: 40, unitCost: 4.1, askingPrice: 18, condition: 'New', location: 'Workshop shelf 1', lowStockThreshold: 10, ageDays: 200,
    sales: [{ daysAgo: 150, qty: 3, price: 18, platform: 'Etsy', fees: 5.94 }, { daysAgo: 85, qty: 6, price: 18, platform: 'Craft fair', fees: 0, other: 6 }, { daysAgo: 30, qty: 4, price: 18, platform: 'Shopify', fees: 3.6 }, { daysAgo: 3, qty: 5, price: 18, platform: 'Etsy', fees: 9.9 }] },
  { name: 'Soy Candle — Cedar & Sage 8oz', category: 'Candles', quantity: 20, unitCost: 4.4, askingPrice: 18, condition: 'New', location: 'Workshop shelf 1', lowStockThreshold: 8, ageDays: 180,
    sales: [{ daysAgo: 140, qty: 8, price: 18, platform: 'Craft fair', fees: 0, other: 6 }, { daysAgo: 66, qty: 7, price: 18, platform: 'Etsy', fees: 13.86 }, { daysAgo: 18, qty: 5, price: 18, platform: 'Shopify', fees: 4.5 }] },
  { name: 'Wax Melts — Assorted 6-pack', category: 'Candles', quantity: 60, unitCost: 2.25, askingPrice: 9, condition: 'New', location: 'Workshop shelf 2', lowStockThreshold: 12, ageDays: 170,
    sales: [{ daysAgo: 130, qty: 10, price: 9, platform: 'Craft fair', fees: 0 }, { daysAgo: 45, qty: 8, price: 8, platform: 'Etsy', fees: 6.4 }, { daysAgo: 7, qty: 6, price: 9, platform: 'Shopify', fees: 2.7 }] },
  { name: 'Candle Gift Box (3 × 4oz)', category: 'Candles', quantity: 12, unitCost: 13.5, askingPrice: 48, condition: 'New', location: 'Workshop shelf 2', lowStockThreshold: 5, ageDays: 95,
    sales: [{ daysAgo: 60, qty: 3, price: 48, platform: 'Etsy', fees: 9.5, shipping: 21 }, { daysAgo: 22, qty: 5, price: 45, platform: 'Shopify', fees: 7.1, shipping: 18 }] },
  { name: 'Reed Diffuser — Eucalyptus 4oz', category: 'Home Fragrance', quantity: 9, unitCost: 5.75, askingPrice: 22, condition: 'New', location: 'Workshop shelf 2', lowStockThreshold: 6, ageDays: 40 },
  { name: 'Room Spray — Citrus Grove 4oz', category: 'Home Fragrance', quantity: 18, unitCost: 3.2, askingPrice: 6, condition: 'New', location: 'Workshop shelf 2', lowStockThreshold: 5, ageDays: 110,
    sales: [{ daysAgo: 50, qty: 4, price: 6, platform: 'Craft fair', fees: 0, other: 2 }] },
];

function iso(date: string): Date {
  return new Date(`${date}T15:00:00`);
}

/** Builds the full demo dataset relative to `today` so dates always look recent. */
export function buildDemoData(today: string = todayISO()): AppData {
  let data = emptyData();
  const ids: string[] = [];
  for (const def of ITEMS) {
    const { ageDays, sales, ...input } = def;
    const purchaseDate = addDays(today, -ageDays);
    const r = addItem(data, { ...input, purchaseDate, notes: SAMPLE_NOTE }, { now: iso(purchaseDate) });
    data = r.data;
    ids.push(r.item.id);
    for (const s of [...(sales ?? [])].sort((a, b) => b.daysAgo - a.daysAgo)) {
      const saleDate = addDays(today, -s.daysAgo);
      data = recordSale(
        data,
        {
          itemId: r.item.id,
          quantity: s.qty,
          salePrice: s.price,
          priceMode: 'per_unit',
          platform: s.platform,
          fees: s.fees,
          shipping: s.shipping ?? 0,
          otherExpenses: s.other ?? 0,
          saleDate,
        },
        { now: iso(saleDate) },
      ).data;
    }
  }

  // A completed Count Check from two weeks ago with one approved shortage.
  const countDay = iso(addDays(today, -14));
  const workshop = data.items.filter((i) => i.location.startsWith('Workshop'));
  data = startCount(data, { category: null, location: 'Workshop shelf 2' }, { now: countDay });
  for (const item of workshop.filter((i) => i.location === 'Workshop shelf 2')) {
    data = setCount(data, item.id, item.name.startsWith('Wax Melts') ? item.quantity - 2 : item.quantity);
  }
  const melts = data.items.find((i) => i.name.startsWith('Wax Melts'))!;
  data = completeCount(data, [{ itemId: melts.id, apply: true, reason: 'Damaged in storage (melted)' }], { now: countDay }).data;

  // Synthesised value history so value-over-time charts have shape on day one.
  data = upsertSnapshot(data, today);
  const current = data.snapshots[data.snapshots.length - 1];
  const history: ValueSnapshot[] = [];
  for (let w = 26; w >= 1; w--) {
    const factor = 1 - w * 0.009 + Math.sin(w / 2.5) * 0.012;
    history.push({
      date: addDays(today, -w * 7),
      units: current.units,
      cost: current.cost,
      value: roundMoney(current.value * factor),
    });
  }
  data = { ...data, snapshots: [...history, current] };
  return data;
}
