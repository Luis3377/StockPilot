/**
 * A user-facing validation error. `field` points a form at the input to highlight; `fields`
 * holds every problem found, so a form can show them all after one submit.
 */
export class DomainError extends Error {
  readonly field?: string;
  readonly fields: Record<string, string>;
  constructor(message: string, field?: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'DomainError';
    this.field = field;
    this.fields = fields ?? (field ? { [field]: message } : {});
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

/** Collects field errors so validation reports every problem in one pass. */
export class FieldErrors {
  readonly errors: Record<string, string> = {};

  /** Runs one field check; a field error is recorded instead of thrown. */
  check<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch (e) {
      if (e instanceof DomainError && e.field) {
        this.add(e.field, e.message);
        return undefined;
      }
      throw e;
    }
  }

  /** Records an error for a field (the first one per field wins). */
  add(field: string, message: string): void {
    if (!(field in this.errors)) this.errors[field] = message;
  }

  /** Throws one DomainError carrying every collected error, the first as its message. */
  throwIfAny(): void {
    const [first] = Object.entries(this.errors);
    if (first) throw new DomainError(first[1], first[0], { ...this.errors });
  }
}
