import { PERIOD_OPTIONS, type PeriodKey } from '../domain/dates';
import { cn } from './cn';

/** Date-range presets in one row; scrolls sideways on narrow phones. */
export function PeriodPicker({ value, onChange, className }: { value: PeriodKey; onChange: (p: PeriodKey) => void; className?: string }) {
  return (
    <div className={cn('-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0', className)}>
      <div role="radiogroup" aria-label="Time period" className="inline-flex rounded-xl bg-surface-2 p-1">
        {PERIOD_OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={value === o.key}
            onClick={() => onChange(o.key)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
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
