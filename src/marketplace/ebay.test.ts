import { describe, expect, it } from 'vitest';
import { ebayKind, normalizeHeader, parseReportDate } from './ebay';
import { applyImport, fingerprint, importableCount, previewImport } from './reports';
import { addItem, recordSale } from '../domain/actions';
import { emptyData } from '../domain/types';
import { clock } from '../domain/testUtils';

import FEB from './fixtures/ebay-transactions-2026-02.csv?raw';
import MAR from './fixtures/ebay-transactions-2026-03.csv?raw';
import PAYOUTS from './fixtures/ebay-payouts-2026-02.csv?raw';

const HEADER =
  'Transaction creation date,Type,Order number,Net amount,Payout ID,Payout date,Item subtotal,Shipping and handling,Final Value Fee - fixed,Final Value Fee - variable,Reference ID,Custom label';

describe('eBay transaction report', () => {
  it('finds the header under title lines and reads every row', () => {
    const p = previewImport(FEB, 'feb.csv', emptyData());
    expect(p.error).toBeNull();
    expect(p.report!.formatLabel).toBe('eBay transaction report');
    expect(p.report!.transactions).toHaveLength(10);
    expect(p.report!.periodStart).toBe('2026-01-28');
    expect(p.report!.periodEnd).toBe('2026-02-14');
    expect(p.report!.warnings).toEqual([]);
    const kinds = p.report!.transactions.map((t) => t.kind);
    expect(kinds).toEqual(['sale', 'shipping_label', 'sale', 'sale', 'shipping_label', 'fee', 'sale', 'refund', 'sale', 'sale']);
  });

  it('keeps original references and amounts to the cent, and no buyer details', () => {
    const [order] = previewImport(FEB, 'feb.csv', emptyData()).report!.transactions;
    expect(order).toMatchObject({
      date: '2026-01-28',
      rawType: 'Order',
      orderNumber: '11-00001-00001',
      transactionRef: '2100000000001',
      referenceId: '9000000001',
      itemId: '110000000001',
      customLabel: 'SNK-001',
      quantity: 1,
      net: 104.18,
      itemSubtotal: 110,
      shippingAndHandling: 10,
      sellerCollectedTax: 0,
      marketplaceCollectedTax: 9.6,
      gross: 129.6,
      fees: 15.82,
      payoutId: '5000000001',
      payoutDate: '2026-02-02',
      payoutStatus: 'Succeeded',
      sourceRow: 6,
    });
    expect(order.feeBreakdown).toEqual([
      { label: 'Final Value Fee - fixed', amount: 0.4 },
      { label: 'Final Value Fee - variable', amount: 15.42 },
    ]);
    expect(JSON.stringify(order)).not.toMatch(/buyer_a|Test Buyer|Springfield|62701/);
  });

  it('reads "--" as empty and keeps held funds without a payout', () => {
    const held = previewImport(FEB, 'feb.csv', emptyData()).report!.transactions[9];
    expect(held).toMatchObject({ payoutId: '', payoutDate: null, payoutStatus: 'On hold', holdReason: 'Funds are on hold until delivery is confirmed', legacyOrderId: '' });
    const label = previewImport(FEB, 'feb.csv', emptyData()).report!.transactions[1];
    expect(label).toMatchObject({ itemSubtotal: null, quantity: null, title: '', description: 'USPS Ground Advantage label' });
  });

  it('accepts other sites’ column names and date styles', () => {
    const uk = [
      'Transaction creation date,Type,Order ID,Net amount,Payout ID,Postage and packaging,Item subtotal,Final value fee – fixed,Final value fee – variable,Ship/post to city',
      '15/01/2026,Order,22-1,10.00,P1,2.00,9.00,-0.30,-0.70,Leeds',
      '"3 Feb 2026",Refund,22-1,-1.00,P1,--,--,--,--,--',
    ].join('\n');
    const p = previewImport(uk, 'uk.csv', emptyData());
    expect(p.error).toBeNull();
    expect(p.report!.transactions.map((t) => [t.date, t.orderNumber, t.shippingAndHandling, t.fees])).toEqual([
      ['2026-01-15', '22-1', 2, 1],
      ['2026-02-03', '22-1', null, 0],
    ]);
    expect(parseReportDate('2026-01-15T10:22:01.000Z')).toBe('2026-01-15');
    expect(parseReportDate('January 5, 2026 10:21 PM PST')).toBe('2026-01-05');
    expect(parseReportDate('05-Jan-26')).toBe('2026-01-05');
    expect(parseReportDate('03/04/2026')).toBe('2026-03-04');
    expect(parseReportDate('03/04/2026', 'dmy')).toBe('2026-04-03');
    expect(parseReportDate('Feb 30, 2026')).toBeNull();
    expect(normalizeHeader('Very high "item not as described" fee')).toBe('very high item not as described fee');
  });

  it('says what’s missing when optional columns are left out of the export', () => {
    const p = previewImport('Transaction creation date,Type,Net amount\n2026-01-02,Order,5.00', 'min.csv', emptyData());
    expect(p.error).toBeNull();
    expect(p.report!.warnings.join(' ')).toMatch(/no "Payout ID" column/);
    expect(p.report!.warnings.join(' ')).toMatch(/no fee columns/);
    expect(p.report!.warnings.join(' ')).toMatch(/no "Order number" column/);
  });

  it('maps eBay Type text, keeping unknown types for review', () => {
    expect(['Order', 'Refund', 'Shipping label', 'Other fee', 'Claim', 'Payment dispute', 'Hold', 'Charge', 'Adjustment', 'Payout', 'Something new'].map(ebayKind)).toEqual([
      'sale',
      'refund',
      'shipping_label',
      'fee',
      'claim',
      'dispute',
      'hold',
      'charge',
      'adjustment',
      'payout',
      'other',
    ]);
  });

  it('gives identical rows in one file different keys, and the same row in two files the same key', () => {
    const csv = `${HEADER}\n2026-01-02,Other fee,,-1.00,P1,2026-01-05,,,,,,\n2026-01-02,Other fee,,-1.00,P1,2026-01-05,,,,,,`;
    const keys = previewImport(csv, 'a.csv', emptyData()).report!.transactions.map((t) => t.key);
    expect(new Set(keys).size).toBe(2);
    const febHeld = previewImport(FEB, 'feb.csv', emptyData()).report!.transactions[9];
    const marHeld = previewImport(MAR, 'mar.csv', emptyData()).report!.transactions[0];
    expect(marHeld.key).toBe(febHeld.key);
  });
});

