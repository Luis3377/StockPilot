import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './cn';
import { IconButton } from './Button';

let openCount = 0;

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Set false for forms where an accidental outside tap would lose typing. */
  dismissOnBackdrop?: boolean;
  testId?: string;
}

const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Accessible modal: a centered dialog on larger screens, a bottom sheet on phones. */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', dismissOnBackdrop = true, testId }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    openCount++;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    // Don't pop the keyboard open on phones just because a sheet opened.
    if (first && !(window.matchMedia('(pointer: coarse)').matches && first.matches('input,textarea,select'))) first.focus();
    else panel?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab' && panel) {
        const els = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!els.length) return;
        const firstEl = els[0];
        const lastEl = els[els.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    panel?.addEventListener('keydown', onKey);
    return () => {
      panel?.removeEventListener('keydown', onKey);
      openCount--;
      if (openCount === 0) document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        className="animate-fade-in absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={dismissOnBackdrop ? onClose : undefined}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        data-testid={testId}
        className={cn(
          'animate-sheet-in relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-surface shadow-pop outline-none sm:max-h-[86vh] sm:rounded-3xl',
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 pt-4 pb-3 sm:px-6">
          <div className="min-w-0 pt-1">
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-0.5 text-sm text-ink-2">
                {description}
              </p>
            )}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mr-2">
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">{children}</div>
        {footer && (
          <div className="pb-safe border-t border-line bg-surface px-5 py-3 sm:px-6">
            <div className="flex flex-col-reverse gap-2 pb-1 sm:flex-row sm:justify-end sm:pb-0">{footer}</div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
