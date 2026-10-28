import { useCallback } from 'react';
import { isDomainError } from '../domain/errors';
import { useToast } from '../ui/Toast';

/** Runs a store change and reports problems as a toast. Returns the result, or null when it failed. */
export function useAction() {
  const toast = useToast();
  return useCallback(
    <T,>(fn: () => T, success?: string): T | null => {
      try {
        const result = fn();
        if (success) toast.success(success);
        return result;
      } catch (e) {
        toast.error(isDomainError(e) ? e.message : 'Something went wrong. Your data was not changed.');
        if (!isDomainError(e)) console.error(e);
        return null;
      }
    },
    [toast],
  );
}
