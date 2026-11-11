// The private-beta invite code, kept only in this browser (never in backups or exports).

import { useSyncExternalStore } from 'react';

const KEY = 'stockpilot-scan-invite-code';
const listeners = new Set<() => void>();
let memory: string | null = null;

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return memory;
  }
}

export function getTesterCode(): string | null {
  return read();
}

export function setTesterCode(code: string | null): void {
  const value = code?.trim() || null;
  memory = value;
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: keep it for this session only.
  }
  for (const l of listeners) l();
}

export function useTesterCode(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => null,
  );
}
