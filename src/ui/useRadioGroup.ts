import { useRef, type KeyboardEvent } from 'react';

/**
 * Keyboard behaviour for a group of `role="radio"` buttons, following the WAI-ARIA radio
 * group pattern: the group is a single Tab stop (the checked option, or the first one), and
 * the arrow keys move focus and select. Home / End jump to the first / last option.
 *
 *   const radio = useRadioGroup(values, value, onChange);
 *   <button role="radio" aria-checked={…} {...radio(v)} />
 */
export function useRadioGroup<T extends string>(values: readonly T[], value: T | null, onChange: (v: T) => void) {
  const refs = useRef(new Map<T, HTMLButtonElement | null>());
  const tabStop = value !== null && values.includes(value) ? value : values[0];

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, current: T) => {
    const i = values.indexOf(current);
    const last = values.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (i + 1) % values.length
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (i - 1 + values.length) % values.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    const target = values[next];
    if (target !== value) onChange(target);
    refs.current.get(target)?.focus();
  };

  return (v: T) => ({
    ref: (el: HTMLButtonElement | null) => {
      refs.current.set(v, el);
    },
    tabIndex: v === tabStop ? 0 : -1,
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => onKeyDown(e, v),
  });
}
