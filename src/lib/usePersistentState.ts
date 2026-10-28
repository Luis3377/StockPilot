import { useEffect, useState } from 'react';

/** UI preference remembered per browser (e.g. the selected period). Never used for records. */
export function usePersistentState<T extends string>(key: string, initial: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(`stockpilot-ui:${key}`) as T | null;
      return v && allowed.includes(v) ? v : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`stockpilot-ui:${key}`, value);
    } catch {
      // Not critical.
    }
  }, [key, value]);
  return [value, setValue];
}
