// A small "?" next to a financial term: opens a plain-English explanation (from help.ts) with a
// link to the Learning Center. Keyboard: Enter/Space opens, Escape closes; screen readers get the
// button's question and the expanded state.

import { useCallback, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleHelp } from 'lucide-react';
import { helpTopic } from './help';
import { useClickOutside } from '../lib/useClickOutside';
import { cn } from '../ui/cn';

export function HelpTip({ topic, className }: { topic: string; className?: string }) {
  const t = helpTopic(topic);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  useClickOutside(
    ref,
    open,
    useCallback(() => setOpen(false), []),
  );
  return (
    <span ref={ref} className={cn('relative inline-flex align-middle', className)} onKeyDown={(e) => e.key === 'Escape' && open && (e.stopPropagation(), setOpen(false))}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`What is ${t.term.toLowerCase()}?`}
        className="inline-flex size-6 items-center justify-center rounded-full text-muted hover:text-ink"
        data-testid={`help-${t.id}`}
      >
        <CircleHelp className="size-4" />
      </button>
      {open && (
        <span
          id={panelId}
          role="note"
          className="absolute top-7 left-1/2 z-40 w-72 max-w-[80vw] -translate-x-1/2 rounded-xl border border-line bg-surface p-3 text-left text-xs font-normal text-ink-2 shadow-pop"
          data-testid={`help-${t.id}-text`}
        >
          <strong className="block text-sm text-ink">{t.term}</strong>
          <span className="mt-1 block">{t.text}</span>
          <Link to={`/learn?topic=${t.id}`} className="mt-2 inline-block font-medium text-accent-text underline" onClick={() => setOpen(false)}>
            More in the Learning Center
          </Link>
        </span>
      )}
    </span>
  );
}
