import { PERIOD_OPTIONS, type PeriodKey } from '../domain/dates';
import { cn } from './cn';

/** Date-range presets in one row; wraps onto a second row on narrow phones so none is hidden. */
export function PeriodPicker({ value, onChange, className }: { value: PeriodKey; onChange: (p: PeriodKey) => void; className?: string }) {
  return (
    <div className={className}>
      <div role="radiogroup" aria-label="Time period" className="flex w-full flex-wrap rounded-xl bg-surface-2 p-1 sm:inline-flex sm:w-auto">
        {PERIOD_OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={value === o.key}
            onClick={() => onChange(o.key)}
            className={cn(
              'flex-auto rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors sm:flex-none',
              value === o.key ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
