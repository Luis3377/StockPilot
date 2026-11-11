import { useId, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, DatabaseBackup, FlaskConical, HardDrive, Package, ShieldAlert, Sparkles, Store, Tag, Upload } from 'lucide-react';
import { store } from '../data/store';
import { MODES } from '../lib/modes';
import { scannerEnabled } from '../ai/config';
import { installContext } from '../lib/platform';
import type { UserMode } from '../domain/types';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { useRadioGroup } from '../ui/useRadioGroup';
import { RestoreDialog } from './dialogs/RestoreDialog';
import { DataRisks, HomeScreenAdvice } from './DataSafety';

const MODE_ICONS: Record<UserMode, React.ReactNode> = {
  reseller: <Tag className="size-6" />,
  collector: <Sparkles className="size-6" />,
  business: <Store className="size-6" />,
};
const MODE_IDS = MODES.map((m) => m.id);

export function Onboarding() {
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<UserMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const ids = useId();
  const radio = useRadioGroup(MODE_IDS, mode, setMode);
  const context = installContext();

  const finish = async (demo: boolean) => {
    if (!mode) return;
    setBusy(true);
    if (demo) await store.setDemoActive(true);
    store.updateSettings({
      mode,
      onboarded: true,
      defaultLowStockThreshold: mode === 'business' ? 5 : null,
    });
    void store.requestPersistence();
  };

  /** After restoring a backup from the welcome screen, go straight in. */
  const finishAfterRestore = (restoredSettings: boolean) => {
    store.updateSettings({ onboarded: true, ...(restoredSettings ? {} : { mode: mode ?? 'reseller' }) });
    void store.requestPersistence();
  };

  const restoreLink = (
    <div className="mt-8 rounded-2xl border border-dashed border-line-strong p-4 text-sm text-ink-2" data-testid="onboarding-restore">
      <p className="font-medium text-ink">Already have StockPilot inventory somewhere else?</p>
      <p className="mt-0.5">Moving from Safari to the Home Screen app, from another browser, or from another device? Restore the backup file you downloaded there.</p>
      <Button className="mt-3" size="sm" icon={<Upload className="size-4" />} onClick={() => setRestoring(true)}>
        Restore a backup
      </Button>
    </div>
  );

  return (
    <div className="pt-safe flex min-h-dvh flex-col bg-canvas">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-8 sm:py-14">
        <div className="mb-8 flex items-center gap-2.5">
          <img src="./icon.svg" alt="" className="size-9 rounded-[10px]" />
          <span className="text-lg font-semibold tracking-tight">StockPilot</span>
          <span className="ml-auto text-xs text-muted" aria-live="polite">
            Step {step} of 2
          </span>
        </div>

        {step === 1 ? (
          <>
            <h1 id={`${ids}-q`} className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              How will you be using StockPilot?
            </h1>
            <p className="mt-2 text-ink-2">Know what you own. Know what you actually make. You can switch any time — your inventory stays the same.</p>
            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-labelledby={`${ids}-q`}>
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  aria-labelledby={`${ids}-${m.id}-name`}
                  aria-describedby={`${ids}-${m.id}-desc`}
                  {...radio(m.id)}
                  onClick={() => setMode(m.id)}
                  className={cn(
                    'relative flex flex-col rounded-2xl border bg-surface p-5 text-left shadow-card transition-all',
                    mode === m.id ? 'border-accent ring-2 ring-accent/25' : 'border-line hover:border-line-strong',
                  )}
                >
                  {mode === m.id && (
                    <span className="absolute top-4 right-4 flex size-6 items-center justify-center rounded-full bg-accent text-white">
                      <Check className="size-4" />
                    </span>
                  )}
                  <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent-text">{MODE_ICONS[m.id]}</span>
                  <span id={`${ids}-${m.id}-name`} className="mt-4 text-lg font-semibold text-ink">
                    {m.name} Mode
                  </span>
                  <span id={`${ids}-${m.id}-desc`} className="contents">
                    <span className="mt-1 text-sm text-ink-2">{m.tagline}</span>
                    <span className="mt-4 space-y-1.5 text-sm text-ink">
                      {m.features.map((f) => (
                        <span key={f} className="flex gap-2">
                          <Check className="mt-0.5 size-4 shrink-0 text-good" /> {f}
                          <span className="sr-only">.</span>
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-8 flex flex-col items-end gap-2">
              <Button variant="primary" size="lg" disabled={!mode} onClick={() => setStep(2)} aria-describedby={!mode ? `${ids}-pick` : undefined}>
                Continue <ArrowRight className="size-4" />
              </Button>
              {!mode && (
                <p id={`${ids}-pick`} className="text-xs text-muted">
                  Choose one to continue.
                </p>
              )}
            </div>
            {restoreLink}
          </>
        ) : (
          <>
            <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Where your inventory is saved</h1>
            <p className="mt-2 text-ink-2">Please read this once — it’s how you keep your records safe.</p>

            <section aria-labelledby={`${ids}-where`} className="mt-6 flex gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card" data-testid="storage-explainer">
              <HardDrive className="mt-0.5 size-6 shrink-0 text-accent" />
              <div className="min-w-0 text-sm text-ink-2">
                <h2 id={`${ids}-where`} className="font-semibold text-ink">
                  Only on this device, in {context === 'ios-home-screen' ? 'this Home Screen app' : 'this browser'}
                </h2>
                <p className="mt-1">
                  Your inventory, photos and sales aren’t uploaded and there’s no account or cloud copy{scannerEnabled ? ' (only photos you choose to scan with AI, and figures you choose to have AI explain, are sent for analysis, and they aren’t stored)' : ''}.
                </p>
              </div>
            </section>

            <section aria-labelledby={`${ids}-risk`} className="mt-3 flex gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
              <ShieldAlert className="mt-0.5 size-6 shrink-0 text-warn" />
              <div className="min-w-0 text-sm text-ink-2">
                <h2 id={`${ids}-risk`} className="font-semibold text-ink">
                  Your inventory could go missing if:
                </h2>
                <div className="mt-1">
                  <DataRisks context={context} />
                </div>
              </div>
            </section>

            <section aria-labelledby={`${ids}-protect`} className="mt-3 flex gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
              <DatabaseBackup className="mt-0.5 size-6 shrink-0 text-good" />
              <div className="min-w-0 text-sm text-ink-2">
                <h2 id={`${ids}-protect`} className="font-semibold text-ink">
                  How to protect it
                </h2>
                <p className="mt-1">
                  Download a backup now and then: <strong className="text-ink">Settings → Backup &amp; restore → Download backup</strong>. Keep the file somewhere else (Files, iCloud Drive,
                  Google Drive or email). You can restore it on any device or browser. StockPilot will remind you.
                </p>
              </div>
            </section>

            <HomeScreenAdvice context={context} className="mt-3" />

            <h2 className="mt-8 text-lg font-semibold text-ink">How would you like to start?</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void finish(false)}

                className="flex flex-col rounded-2xl border border-accent bg-surface p-5 text-left shadow-card ring-2 ring-accent/20 hover:bg-surface-2"
              >
                <Package className="size-6 text-accent" />
                <span id={`${ids}-own-name`} className="mt-3 font-semibold text-ink">
                  Start with my own inventory
                </span>
                <span id={`${ids}-own`} className="mt-1 text-sm text-ink-2">
                  Begin empty and add your first item in under a minute.
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void finish(true)}

                className="flex flex-col rounded-2xl border border-line bg-surface p-5 text-left shadow-card hover:bg-surface-2"
              >
                <FlaskConical className="size-6 text-demo" />
                <span id={`${ids}-demo-name`} className="mt-3 font-semibold text-ink">
                  Explore with demo data
                </span>
                <span id={`${ids}-demo`} className="mt-1 text-sm text-ink-2">
                  Try everything with clearly labeled sample items. Leave demo mode any time — it never mixes with your real data.
                </span>
              </button>
            </div>
            {restoreLink}
            <div className="mt-8">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft className="size-4" /> Back
              </Button>
            </div>
          </>
        )}
      </main>
      <RestoreDialog open={restoring} onClose={() => setRestoring(false)} onRestored={finishAfterRestore} />
    </div>
  );
}
