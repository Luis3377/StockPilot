import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from './cn';

const inputBase =
  'h-11 w-full border bg-surface px-3 text-[15px] text-ink placeholder:text-muted outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-surface-2 disabled:text-muted';

export const inputClass = `${inputBase} rounded-xl`;

const borderFor = (error?: string | null) => (error ? 'border-bad' : 'border-line-strong');

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-bad-text" aria-hidden> *</span>}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={errId} className="mt-1 text-sm text-bad-text" role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="mt-1 text-xs text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

type BaseInput = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string;
  onChange: (value: string) => void;
};

interface TextFieldProps extends BaseInput {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  suggestions?: string[];
  className?: string;
}

export function TextField({ label, hint, error, required, suggestions, className, value, onChange, ...rest }: TextFieldProps) {
  const listId = useId();
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(id, describedBy) => (
        <>
          <input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            list={suggestions?.length ? listId : undefined}
            className={cn(inputClass, borderFor(error))}
            {...rest}
          />
          {suggestions?.length ? (
            <datalist id={listId}>
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          ) : null}
        </>
      )}
    </Field>
  );
}

export function currencySymbol(currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? '$';
  } catch {
    return '$';
  }
}

interface MoneyFieldProps extends BaseInput {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  currency: string;
  className?: string;
  suffix?: ReactNode;
}

export function MoneyField({ label, hint, error, required, currency, className, value, onChange, suffix, ...rest }: MoneyFieldProps) {
  const symbol = currencySymbol(currency);
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(id, describedBy) => (
        <div className="relative flex">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted">{symbol}</span>
          <input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            className={cn(inputBase, borderFor(error), 'tabular', symbol.length > 1 ? 'pl-11' : 'pl-7', suffix ? 'rounded-l-xl' : 'rounded-xl')}
            placeholder="0.00"
            {...rest}
          />
          {suffix}
        </div>
      )}
    </Field>
  );
}

interface QuantityFieldProps extends Omit<BaseInput, 'min' | 'max'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  min?: number;
  max?: number;
  className?: string;
}

/** Whole-number input with large −/+ buttons for thumbs. */
export function QuantityField({ label, hint, error, required, min = 0, max, className, value, onChange, ...rest }: QuantityFieldProps) {
  const n = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(n);
  const step = (d: number) => {
    const base = valid ? n : min;
    let next = base + d;
    if (next < min) next = min;
    if (max !== undefined && next > max) next = max;
    onChange(String(next));
  };
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(id, describedBy) => (
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={valid && n <= min}
            aria-label="Decrease"
            className="flex w-11 items-center justify-center rounded-l-xl border border-r-0 border-line-strong bg-surface-2 text-ink-2 hover:text-ink disabled:opacity-40"
          >
            <Minus className="size-4" />
          </button>
          <input
            id={id}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            className={cn(inputBase, borderFor(error), 'tabular text-center')}
            {...rest}
          />
          <button
            type="button"
            onClick={() => step(1)}
            disabled={valid && max !== undefined && n >= max}
            aria-label="Increase"
            className="flex w-11 items-center justify-center rounded-r-xl border border-l-0 border-line-strong bg-surface-2 text-ink-2 hover:text-ink disabled:opacity-40"
          >
            <Plus className="size-4" />
          </button>
        </div>
      )}
    </Field>
  );
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function SelectField({ label, hint, error, required, value, onChange, children, className, ...rest }: SelectFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(id, describedBy) => (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={cn(inputClass, borderFor(error), 'appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9')}
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237a7974' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  );
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function TextAreaField({ label, hint, error, value, onChange, className, ...rest }: TextAreaFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, describedBy) => (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          rows={3}
          className={cn(inputClass, borderFor(error), 'h-auto min-h-[88px] py-2.5')}
          {...rest}
        />
      )}
    </Field>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-ink-2">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-surface-3',
        )}
      >
        <span className={cn('inline-block size-6 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function Segmented<T extends string>({ value, onChange, options, label, size = 'md', className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-xl bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-lg font-medium whitespace-nowrap transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-5 shrink-0 cursor-pointer rounded accent-[var(--accent)]"
      />
      <label htmlFor={id} className="cursor-pointer text-sm">
        <span className="font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-ink-2">{description}</span>}
      </label>
    </div>
  );
}