describe('eBay payout report', () => {
  it('reads the payouts under the summary and checks the summary totals', () => {
    const p = previewImport(PAYOUTS, 'payouts.csv', emptyData());
    expect(p.error).toBeNull();
    expect(p.report!.formatLabel).toBe('eBay payout report');
    expect(p.report!.warnings).toEqual([]);
    expect(p.report!.payouts.map((x) => [x.payoutId, x.date, x.amount, x.status])).toEqual([
      ['5000000001', '2026-02-02', 250.48, 'Succeeded'],
      ['5000000002', '2026-02-09', 77.82, 'Succeeded'],
      ['5000000003', '2026-02-16', 31.25, 'Initiated'],
      ['5000000004', '2026-03-02', 61.63, 'Succeeded'],
    ]);
    const changed = PAYOUTS.replace('421.18', '400.00');
    expect(previewImport(changed, 'payouts.csv', emptyData()).report!.warnings).toEqual(['The report’s summary total is 400.00, but its payouts add up to 421.18.']);
  });
});

describe('unsupported and broken files', () => {
  it('explains unsupported files and lists the supported reports', () => {
    const p = previewImport('Item Name,SKU,Qty\nMug,M1,2', 'inventory.csv', emptyData());
    expect(p.error!.problem).toMatch(/doesn’t recognise this file/);
    expect(p.error!.found).toEqual(['Item Name', 'SKU', 'Qty']);
    expect(p.error!.supported.join(' ')).toMatch(/eBay transaction report.*eBay payout report/);
    expect(previewImport('', 'empty.csv', emptyData()).error!.problem).toBe('The file is empty.');
  });

  it('names the missing required columns', () => {
    const p = previewImport('Type,Net amount,Order number\nOrder,5,1', 'x.csv', emptyData());
    expect(p.error!.problem).toMatch(/missing a column StockPilot needs: Transaction creation date/);
    expect(p.error!.missing).toEqual(['Transaction creation date']);
  });

  it('refuses a file with unreadable rows instead of importing part of it', () => {
    const p = previewImport(`${HEADER}\n2026-01-02,Order,1,abc,P1,,,,,,,\nnot a date,Order,2,5.00,P1,,,,,,,`, 'bad.csv', emptyData());
    expect(p.error!.problem).toMatch(/2 rows couldn’t be read, so nothing will be imported/);
    expect(p.report!.rowErrors.map((e) => e.rowNumber)).toEqual([2, 3]);
    expect(p.report!.rowErrors[0].messages[0]).toMatch(/"Net amount" “abc” isn’t an amount/);
    expect(() => applyImport(emptyData(), p)).toThrow(/couldn’t be read/);
  });
});

