import { useCallback, useMemo } from 'react';
import { useAppState } from '../data/store';
import { buildInsights } from '../insights/rules';
import { formatMoney, formatMoneyCompact } from '../domain/money';
import { todayISO } from '../domain/dates';

export function useMoney() {
  const currency = useAppState((s) => s.settings.currency);
  const money = useCallback((n: number) => formatMoney(n, currency), [currency]);
  const compact = useCallback((n: number) => formatMoneyCompact(n, currency), [currency]);
  return { money, compact, currency };
}

export function useInsights() {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const today = todayISO();
  return useMemo(() => buildInsights(data, settings, today), [data, settings, today]);
}
