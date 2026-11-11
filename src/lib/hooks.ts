import { useCallback, useMemo } from 'react';
import { useAppState } from '../data/store';
import { buildInsights } from '../insights/rules';
import { formatMoney, formatMoneyCompact } from '../domain/money';
import { PERIOD_OPTIONS, periodRange, todayISO, type PeriodKey } from '../domain/dates';
import { usePersistentState } from './usePersistentState';

const PERIOD_KEYS = PERIOD_OPTIONS.map((p) => p.key);

/**
 * The reporting period chosen on the dashboard, shared with Smart Insights so the same metric
 * with the same period always shows the same number in both places.
 */
export function useReportingPeriod(): [PeriodKey, (p: PeriodKey) => void] {
  return usePersistentState<PeriodKey>('overview-period', 'this_month', PERIOD_KEYS);
}

export function useMoney() {
  const currency = useAppState((s) => s.settings.currency);
  const money = useCallback((n: number) => formatMoney(n, currency), [currency]);
  const compact = useCallback((n: number) => formatMoneyCompact(n, currency), [currency]);
  return { money, compact, currency };
}

/** Insights for the current data. Sales-based sections cover `period` (all time if omitted). */
export function useInsights(period?: PeriodKey) {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const today = todayISO();
  return useMemo(() => buildInsights(data, settings, today, periodRange(period ?? 'all', today)), [data, settings, today, period]);
}
