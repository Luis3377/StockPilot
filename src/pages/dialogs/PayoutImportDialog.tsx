// Import an eBay transaction or payout report. The file is read and previewed on the device;
// nothing is saved until "Import", and importing never creates or changes sales.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileUp, Info } from 'lucide-react';
import { applyImport, importableCount, previewImport, REPORT_ADAPTERS, type ImportPreview } from '../../marketplace/reports';
import { formatDate } from '../../domain/dates';
import { plural } from '../../domain/format';
import { fromCents, toCents } from '../../domain/money';
import { isDomainError } from '../../domain/errors';
import type { MarketplaceTxnKind } from '../../domain/types';
import { store, useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';

export const KIND_LABELS: Record<MarketplaceTxnKind, string> = {
  sale: 'Orders',
  refund: 'Refunds',
  shipping_label: 'Shipping labels',
  fee: 'Fees',
  claim: 'Claims',
  dispute: 'Payment disputes',
  hold: 'Holds',
  charge: 'Charges',
  adjustment: 'Adjustments',
  credit: 'Credits',
  payout: 'Payouts',
  other: 'Other (needs review)',
};

export function PayoutImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { money } = useMoney();
  const toast = useToast();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    setReadError(null);
  }, [open]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setReadError(null);
    if (file.size > 20 * 1024 * 1024) {
      setPreview(null);
      setReadError('That file is over 20 MB. Download a shorter date range from eBay.');
      return;
    }
    try {
      const text = await file.text();
      setPreview(previewImport(text, file.name, store.getState().data));
    } catch {
      setPreview(null);
      setReadError('That file couldn’t be read.');
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  const count = preview && !preview.error && !preview.duplicateOf ? importableCount(preview) : 0;
  const run = () => {
    if (!preview) return;
    try {
      const r = store.commit((d) => applyImport(d, preview));
      toast.success(`Imported ${r.record.fileName}: ${r.record.added} new, ${r.record.updated} updated.`);
      onClose();
      navigate('/sales/payouts');
    } catch (e) {
      if (!isDomainError(e)) throw e;
      setReadError(e.message);
    }
  };

  const report = preview?.report ?? null;
  const appCurrency = useAppState((s) => s.settings.currency);
  const reportCurrencies = [...new Set([...(report?.transactions ?? []).flatMap((t) => [t.currency, t.transactionCurrency]), ...(report?.payouts ?? []).map((p) => p.currency)].filter(Boolean))];
  const otherCurrencies = reportCurrencies.filter((c) => c.toUpperCase() !== appCurrency);
  const byKind = new Map<MarketplaceTxnKind, { n: number; cents: number }>();
  for (const t of preview?.newTxns ?? []) {
    const k = byKind.get(t.kind) ?? { n: 0, cents: 0 };
    byKind.set(t.kind, { n: k.n + 1, cents: k.cents + toCents(t.net) });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import eBay report"
      description="Compare what eBay paid you with the sales you recorded."
      size="lg"
      testId="payout-import"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={run} disabled={count === 0} data-testid="payout-import-run">
            {count > 0 ? `Import ${plural(count, 'record')}` : 'Import'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2 p-5 text-center">
          <FileUp className="mx-auto mb-2 size-6 text-ink-2" aria-hidden />
          <p className="text-sm text-ink-2">
            {preview ? (
              <>
                Selected <strong className="text-ink">{preview.fileName}</strong>
              </>
            ) : (
              'Choose a CSV report downloaded from eBay Seller Hub.'
            )}
          </p>
          <Button variant="primary" className="mt-3" onClick={() => inputRef.current?.click()}>
            {preview ? 'Choose another file' : 'Choose CSV file'}
          </Button>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="eBay report to import" data-testid="payout-file" onChange={(e) => void choose(e.target.files?.[0])} />
        </div>

        {!preview && !readError && (
          <div className="text-sm text-ink-2">
            <p className="font-medium text-ink">Supported reports</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {REPORT_ADAPTERS.flatMap((a) =>
                a.formats.map((f) => (
                  <li key={f.id}>
                    <strong className="text-ink">
                      {a.label} {f.label.toLowerCase()}
                    </strong>
                    : {f.where}
                  </li>
                )),
              )}
            </ul>
            <p className="mt-2">Import both for the same dates: the transaction report says what each payout contained, the payout report what was actually paid. The file stays on this device.</p>
          </div>
        )}

        {readError && (
          <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad-text" role="alert">
            {readError}
          </p>
        )}

        {preview?.error && (
          <div className="rounded-xl bg-bad-soft p-3 text-sm text-bad-text" role="alert" data-testid="payout-import-error">
            <p className="font-medium">{preview.error.problem}</p>
            {report?.rowErrors.length ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                {report.rowErrors.slice(0, 8).map((e) => (
                  <li key={e.rowNumber}>
                    Line {e.rowNumber}: {e.messages.join(' ')}
                  </li>
                ))}
                {report.rowErrors.length > 8 && <li>…and {report.rowErrors.length - 8} more.</li>}
              </ul>
            ) : null}
            {preview.error.found.length > 0 && <p className="mt-2">Columns in this file: {preview.error.found.join(', ')}.</p>}
            {!report && (
              <p className="mt-2">
                Supported: {preview.error.supported.join('; ')}.
              </p>
            )}
          </div>
        )}

        {preview?.duplicateOf && (
          <p className="flex items-start gap-2 rounded-xl bg-warn-soft p-3 text-sm text-warn-text" role="status" data-testid="payout-import-duplicate">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            This file was already imported on {formatDate(preview.duplicateOf.importedAt.slice(0, 10))} (“{preview.duplicateOf.fileName}”). Nothing new to import.
          </p>
        )}

        {report && !preview?.error && !preview?.duplicateOf && (
          <div className="space-y-3" data-testid="payout-import-preview">
            <div className="rounded-2xl bg-surface-2 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-ink">
                <CheckCircle2 className="size-4 text-good-text" aria-hidden /> {report.formatLabel}
                {report.periodStart && <span className="font-normal text-ink-2">{` · ${formatDate(report.periodStart)} – ${formatDate(report.periodEnd)}`}</span>}
              </p>
              {report.format === 'ebay_transactions' ? (
                <ul className="mt-2 space-y-0.5 text-ink-2">
                  <li>
                    <strong className="text-ink">{plural(preview!.newTxns.length, 'new transaction')}</strong>
                  </li>
                  {[...byKind].map(([kind, v]) => (
                    <li key={kind} className="flex justify-between gap-3 pl-3">
                      <span>
                        {KIND_LABELS[kind]}: {v.n}
                      </span>
                      <span className="tabular">{money(fromCents(v.cents))}</span>
                    </li>
                  ))}
                  {preview!.updatedTxns.length > 0 && <li>{plural(preview!.updatedTxns.length, 'transaction')} imported before, now with payout details</li>}
                  {preview!.unchangedTxns > 0 && <li>{plural(preview!.unchangedTxns, 'transaction')} already imported (skipped)</li>}
                </ul>
              ) : (
                <ul className="mt-2 space-y-0.5 text-ink-2">
                  <li>
                    <strong className="text-ink">{plural(preview!.newPayouts.length, 'new payout')}</strong>, totalling{' '}
                    {money(fromCents(preview!.newPayouts.reduce((c, p) => c + toCents(p.amount ?? 0), 0)))}
                  </li>
                  {preview!.updatedPayouts.length > 0 && <li>{plural(preview!.updatedPayouts.length, 'payout')} with a new status or amount</li>}
                  {preview!.unchangedPayouts > 0 && <li>{plural(preview!.unchangedPayouts, 'payout')} already imported (skipped)</li>}
                </ul>
              )}
            </div>
            {preview!.conflictingTxns > 0 && (
              <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn-text">
                {plural(preview!.conflictingTxns, 'transaction')} imported before now {preview!.conflictingTxns === 1 ? 'has' : 'have'} a different amount in this file. The amounts first imported are kept.
              </p>
            )}
            {otherCurrencies.length > 0 && (
              <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn-text" data-testid="payout-import-currency">
                This report has amounts in {otherCurrencies.join(', ')}, but StockPilot is set to {appCurrency}. Amounts are compared exactly as reported, without currency conversion.
              </p>
            )}
            {report.warnings.length > 0 && (
              <ul className="space-y-1 rounded-xl bg-warn-soft p-3 text-sm text-warn-text" data-testid="payout-import-warnings">
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <p className="flex items-start gap-2 text-sm text-ink-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              Importing doesn’t create or change any sales. It only lets StockPilot compare eBay’s numbers with yours.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
