// A small "?" next to a financial term: opens a plain-English explanation (from help.ts) with a
// link to the Learning Center. Keyboard: Enter/Space opens, Escape closes; screen readers get the
// button's question and the expanded state. The panel stays inside the screen on phones.

import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleHelp } from 'lucide-react';
import { helpTopic } from './help';
import { useClickOutside } from '../lib/useClickOutside';
import { cn } from '../ui/cn';

const WIDTH = 288;
const GUTTER = 8;

export function HelpTip({ topic, className }: { topic: string; className?: string }) {
  const t = helpTopic(topic);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; width: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  useClickOutside(
    ref,
    open,
    useCallback(() => setOpen(false), []),
  );

  // Centered under the icon, but never past either edge of the screen.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const vw = document.documentElement.clientWidth;
      const width = Math.min(WIDTH, vw - GUTTER * 2);
      const left = Math.min(Math.max(GUTTER, r.left + r.width / 2 - width / 2), vw - width - GUTTER);
      setPlace({ left: left - r.left, width });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  return (
    <span ref={ref} className={cn('relative inline-flex align-middle', className)} onKeyDown={(e) => e.key === 'Escape' && open && (e.stopPropagation(), setOpen(false))}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`What is ${t.term.toLowerCase()}?`}
        className="-m-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted hover:text-ink"
        data-testid={`help-${t.id}`}
      >
        <CircleHelp className="size-3.5" />
      </button>
      {open && (
        <span
          id={panelId}
          role="note"
          className="absolute top-6 z-40 block rounded-xl border border-line bg-surface p-3 text-left text-xs leading-5 font-normal text-ink-2 shadow-pop"
          style={place ? { left: place.left, width: place.width } : { left: 0, width: WIDTH, visibility: 'hidden' }}
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
