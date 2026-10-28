/** A user-facing validation error. `field` points a form at the input to highlight. */
export class DomainError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'DomainError';
    this.field = field;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
