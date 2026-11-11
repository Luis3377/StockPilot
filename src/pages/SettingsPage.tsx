import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, Database, Download, FileUp, FlaskConical, HardDrive, Monitor, Moon, RotateCcw, ShieldCheck, Sun, Trash2, Upload } from 'lucide-react';
import { store, useAppState } from '../data/store';
import { adjustmentsCsv, inventoryCsv, profitSummaryCsv, salesCsv } from '../csv/exports';
import { importTemplateCsv } from '../csv/inventoryImport';
import { sellingCostRate } from '../domain/calc';
import { formatDateTime, todayISO } from '../domain/dates';
import { backupAgeText, backupStatus } from '../data/backupStatus';
import { useBackup } from '../lib/useBackup';
import { installContext } from '../lib/platform';
import { DataRisks, Disclosure, HomeScreenAdvice, MoveDataSteps } from './DataSafety';
import { formatPercent } from '../domain/money';
import type { Settings, ThemePreference } from '../domain/types';
import { CURRENCIES, MODES, modeInfo } from '../lib/modes';
import { useRadioGroup } from '../ui/useRadioGroup';

const MODE_IDS = MODES.map((m) => m.id);
import { downloadText, fileStamp } from '../lib/download';
import { PageHeader, Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Segmented, SelectField, Toggle } from '../ui/Fields';
import { Badge } from '../ui/Badge';
import { forgetPhotos } from '../ui/Photo';
import { useConfirm } from '../ui/Confirm';
import { useToast } from '../ui/Toast';
import { cn } from '../ui/cn';
import { useDialogs } from './dialogs/DialogHub';
import { ScannerSettings } from './ScannerSettings';
import { scannerEnabled } from '../ai/config';
import { plural, pluralWord } from '../domain/format';

