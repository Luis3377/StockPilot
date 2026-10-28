import { useEffect, type RefObject } from 'react';

/** Calls `onOutside` on a tap/click outside `ref`, or on Escape, while `active`. */
export function useClickOutside(ref: RefObject<HTMLElement | null>, active: boolean, onOutside: () => void) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOutside();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOutside();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, active, onOutside]);
}
