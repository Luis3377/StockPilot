import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileUp, AlertTriangle, Download } from 'lucide-react';
import { applyInventoryImport, importTemplateCsv, previewInventoryImport, type DuplicateHandling, type ImportPreview } from '../../csv/inventoryImport';
import { store, useAppState } from '../../data/store';
import { downloadText, readFileText } from '../../lib/download';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Fields';
import { useToast } from '../../ui/Toast';

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const data = useAppState((s) => s.data);
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [handling, setHandling] = useState<DuplicateHandling>('skip');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFileName('');
      setText(null);
      setHandling('skip');
      setError(null);
    }
  }, [open]);

  const preview: ImportPreview | null = text === null ? null : previewInventoryImport(text, data);
  const duplicates = preview?.rows.filter((r) => r.duplicateOf).length ?? 0;
  const fresh = (preview?.rows.length ?? 0) - duplicates;
  const willImport = fresh + (handling === 'update' ? duplicates : 0);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > 10 * 1024 * 1024) {
      setError('That file is over 10 MB. Split it into smaller files.');
      return;
    }
    try {
      setText(await readFileText(file));
      setFileName(file.name);
    } catch {
      setError('The file could not be read.');
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  const run = () => {
    if (!preview) return;
    const result = store.commit((d) => applyInventoryImport(d, preview, handling));
    const parts = [`${result.added} added`];
    if (result.updated) parts.push(`${result.updated} updated`);
    if (result.skipped) parts.push(`${result.skipped} duplicates skipped`);
    if (result.failed.length) parts.push(`${result.failed.length} failed`);
    toast.success(`Import finished: ${parts.join(', ')}.`);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import inventory from CSV"
      description="Spreadsheet exports from Excel, Google Sheets or other apps work."
      size="lg"
      testId="import-dialog"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={run} disabled={!preview || willImport === 0}>
            {willImport > 0 ? `Import ${willImport} ${willImport === 1 ? 'item' : 'items'}` : 'Import'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2 p-5 text-center">
          <FileUp className="mx-auto mb-2 size-6 text-ink-2" />
          <p className="text-sm text-ink-2">
            {fileName ? (
              <>
                Selected <strong className="text-ink">{fileName}</strong>
              </>
            ) : (
              'Choose a .csv file. Required columns: name, quantity, unit_cost.'
            )}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => inputRef.current?.click()}>
              {fileName ? 'Choose another file' : 'Choose CSV file'}
            </Button>
            <Button icon={<Download className="size-4" />} onClick={() => downloadText('stockpilot-import-template.csv', importTemplateCsv())}>
              Download template
            </Button>
          </div>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file to import" data-testid="import-file" onChange={(e) => void choose(e.target.files?.[0])} />
        </div>
        {error && <p className="text-sm text-bad-text">{error}</p>}

        {preview && preview.missingColumns.length > 0 && (
          <div className="rounded-xl bg-bad-soft p-3 text-sm text-bad-text" role="alert">
            <strong>Missing required {preview.missingColumns.length === 1 ? 'column' : 'columns'}:</strong> {preview.missingColumns.join(', ')}.
            {preview.matchedColumns.length > 0 && <> Found: {preview.matchedColumns.join(', ')}.</>} Download the template to see the expected headers.
          </div>
        )}

        {preview && preview.missingColumns.length === 0 && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center" data-testid="import-summary">
              <Summary label="New items" value={fresh} />
              <Summary label="Already in inventory" value={duplicates} />
              <Summary label="Rows with errors" value={preview.errors.length} bad={preview.errors.length > 0} />
            </div>
            {duplicates > 0 && (
              <div className="rounded-xl border border-line p-3">
                <p className="mb-2 text-sm text-ink">
                  {duplicates} {duplicates === 1 ? 'row matches an item' : 'rows match items'} you already have (same SKU, or same name and category). What should happen?
                </p>
                <Segmented
                  label="Duplicates"
                  value={handling}
                  onChange={setHandling}
                  options={[
                    { value: 'skip', label: 'Skip them' },
                    { value: 'update', label: 'Update existing items' },
                  ]}
                />
              </div>
            )}
            {preview.ignoredColumns.length > 0 && <p className="text-xs text-muted">Ignored columns: {preview.ignoredColumns.join(', ')}</p>}
            {preview.errors.length > 0 && (
              <IssueList title={`${preview.errors.length} ${preview.errors.length === 1 ? 'row' : 'rows'} will be skipped`} issues={preview.errors} tone="bad" />
            )}
            {preview.warnings.length > 0 && <IssueList title="Worth checking" issues={preview.warnings} tone="warn" />}
            {preview.errors.length === 0 && preview.rows.length > 0 && (
              <p className="flex items-center gap-2 text-sm text-good-text">
                <CheckCircle2 className="size-4" /> All {preview.rows.length} rows look good.
              </p>
            )}
            {preview.fileRows === 0 && <p className="text-sm text-ink-2">The file has a header but no rows.</p>}
          </>
        )}
      </div>
    </Dialog>
  );
}

function Summary({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <div className={`text-xl font-semibold ${bad ? 'text-bad-text' : 'text-ink'}`}>{value}</div>
      <div className="text-xs text-ink-2">{label}</div>
    </div>
  );
}

function IssueList({ title, issues, tone }: { title: string; issues: { rowNumber: number; messages: string[] }[]; tone: 'bad' | 'warn' }) {
  return (
    <div className={`rounded-xl p-3 ${tone === 'bad' ? 'bg-bad-soft' : 'bg-warn-soft'}`}>
      <p className={`mb-2 flex items-center gap-1.5 text-sm font-medium ${tone === 'bad' ? 'text-bad-text' : 'text-warn-text'}`}>
        <AlertTriangle className="size-4" /> {title}
      </p>
      <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-ink">
        {issues.map((i) => (
          <li key={i.rowNumber}>
            <span className="font-medium">Row {i.rowNumber}:</span> {i.messages.join(' ')}
          </li>
        ))}
      </ul>
    </div>
  );
}
