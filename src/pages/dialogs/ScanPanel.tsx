import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Camera, CheckCircle2, ChevronDown, HelpCircle, ImageUp, Loader2, ScanSearch, Sparkles, X } from 'lucide-react';
import { remoteScanProvider, ScanError, type ItemScanProvider } from '../../ai/scanClient';
import { conditionLabel } from '../../ai/applySuggestion';
import type { ScanFillableField } from '../../ai/applySuggestion';
import type { ScanResult } from '../../ai/scanSchema';
import { setTesterCode, useTesterCode } from '../../ai/testerCode';
import { PROVIDER_PRIVACY_URL } from '../../ai/config';
import { plural } from '../../domain/format';
import { store } from '../../data/store';
import { processPhoto, type ProcessedPhoto } from '../../lib/images';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { inputClass } from '../../ui/Fields';
import { ItemThumb, primePhotoCache } from '../../ui/Photo';
import { cn } from '../../ui/cn';

type Stage =
  | { kind: 'start' }
  | { kind: 'preparing' }
  | { kind: 'ready'; photo: ProcessedPhoto }
  | { kind: 'analyzing'; photo: ProcessedPhoto }
  | { kind: 'done'; photo: ProcessedPhoto; result: ScanResult; filled: ScanFillableField[]; scansLeftToday: number | null; modelLabel: string }
  | { kind: 'error'; photo: ProcessedPhoto | null; message: string; retryable: boolean };

const FIELD_NAMES: Record<ScanFillableField, string> = { name: 'name', category: 'category', condition: 'condition', notes: 'notes' };

interface ScanPanelProps {
  /** Opened from a "Scan with AI" button: draw attention to the panel. */
  highlight?: boolean;
  /** A photo was chosen; attach it to the item (replacing an earlier scan photo, if any). */
  onPhoto: (photoId: string, replacedId: string | null) => void;
  /** Fill the form from a result; returns the fields that were filled. */
  onResult: (result: ScanResult) => ScanFillableField[];
  provider?: ItemScanProvider;
}