function Section({ id, title, description, children }: { id?: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-24 p-5 sm:p-6">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-ink-2">{description}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

/** Number input that saves on blur, so typing "1" on the way to "120" doesn't trigger alerts. */
function NumberSetting({ label, hint, value, onSave, min = 0, max, suffix, allowBlank }: { label: string; hint?: string; value: number | null; onSave: (v: number | null) => void; min?: number; max?: number; suffix?: string; allowBlank?: boolean }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  const save = () => {
    if (text.trim() === '') {
      if (allowBlank) {
        setError(null);
        if (value !== null) onSave(null);
      } else {
        setError('Enter a number');
      }
      return;
    }
    const n = Number(text);
    if (!Number.isFinite(n) || n < min || (max !== undefined && n > max)) {
      setError(`Enter a number${max !== undefined ? ` from ${min} to ${max}` : ` of at least ${min}`}`);
      return;
    }
    setError(null);
    if (n !== value) onSave(n);
  };
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-2">{hint}</span>}
      <span className="mt-1.5 flex items-center gap-2">
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          placeholder={allowBlank ? 'Off' : undefined}
          className={cn('h-11 w-28 rounded-xl border bg-surface px-3 text-ink outline-none focus:border-accent', error ? 'border-bad' : 'border-line-strong')}
          aria-invalid={Boolean(error)}
        />
        {suffix && <span className="text-sm text-ink-2">{suffix}</span>}
      </span>
      {error && <span className="mt-1 block text-sm text-bad-text">{error}</span>}
    </label>
  );
}

export function SettingsPage() {
  const settings = useAppState((s) => s.settings);
  const data = useAppState((s) => s.data);
  const dataset = useAppState((s) => s.dataset);
  const storageKind = useAppState((s) => s.storageKind);
  const persistGranted = useAppState((s) => s.persistGranted);
  const dialogs = useDialogs();
  const confirm = useConfirm();
  const toast = useToast();
  const location = useLocation();
  const demo = dataset === 'demo';
  const prefix = `stockpilot-${demo ? 'demo-' : ''}`;
  const rate = sellingCostRate(data.sales, { sellingCostPercent: null });

  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [location.hash]);

  const save = (patch: Partial<Settings>, message = 'Settings saved.') => {
    store.updateSettings(patch);
    toast.success(message);
  };

  const { backup, busy } = useBackup();
  const status = backupStatus(data, settings.lastBackupAt);
  const context = installContext();

  const withoutThreshold = data.items.filter((i) => i.lowStockThreshold === null).length;
  const modeRadio = useRadioGroup(MODE_IDS, settings.mode, (m) => save({ mode: m }, `Switched to ${modeInfo(m).name} mode. Your inventory is unchanged.`));

  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-4">
        <Section title="How you use StockPilot" description="Changes your dashboard and which features are shown. Your inventory is never changed or duplicated.">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={settings.mode === m.id}
                {...modeRadio(m.id)}
                onClick={() => settings.mode !== m.id && save({ mode: m.id }, `Switched to ${m.name} mode. Your inventory is unchanged.`)}
                className={cn('rounded-2xl border p-4 text-left transition-colors', settings.mode === m.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}
              >
                <span className="flex items-center justify-between text-sm font-semibold text-ink">
                  {m.name} {settings.mode === m.id && <Check className="size-4 text-accent" />}
                </span>
                <span className="mt-1 block text-xs text-ink-2">{m.tagline}</span>
              </button>
            ))}
          </div>
          {settings.mode === 'collector' && (
            <div className="mt-4 rounded-2xl bg-surface-2 p-4">
              <Toggle
                checked={settings.collectorSalesEnabled}
                onChange={(v) => save({ collectorSalesEnabled: v }, v ? 'Sales & profit tracking turned on.' : 'Sales & profit tracking turned off. Recorded sales are kept.')}
                label="Track sales & profit"
                description="Turn on if you sometimes sell pieces from your collection."
              />
            </div>
          )}
        </Section>

        <Section title="Appearance">
          <Segmented<ThemePreference>
            label="Theme"
            value={settings.theme}
            onChange={(v) => store.updateSettings({ theme: v })}
            options={[
              { value: 'system', label: <span className="inline-flex items-center gap-1.5"><Monitor className="size-4" /> System</span> },
              { value: 'light', label: <span className="inline-flex items-center gap-1.5"><Sun className="size-4" /> Light</span> },
              { value: 'dark', label: <span className="inline-flex items-center gap-1.5"><Moon className="size-4" /> Dark</span> },
            ]}
          />
          <SelectField className="mt-4 max-w-xs" label="Currency" value={settings.currency} onChange={(v) => save({ currency: v }, 'Currency updated. Amounts are not converted.')} hint="Changes the symbol shown. Amounts are not converted.">
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </SelectField>
        </Section>

        <Section id="alerts" title="Alerts & insights" description="Thresholds used by Smart Insights and dashboard alerts.">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <NumberSetting
                label="Default low-stock alert for new items"
                hint="Pre-filled when you add an item. Leave blank for none."
                value={settings.defaultLowStockThreshold}
                allowBlank
                onSave={(v) => save({ defaultLowStockThreshold: v === null ? null : Math.round(v) })}
                suffix="units"
              />
              {settings.defaultLowStockThreshold !== null && withoutThreshold > 0 && (
                <Button
                  size="sm"
                  variant="soft"
                  className="mt-2"
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Apply to existing items?',
                      message: `Set a low-stock alert of ${settings.defaultLowStockThreshold} on the ${plural(withoutThreshold, 'item')} that ${pluralWord(withoutThreshold, 'doesn’t', 'don’t')} have one.`,
                      confirmLabel: 'Apply',
                      tone: 'primary',
                    });
                    if (!ok) return;
                    store.update((d) => ({ ...d, items: d.items.map((i) => (i.lowStockThreshold === null ? { ...i, lowStockThreshold: settings.defaultLowStockThreshold, updatedAt: new Date().toISOString() } : i)) }));
                    toast.success(`Low-stock alert set on ${plural(withoutThreshold, 'item')}.`);
                  }}
                >
                  Apply to {plural(withoutThreshold, 'item')} without one
                </Button>
              )}
            </div>
            <NumberSetting label="Slow-moving after" hint="Items unsold this long are flagged." value={settings.slowMovingDays} min={1} max={3650} onSave={(v) => save({ slowMovingDays: Math.round(v!) })} suffix="days" />
            <NumberSetting label="Low profit margin below" hint="Sales and prices under this margin are flagged." value={settings.lowMarginPercent} min={-100} max={100} onSave={(v) => save({ lowMarginPercent: v! })} suffix="%" />
            <div>
              <span className="text-sm font-medium text-ink">Selling costs for projections</span>
              <span className="mt-0.5 block text-xs text-ink-2">Fees + shipping + other, as a % of sale price.</span>
              <Segmented
                className="mt-1.5"
                label="Selling cost source"
                value={settings.sellingCostPercent === null ? 'auto' : 'custom'}
                onChange={(v) => save({ sellingCostPercent: v === 'auto' ? null : Math.round((rate.percent || 10) * 10) / 10 })}
                options={[
                  { value: 'auto', label: 'From my sales' },
                  { value: 'custom', label: 'Set my own' },
                ]}
              />
              {settings.sellingCostPercent === null ? (
                <p className="mt-2 text-xs text-ink-2">{rate.source === 'history' ? `Currently ${formatPercent(rate.percent)}, learned from ${plural(rate.basedOnSales, 'sale')}.` : 'No sales yet, so 0% is assumed.'}</p>
              ) : (
                <div className="mt-2">
                  <NumberSetting label="Estimated selling costs" value={settings.sellingCostPercent} min={0} max={99} onSave={(v) => save({ sellingCostPercent: v })} suffix="% of price" />
                </div>
              )}
            </div>
          </div>
        </Section>

        <Section id="data" title="Your data" description={demo ? 'You’re in demo mode, so these actions apply to the sample data.' : 'Import, export and back up your records.'}>
          {storageKind === 'memory' ? (
            <div className="mb-4 flex gap-3 rounded-2xl bg-bad-soft p-4 text-sm text-bad-text" role="alert">
              <HardDrive className="mt-0.5 size-5 shrink-0" />
              <p>This browser is blocking storage (private browsing or blocked website data), so nothing is being saved. Open StockPilot in a normal window or allow website data.</p>
            </div>
          ) : (
            <div className="mb-4 space-y-3" data-testid="data-safety">
              <div className="rounded-2xl bg-surface-2 p-4 text-sm text-ink-2">
                <p className="flex items-start gap-2">
                  <HardDrive className="mt-0.5 size-4 shrink-0 text-accent" />
                  <span>
                    <strong className="text-ink">Where your inventory is saved:</strong> only in {context === 'ios-home-screen' ? 'this Home Screen app' : 'this browser'} on this device. There’s
                    no account or cloud copy yet{demo ? ' (demo data is kept separately)' : ''}.
                  </span>
                </p>
                <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-[auto_1fr]">
                  <dt className="text-ink">Last backup</dt>
                  <dd data-testid="last-backup">
                    {settings.lastBackupAt ? `${formatDateTime(settings.lastBackupAt)} (${backupAgeText(settings.lastBackupAt)})` : 'never'}
                    {settings.lastBackupAt && status.records > 0 && (status.changedSinceBackup ? ' · changes since then aren’t backed up' : ' · up to date')}
                  </dd>
                  <dt className="text-ink">Browser protection</dt>
                  <dd className="flex flex-wrap items-center gap-2" data-testid="persist-status">
                    {persistGranted ? (
                      <Badge tone="good" icon={<ShieldCheck className="size-3" />}>
                        Protected from automatic cleanup
                      </Badge>
                    ) : persistGranted === false ? (
                      <>
                        <span>Not granted by this browser, so backups are your protection.</span>
                        <button
                          type="button"
                          className="text-xs font-medium text-accent-text underline"
                          onClick={async () => toast.info((await store.requestPersistence()) ? 'The browser will keep your data unless you clear it yourself.' : 'The browser didn’t grant extra protection. Keep regular backups.')}
                        >
                          Ask again
                        </button>
                      </>
                    ) : (
                      <span>Not available in this browser, so backups are your protection.</span>
                    )}
                  </dd>
                </dl>
                <p className="mt-2 text-xs">
                  “Protected” means the browser won’t remove the data on its own to free space. You (or someone with the device) can still delete it, so keep backups either way.
                </p>
                <div className="mt-3">
                  <Button variant="primary" size="sm" icon={<Download className="size-4" />} onClick={() => void backup()} loading={busy}>
                    Back up now
                  </Button>
                </div>
              </div>
              <HomeScreenAdvice context={context} />
              <Disclosure title="What could make my inventory disappear?" testId="risks-disclosure">
                <DataRisks context={context} />
                <p className="mt-2">A backup file kept somewhere else (Files, iCloud Drive, Google Drive or email) is the way to get everything back.</p>
              </Disclosure>
              <Disclosure title="Moving to a new phone, another browser, or the Home Screen app" testId="move-disclosure">
                <MoveDataSteps />
              </Disclosure>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ActionGroup id="backup" title="Backup & restore" icon={<Database className="size-4" />}>
              <Button variant="primary" icon={<Download className="size-4" />} onClick={() => void backup()} loading={busy}>
                Download backup
              </Button>
              <Button icon={<Upload className="size-4" />} onClick={dialogs.restoreBackup}>
                Restore from backup
              </Button>
              <p className="w-full text-xs text-muted">
                A backup is one .json file with your items, photos, sales, counts and settings. Restoring it replaces the data here.
                {scannerEnabled && ' Your invite code for the AI scanner isn’t included.'}
              </p>
            </ActionGroup>
            <ActionGroup title="Import" icon={<FileUp className="size-4" />}>
              <Button icon={<FileUp className="size-4" />} onClick={dialogs.importCsv}>
                Import inventory CSV
              </Button>
              <Button variant="ghost" icon={<Download className="size-4" />} onClick={() => downloadText('stockpilot-import-template.csv', importTemplateCsv())}>
                Template
              </Button>
            </ActionGroup>
            <ActionGroup title="Export to CSV (Excel, Google Sheets)" icon={<Download className="size-4" />} wide>
              <Button onClick={() => downloadText(`${prefix}inventory-${fileStamp()}.csv`, inventoryCsv(data.items))} disabled={!data.items.length}>
                Inventory
              </Button>
              <Button onClick={() => downloadText(`${prefix}sales-${fileStamp()}.csv`, salesCsv(data.sales))} disabled={!data.sales.length}>
                Sales & profit
              </Button>
              <Button onClick={() => downloadText(`${prefix}profit-summary-${fileStamp()}.csv`, profitSummaryCsv(data.sales, todayISO()))} disabled={!data.sales.length}>
                Monthly profit summary
              </Button>
              <Button onClick={() => downloadText(`${prefix}adjustments-${fileStamp()}.csv`, adjustmentsCsv(data.adjustments))} disabled={!data.adjustments.length}>
                Adjustments & discrepancies
              </Button>
            </ActionGroup>
          </div>
        </Section>

        {scannerEnabled && <ScannerSettings />}

        <Section title="Demo mode" description="Explore StockPilot with clearly labeled sample inventory. Demo data is stored separately and never mixes with your real records.">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={demo ? 'primary' : 'secondary'}
              icon={<FlaskConical className="size-4" />}
              onClick={async () => {
                await store.setDemoActive(!demo);
                toast.success(demo ? 'Left demo mode. Showing your real inventory.' : 'Demo mode on. Showing sample data.');
              }}
            >
              {demo ? 'Exit demo mode' : 'Try demo mode'}
            </Button>
            <Button
              variant="ghost"
              icon={<RotateCcw className="size-4" />}
              onClick={async () => {
                const ok = await confirm({ title: 'Reset demo data?', message: 'Any changes you made in demo mode are thrown away and fresh sample data is created. Your real data is not affected.', confirmLabel: 'Reset demo' });
                if (!ok) return;
                await store.resetDemo();
                toast.success('Demo data reset.');
              }}
            >
              Reset demo data
            </Button>
          </div>
        </Section>

        {!demo && (
          <Section title="Erase all data" description="Permanently delete every item, photo, sale and count stored on this device.">
            <Button
              variant="danger"
              icon={<Trash2 className="size-4" />}
              disabled={data.items.length === 0 && data.sales.length === 0 && data.countHistory.length === 0}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Erase all your data?',
                  message: `This deletes ${plural(data.items.length, 'item')}, ${plural(data.sales.length, 'sale')} and all photos from this device. It can’t be undone unless you have a backup.`,
                  confirmLabel: 'Erase everything',
                  requireText: 'DELETE',
                });
                if (!ok) return;
                forgetPhotos(data.items.flatMap((i) => i.photoIds));
                await store.clearRealData();
                toast.success('All data erased.');
              }}
            >
              Erase all data
            </Button>
          </Section>
        )}

        <Section title="About StockPilot">
          <div className="space-y-2 text-sm text-ink-2">
            <p>Version {__APP_VERSION__} · Early prototype</p>
            <p>
              <strong className="text-ink">Smart Insights are rule-based.</strong> They are calculated from your recorded data using fixed, explainable rules. No AI model is used for insights, and your records never leave this device{scannerEnabled ? ' (except a photo you choose to analyze with the AI scanner, or the question and figures of an answer you choose to have AI explain, as described above)' : ''}.
            </p>
            <p>This prototype has no accounts or cloud sync. Before a public launch, secure accounts, private per-user cloud storage and automatic backups will be added.</p>
          </div>
        </Section>
      </div>
    </>
  );
}

function ActionGroup({ id, title, icon, children, wide }: { id?: string; title: string; icon: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div id={id} className={cn('scroll-mt-24 rounded-2xl border border-line p-4', wide && 'md:col-span-2')}>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="text-muted">{icon}</span>
        {title}
      </h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
