import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FlaskConical, HardDrive, Package, Sparkles, Store, Tag } from 'lucide-react';
import { store } from '../data/store';
import { MODES } from '../lib/modes';
import type { UserMode } from '../domain/types';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';

const MODE_ICONS: Record<UserMode, React.ReactNode> = {
  reseller: <Tag className="size-6" />,
  collector: <Sparkles className="size-6" />,
  business: <Store className="size-6" />,
};

export function Onboarding() {
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<UserMode | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="pt-safe flex min-h-dvh flex-col bg-canvas">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-8 sm:py-14">
        <div className="mb-8 flex items-center gap-2.5">
          <img src="./icon.svg" alt="" className="size-9 rounded-[10px]" />
          <span className="text-lg font-semibold tracking-tight">StockPilot</span>
          <span className="ml-auto text-xs text-muted">Step {step} of 2</span>
        </div>

        {step === 1 ? (
          <>
            <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">How will you be using StockPilot?</h1>
            <p className="mt-2 text-ink-2">Know what you own, what it’s worth, and what you’re making. You can switch any time — your inventory stays the same.</p>
            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="How will you be using StockPilot?">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
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
                  <span className="mt-4 text-lg font-semibold text-ink">{m.name} Mode</span>
                  <span className="mt-1 text-sm text-ink-2">{m.tagline}</span>
                  <ul className="mt-4 space-y-1.5 text-sm text-ink">
                    {m.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-good" /> {f}
                      </li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
            <div className="mt-8 flex justify-end">
              <Button variant="primary" size="lg" disabled={!mode} onClick={() => setStep(2)}>
                Continue <ArrowRight className="size-4" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">One quick thing about your data</h1>
            <div className="mt-6 flex gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
              <HardDrive className="mt-0.5 size-6 shrink-0 text-accent" />
              <div className="text-sm text-ink-2">
                <p className="font-medium text-ink">Your inventory is stored only on this device, in this browser.</p>
                <p className="mt-1">
                  Nothing is uploaded and no account is needed. That also means <strong className="text-ink">clearing your browser data, or using a different browser or device, won’t show your records</strong>. Download a
                  backup from Settings now and then to keep them safe.
                </p>
              </div>
            </div>
            <h2 className="mt-8 text-lg font-semibold text-ink">How would you like to start?</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void finish(false)}
                className="flex flex-col rounded-2xl border border-accent bg-surface p-5 text-left shadow-card ring-2 ring-accent/20 hover:bg-surface-2"
              >
                <Package className="size-6 text-accent" />
                <span className="mt-3 font-semibold text-ink">Start with my own inventory</span>
                <span className="mt-1 text-sm text-ink-2">Begin empty and add your first item in under a minute.</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void finish(true)}
                className="flex flex-col rounded-2xl border border-line bg-surface p-5 text-left shadow-card hover:bg-surface-2"
              >
                <FlaskConical className="size-6 text-demo" />
                <span className="mt-3 font-semibold text-ink">Explore with demo data</span>
                <span className="mt-1 text-sm text-ink-2">Try everything with clearly labeled sample items. Leave demo mode any time — it never mixes with your real data.</span>
              </button>
            </div>
            <div className="mt-8">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft className="size-4" /> Back
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