describe('importing', () => {
  it('previews before saving, then saves exactly what was previewed', () => {
    const data = emptyData();
    const p = previewImport(FEB, 'feb.csv', data);
    expect(importableCount(p)).toBe(10);
    expect(data.marketplace.transactions).toHaveLength(0);
    const r = applyImport(data, p, clock());
    expect(r.data.marketplace.transactions).toHaveLength(10);
    expect(r.record).toMatchObject({ fileName: 'feb.csv', added: 10, updated: 0, unchanged: 0, periodStart: '2026-01-28', periodEnd: '2026-02-14' });
    expect(r.data.marketplace.transactions.every((t) => t.importIds[0] === r.record.id)).toBe(true);
    expect(r.data.marketplace.log.at(-1)!.summary).toMatch(/Imported eBay transaction report “feb.csv”: 10 new/);
  });

  it('recognises a file imported before', () => {
    const first = applyImport(emptyData(), previewImport(FEB, 'feb.csv', emptyData()), clock()).data;
    const again = previewImport(FEB.replace(/\r\n/g, '\n'), 'feb (1).csv', first);
    expect(again.duplicateOf?.fileName).toBe('feb.csv');
    expect(again.unchangedTxns).toBe(10);
    expect(() => applyImport(first, again)).toThrow(/already imported on 2026-10-28/);
    expect(fingerprint(FEB)).toBe(fingerprint(`﻿${FEB.replace(/\r\n/g, '\n')}`));
  });

  it('fills in payout details for transactions that were waiting, without touching the original', () => {
    const feb = applyImport(emptyData(), previewImport(FEB, 'feb.csv', emptyData()), clock()).data;
    const p = previewImport(MAR, 'mar.csv', feb);
    expect(p.newTxns).toHaveLength(1);
    expect(p.updatedTxns.map((u) => u.changes)).toEqual([['payout ID', 'payout date', 'payout status', 'hold reason']]);
    const r = applyImport(feb, p, clock());
    const held = r.data.marketplace.transactions.find((t) => t.orderNumber === '11-00006-00006')!;
    expect(held).toMatchObject({ payoutId: '5000000004', payoutDate: '2026-03-02', payoutStatus: 'Succeeded', holdReason: '', net: 31.7, sourceRow: 15 });
    expect(held.importIds).toHaveLength(2);
    expect(r.data.marketplace.transactions).toHaveLength(11);
  });

  it('keeps the first amounts if a later file disagrees, and says so', () => {
    const feb = applyImport(emptyData(), previewImport(FEB, 'feb.csv', emptyData()), clock()).data;
    const p = previewImport(MAR.replace(',31.70,', ',30.00,'), 'mar.csv', feb);
    expect(p.conflictingTxns).toBe(1);
    const r = applyImport(feb, p, clock());
    expect(r.data.marketplace.transactions.find((t) => t.orderNumber === '11-00006-00006')!.net).toBe(31.7);
  });

  it('updates a payout whose status changed, and never touches sales', () => {
    let { data, item } = addItem(emptyData(), { name: 'Mug', quantity: 2, unitCost: 3 }, clock());
    data = recordSale(data, { itemId: item.id, quantity: 1, salePrice: 10, priceMode: 'per_unit', saleDate: '2026-02-01', orderNumber: '11-00001-00001' }, clock()).data;
    const before = JSON.stringify({ sales: data.sales, items: data.items });
    data = applyImport(data, previewImport(PAYOUTS, 'payouts.csv', data), clock()).data;
    const later = PAYOUTS.replace('Initiated', 'Succeeded');
    const p = previewImport(later, 'payouts-later.csv', data);
    expect(p.updatedPayouts.map((u) => [u.existing.payoutId, u.changes])).toEqual([['5000000003', ['status']]]);
    data = applyImport(data, p, clock()).data;
    expect(data.marketplace.payouts.find((x) => x.payoutId === '5000000003')!.status).toBe('Succeeded');
    expect(JSON.stringify({ sales: data.sales, items: data.items })).toBe(before);
  });
});