/** The "Scan with AI" step at the top of Add Item. Nothing is sent until the user taps Analyze. */
export function ScanPanel({ highlight, onPhoto, onResult, provider = remoteScanProvider }: ScanPanelProps) {
  const [stage, setStage] = useState<Stage>({ kind: 'start' });
  const [hidden, setHidden] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const code = useTesterCode();
  const photo = 'photo' in stage ? stage.photo : null;

  useEffect(() => () => abortRef.current?.abort(), []);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    const previous = photo;
    setStage({ kind: 'preparing' });
    try {
      // Same on-device check and resize as other item photos (max 1600px JPEG).
      const processed = await processPhoto(file);
      await store.savePhotos([processed]);
      primePhotoCache({ ...processed, dataset: store.getState().dataset });
      onPhoto(processed.id, previous?.id ?? null);
      setStage({ kind: 'ready', photo: processed });
    } catch (e) {
      setStage({ kind: 'error', photo: previous, message: e instanceof Error ? e.message : 'That photo couldn’t be used.', retryable: false });
    } finally {
      if (cameraRef.current) cameraRef.current.value = '';
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const analyze = async () => {
    if (!photo || !code) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStage({ kind: 'analyzing', photo });
    try {
      const res = await provider.scan(photo.full, { code, signal: controller.signal });
      const filled = onResult(res.result);
      setStage({ kind: 'done', photo, result: res.result, filled, scansLeftToday: res.scansLeftToday, modelLabel: res.modelLabel });
    } catch (e) {
      const err = e instanceof ScanError ? e : new ScanError('network');
      if (err.code === 'cancelled') {
        setStage({ kind: 'ready', photo });
        return;
      }
      if (err.needsCode && err.code !== 'missing_code') setTesterCode(null);
      setStage({ kind: 'error', photo, message: err.message, retryable: err.retryable });
    } finally {
      abortRef.current = null;
    }
  };

  if (hidden) {
    return (
      <button type="button" onClick={() => setHidden(false)} className="inline-flex items-center gap-1.5 text-sm font-medium text-demo hover:underline">
        <Sparkles className="size-4" /> Scan with AI instead
      </button>
    );
  }

  const pickers = (
    <div className="flex flex-wrap gap-2">
      <Button variant={photo ? 'ghost' : 'primary'} icon={<Camera className="size-4" />} onClick={() => cameraRef.current?.click()} disabled={stage.kind === 'analyzing' || stage.kind === 'preparing'}>
        {photo ? 'Retake' : 'Take photo'}
      </Button>
      <Button variant={photo ? 'ghost' : 'secondary'} icon={<ImageUp className="size-4" />} onClick={() => uploadRef.current?.click()} disabled={stage.kind === 'analyzing' || stage.kind === 'preparing'}>
        {photo ? 'Use another photo' : 'Upload photo'}
      </Button>
    </div>
  );

  return (
    <section
      aria-label="Scan with AI"
      data-testid="scan-panel"
      className={cn('rounded-2xl border p-4', highlight ? 'border-demo/50 bg-demo-soft/40 ring-2 ring-demo/20' : 'border-line bg-surface-2/60')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-demo-soft text-demo">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
              Scan with AI <Badge tone="demo">Beta</Badge>
            </h3>
            <p className="text-xs text-ink-2">Take or upload a photo and AI suggests the name, category, condition and a description. You check everything before saving.</p>
          </div>
        </div>
        <button type="button" onClick={() => setHidden(true)} className="shrink-0 rounded-lg p-1 text-muted hover:text-ink" aria-label="Hide AI scanner">
          <X className="size-4" />
        </button>
      </div>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo to scan" data-testid="scan-camera-input" onChange={(e) => void choose(e.target.files?.[0])} />
      <input ref={uploadRef} type="file" accept="image/*" className="sr-only" aria-label="Upload a photo to scan" data-testid="scan-upload-input" onChange={(e) => void choose(e.target.files?.[0])} />

      <div className="mt-3 space-y-3">
        {photo && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="relative size-24 shrink-0 overflow-hidden rounded-xl border border-line sm:size-28">
              <ItemThumb photoId={photo.id} name="Photo to scan" className="size-full" />
              {stage.kind === 'analyzing' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 className="size-7 animate-spin text-white" aria-hidden />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              {stage.kind === 'ready' && (
                <>
                  {code ? (
                    <Button variant="primary" icon={<ScanSearch className="size-4" />} onClick={() => void analyze()} data-autofocus>
                      Analyze photo
                    </Button>
                  ) : (
                    <InviteCodeForm provider={provider} />
                  )}
                  <PrivacyNote />
                </>
              )}
              {stage.kind === 'analyzing' && (
                <div role="status" className="space-y-2">
                  <p className="text-sm font-medium text-ink">Analyzing your photo…</p>
                  <p className="text-xs text-ink-2">This usually takes a few seconds.</p>
                  <Button size="sm" onClick={() => abortRef.current?.abort()}>
                    Cancel scan
                  </Button>
                </div>
              )}
              {stage.kind === 'done' && <ResultSummary stage={stage} onRetry={() => void analyze()} />}
              {stage.kind === 'error' && (
                <ErrorBox message={stage.message}>
                  {code && stage.retryable && (
                    <Button size="sm" variant="primary" onClick={() => void analyze()}>
                      Try again
                    </Button>
                  )}
                  {!code && <InviteCodeForm provider={provider} onSaved={() => setStage({ kind: 'ready', photo: stage.photo! })} />}
                  <Button size="sm" variant="ghost" onClick={() => setHidden(true)}>
                    Enter details manually
                  </Button>
                </ErrorBox>
              )}
            </div>
          </div>
        )}

        {!photo && stage.kind === 'error' && (
          <ErrorBox message={stage.message}>
            <Button size="sm" variant="ghost" onClick={() => setHidden(true)}>
              Enter details manually
            </Button>
          </ErrorBox>
        )}
        {stage.kind === 'preparing' && (
          <p role="status" className="flex items-center gap-2 text-sm text-ink-2">
            <Loader2 className="size-4 animate-spin" /> Preparing photo…
          </p>
        )}
        {stage.kind !== 'analyzing' && stage.kind !== 'preparing' && pickers}
      </div>
    </section>
  );
}

function ResultSummary({ stage, onRetry }: { stage: Extract<Stage, { kind: 'done' }>; onRetry: () => void }) {
  const { result, filled } = stage;
  if (result.status === 'unrecognized') {
    return (
      <div className="space-y-2" data-testid="scan-result">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <HelpCircle className="size-4 text-warn" /> Couldn’t identify this item
        </p>
        {result.notes && <p className="text-xs text-ink-2">{result.notes}</p>}
        <p className="text-xs text-ink-2">Add the details yourself; the photo is attached.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
        {stage.scansLeftToday !== null && <p className="text-[11px] text-muted">{plural(stage.scansLeftToday, 'scan')} left today</p>}
      </div>
    );
  }
  const condition = conditionLabel(result.condition);
  return (
    <div className="space-y-2" data-testid="scan-result">
      <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
        <CheckCircle2 className="size-4 text-good" />
        {result.status === 'identified' ? 'Suggested details' : 'Partly identified'}
        <Badge tone={result.confidence === 'high' ? 'good' : result.confidence === 'medium' ? 'accent' : 'warn'}>{result.confidence} confidence</Badge>
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {result.name && <Row label="Name" value={result.name} />}
        {(result.brand || result.model) && <Row label="Brand / model" value={[result.brand, result.model].filter(Boolean).join(' · ')} />}
        {result.category && <Row label="Category" value={result.category} />}
        {condition && <Row label="Condition" value={condition} />}
      </dl>
      {result.notes && <p className="text-xs text-ink-2">{result.notes}</p>}
      <p className="text-xs font-medium text-ink" data-testid="scan-filled">
        {filled.length
          ? `Filled in ${filled.map((f) => FIELD_NAMES[f]).join(', ')} below. Check and edit them; nothing is saved until you tap Add item.`
          : 'Your own entries were kept. Nothing is saved until you tap Add item.'}
      </p>
      <p className="text-[11px] text-muted">
        AI suggestions can be wrong. Price, cost and quantity are never filled in.
        {stage.scansLeftToday !== null && ` · ${plural(stage.scansLeftToday, 'scan')} left today`}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-2">{label}</dt>
      <dd className="min-w-0 font-medium break-words text-ink">{value}</dd>
    </>
  );
}

function ErrorBox({ message, children }: { message: string; children: ReactNode }) {
  return (
    <div role="alert" className="space-y-2" data-testid="scan-error">
      <p className="flex items-start gap-1.5 text-sm text-bad-text">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {message}
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/** How a scanned photo is handled. Shown in the scanner and in Settings. */
export function ScanPrivacyDetails() {
  return (
    <ul className="list-disc space-y-1 pl-4">
      <li>Nothing is sent until you tap Analyze. StockPilot’s scanner service passes the photo to Anthropic and doesn’t store or log it.</li>
      <li>
        Anthropic automatically deletes API inputs and outputs within 30 days and doesn’t use them to train models by default (content flagged by its safety systems can be kept longer).{' '}
        <a href={PROVIDER_PRIVACY_URL} target="_blank" rel="noreferrer" className="text-accent-text underline">
          Anthropic’s policy
        </a>
      </li>
      <li>The photo you take is also saved with the item on this device, like any other item photo.</li>
    </ul>
  );
}

export function PrivacyNote() {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs text-ink-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-left font-medium text-ink-2 hover:text-ink" aria-expanded={open}>
        Tapping Analyze sends this photo to Anthropic’s Claude AI.{' '}
        <span className="whitespace-nowrap underline">
          How it’s handled
          <ChevronDown className={cn('ml-0.5 inline size-3 align-[-2px] transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      {open && (
        <div className="mt-1.5">
          <ScanPrivacyDetails />
        </div>
      )}
    </div>
  );
}

/** Enter and check a private-beta invite code; stored only in this browser. */
export function InviteCodeForm({ provider = remoteScanProvider, onSaved }: { provider?: ItemScanProvider; onSaved?: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  const save = async () => {
    const code = value.trim();
    if (!code) return;
    setBusy(true);
    setMessage(null);
    try {
      const status = await provider.status(code);
      setTesterCode(code);
      setValue('');
      setMessage({ tone: 'good', text: `Code accepted · ${plural(status.scansLeftToday, 'scan')} left today` });
      onSaved?.();
    } catch (e) {
      setMessage({ tone: 'bad', text: e instanceof ScanError ? e.message : 'That code couldn’t be checked. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5" data-testid="invite-code-form">
      <label className="block text-xs font-medium text-ink" htmlFor="scan-invite-code">
        Private beta: enter your invite code
      </label>
      <div className="flex gap-2">
        <input
          id="scan-invite-code"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
          placeholder="SP-XXXXX-XXXXX-XXXXX-XXXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className={cn(inputClass, 'h-10 border-line-strong font-mono sm:text-sm')}
        />
        <Button variant="primary" size="md" onClick={() => void save()} loading={busy} disabled={!value.trim()}>
          Save code
        </Button>
      </div>
      {message && (
        <p className={cn('text-xs', message.tone === 'good' ? 'text-good-text' : 'text-bad-text')} role={message.tone === 'bad' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </div>
  );
}
