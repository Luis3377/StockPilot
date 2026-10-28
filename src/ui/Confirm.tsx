import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  /** User must type this exact text to enable the confirm button. */
  requireText?: string;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState('');
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setTyped('');
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  };

  const blocked = Boolean(options?.requireText && typed.trim() !== options.requireText);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={options !== null}
        onClose={() => finish(false)}
        title={options?.title ?? ''}
        size="sm"
        testId="confirm-dialog"
        footer={
          <>
            <Button onClick={() => finish(false)}>{options?.cancelLabel ?? 'Cancel'}</Button>
            <Button
              variant={options?.tone === 'primary' ? 'primary' : 'danger'}
              onClick={() => finish(true)}
              disabled={blocked}
              data-autofocus={options?.requireText ? undefined : true}
            >
              {options?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="text-sm text-ink-2">{options?.message}</div>
        {options?.requireText && (
          <label className="mt-4 block text-sm">
            <span className="text-ink-2">
              Type <strong className="text-ink">{options.requireText}</strong> to confirm
            </span>
            <input
              data-autofocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-ink outline-none focus:border-accent"
              autoComplete="off"
            />
          </label>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
}
