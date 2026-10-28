// Small, dependency-free SVG/HTML charts following the StockPilot dataviz rules: thin marks,
// 4px rounded data ends, hairline solid gridlines, one y-axis, a legend for 2+ series,
// hover/focus tooltips, and a table view for every chart.

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Table2, BarChart3 } from 'lucide-react';
import { cn } from './cn';
import { Card } from './Card';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Round axis ticks whose range fully contains [min, max]. Bar charts include 0 so bars grow
 * from a real baseline; value-over-time lines may zoom to the data range.
 */
export function niceTicks(min: number, max: number, count = 4, includeZero = true): number[] {
  let lo = includeZero ? Math.min(0, min) : min;
  let hi = includeZero ? Math.max(0, max) : max;
  if (lo === hi) {
    const pad = Math.abs(hi) * 0.1 || 1;
    lo = includeZero && lo >= 0 ? lo : lo - pad;
    hi += pad;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

export interface Series {
  id: string;
  name: string;
  color: string; // CSS color, usually var(--series-n)
  values: number[];
}

function Legend({ series, kind }: { series: Series[]; kind: 'rect' | 'line' }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {series.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={kind === 'rect' ? 'size-2.5 rounded-[3px]' : 'h-0.5 w-3.5 rounded-full'}
            style={{ background: s.color }}
          />
          {s.name}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, title, rows, containerWidth }: { x: number; title: string; rows: { name: string; value: string; color: string }[]; containerWidth: number }) {
  const width = 176;
  const left = Math.min(Math.max(x - width / 2, 0), Math.max(0, containerWidth - width));
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop"
      style={{ left, width }}
      role="status"
    >
      <div className="mb-1 text-muted">{title}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: r.color }} />
            {r.name}
          </span>
          <span className="tabular font-semibold text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart card with table view
// ---------------------------------------------------------------------------

interface ChartCardProps {
  title: ReactNode;
  description?: ReactNode;
  table: { columns: string[]; rows: (string | number)[][] };
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  empty?: ReactNode;
}

export function ChartCard({ title, description, table, children, action, className, empty }: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className={cn('p-4 sm:p-5', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-ink-2">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          {!empty && (
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
              aria-pressed={showTable}
            >
              {showTable ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
              {showTable ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </div>
      {empty ? (
        <div className="flex min-h-[160px] items-center justify-center rounded-xl bg-surface-2 px-6 text-center text-sm text-ink-2">{empty}</div>
      ) : showTable ? (
        <div className="max-h-[320px] overflow-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-2">
              <tr>
                {table.columns.map((c, i) => (
                  <th key={c} className={cn('px-3 py-2 font-medium', i > 0 && 'text-right')}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {table.rows.map((r, ri) => (
                <tr key={ri} className="border-t border-line">
                  {r.map((cell, ci) => (
                    <td key={ci} className={cn('px-3 py-2 text-ink', ci > 0 && 'text-right')}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Column chart (grouped vertical bars, supports negative values)
// ---------------------------------------------------------------------------

interface ColumnChartProps {
  labels: string[];
  series: Series[];
  format: (v: number) => string;
  formatAxis: (v: number) => string;
  height?: number;
  ariaLabel: string;
}

function barPath(x: number, w: number, y0: number, y1: number, r: number): string {
  // Rounded on the data end only; square where it meets the baseline.
  const h = Math.abs(y1 - y0);
  const rr = Math.min(r, h, w / 2);
  if (h < 0.5) return '';
  if (y1 < y0) {
    return `M${x},${y0} V${y1 + rr} Q${x},${y1} ${x + rr},${y1} H${x + w - rr} Q${x + w},${y1} ${x + w},${y1 + rr} V${y0} Z`;
  }
  return `M${x},${y0} V${y1 - rr} Q${x},${y1} ${x + rr},${y1} H${x + w - rr} Q${x + w},${y1} ${x + w},${y1 - rr} V${y0} Z`;
}

export function ColumnChart({ labels, series, format, formatAxis, height = 220, ariaLabel }: ColumnChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(...all, 0), Math.max(...all, 0));
  const left = 52;
  const bottom = 24;
  const top = 8;
  const plotW = Math.max(0, width - left - 4);
  const plotH = height - top - bottom;
  const min = ticks[0];
  const max = ticks[ticks.length - 1];
  const y = (v: number) => top + ((max - v) / (max - min || 1)) * plotH;
  const band = labels.length ? plotW / labels.length : 0;
  const gap = 2;
  const barW = Math.max(3, Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const labelEvery = Math.ceil(labels.length / Math.max(1, Math.floor(plotW / 48)));

  return (
    <div className="space-y-2">
      <Legend series={series} kind="rect" />
      <div ref={ref} className="relative" style={{ height }} onMouseLeave={() => setActive(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} className="overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={width - 4} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} shapeRendering="crispEdges" />
                <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-[var(--muted)] text-[11px]">
                  {formatAxis(t)}
                </text>
              </g>
            ))}
            {labels.map((label, i) => {
              const gx = left + i * band + (band - groupW) / 2;
              return (
                <g key={label}>
                  {active === i && <rect x={left + i * band} y={top} width={band} height={plotH} fill="var(--surface-2)" />}
                  {series.map((s, si) => (
                    <path key={s.id} d={barPath(gx + si * (barW + gap), barW, y(0), y(s.values[i]), 4)} fill={s.color} />
                  ))}
                  {i % labelEvery === 0 && (
                    <text x={left + i * band + band / 2} y={height - 6} textAnchor="middle" className="fill-[var(--muted)] text-[11px]">
                      {label}
                    </text>
                  )}
                  <rect
                    x={left + i * band}
                    y={top}
                    width={band}
                    height={plotH}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${label}: ${series.map((s) => `${s.name} ${format(s.values[i])}`).join(', ')}`}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    onClick={() => setActive(i)}
                    className="outline-none"
                  />
                </g>
              );
            })}
          </svg>
        )}
        {active !== null && width > 0 && (
          <Tooltip
            x={left + active * band + band / 2}
            containerWidth={width}
            title={labels[active]}
            rows={series.map((s) => ({ name: s.name, value: format(s.values[active]), color: s.color }))}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line chart (time series, one or two series, area wash for a single series)
// ---------------------------------------------------------------------------

interface LineChartProps {
  labels: string[];
  series: Series[];
  format: (v: number) => string;
  formatAxis: (v: number) => string;
  height?: number;
  ariaLabel: string;
  zeroBased?: boolean;
}

export function LineChart({ labels, series, format, formatAxis, height = 220, ariaLabel, zeroBased = false }: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const ticks = useMemo(() => niceTicks(lo, hi, 4, zeroBased || lo <= 0), [lo, hi, zeroBased]);
  const left = 56;
  const bottom = 24;
  const top = 10;
  const plotW = Math.max(0, width - left - 12);
  const plotH = height - top - bottom;
  const min = ticks[0];
  const max = ticks[ticks.length - 1];
  const x = (i: number) => left + (labels.length <= 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (v: number) => top + ((max - v) / (max - min || 1)) * plotH;
  const tickIdx = labels.length <= 1 ? [0] : [0, Math.floor((labels.length - 1) / 2), labels.length - 1];

  const onMove = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || labels.length === 0) return;
    const rel = clientX - rect.left - left;
    const i = labels.length <= 1 ? 0 : Math.round((rel / plotW) * (labels.length - 1));
    setActive(Math.max(0, Math.min(labels.length - 1, i)));
  };

  return (
    <div className="space-y-2">
      <Legend series={series} kind="line" />
      <div
        ref={ref}
        className="relative touch-pan-y"
        style={{ height }}
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseLeave={() => setActive(null)}
        onTouchStart={(e) => onMove(e.touches[0].clientX)}
        onTouchMove={(e) => onMove(e.touches[0].clientX)}
        tabIndex={0}
        role="group"
        aria-label={ariaLabel}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setActive((a) => Math.min(labels.length - 1, (a ?? -1) + 1));
          if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? labels.length) - 1));
        }}
        onBlur={() => setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} aria-hidden className="overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={width - 12} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} shapeRendering="crispEdges" />
                <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-[var(--muted)] text-[11px]">
                  {formatAxis(t)}
                </text>
              </g>
            ))}
            <line x1={left} x2={width - 12} y1={top + plotH} y2={top + plotH} stroke="var(--axis)" strokeWidth={1} shapeRendering="crispEdges" />
            {tickIdx.map((i) => (
              <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'} className="fill-[var(--muted)] text-[11px]">
                {labels[i]}
              </text>
            ))}
            {series.length === 1 && labels.length > 1 && (
              <path
                d={`M${x(0)},${y(series[0].values[0])} ${series[0].values.map((v, i) => `L${x(i)},${y(v)}`).join(' ')} L${x(labels.length - 1)},${top + plotH} L${x(0)},${top + plotH} Z`}
                fill={series[0].color}
                opacity={0.1}
              />
            )}
            {series.map((s) => (
              <path
                key={s.id}
                d={s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {series.map((s) => (
              <circle key={s.id} cx={x(labels.length - 1)} cy={y(s.values[s.values.length - 1])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
            {active !== null && (
              <g>
                <line x1={x(active)} x2={x(active)} y1={top} y2={top + plotH} stroke="var(--axis)" strokeWidth={1} />
                {series.map((s) => (
                  <circle key={s.id} cx={x(active)} cy={y(s.values[active])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
        )}
        {active !== null && width > 0 && (
          <Tooltip
            x={x(active)}
            containerWidth={width}
            title={labels[active]}
            rows={series.map((s) => ({ name: s.name, value: format(s.values[active]), color: s.color }))}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar list (horizontal bars as HTML; one series; supports negatives)
// ---------------------------------------------------------------------------

interface BarListProps {
  rows: { key: string; label: ReactNode; value: number; sub?: ReactNode }[];
  format: (v: number) => string;
  color?: string;
}

export function BarList({ rows, format, color = 'var(--series-1)' }: BarListProps) {
  const [hover, setHover] = useState<string | null>(null);
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const hasNeg = rows.some((r) => r.value < 0);
  const maxPos = Math.max(0, ...rows.map((r) => r.value));
  const maxNeg = Math.max(0, ...rows.map((r) => -r.value));
  const span = hasNeg ? maxPos + maxNeg || 1 : maxAbs;
  const zero = hasNeg ? (maxNeg / span) * 100 : 0;
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const pct = (Math.abs(r.value) / span) * 100;
        const neg = r.value < 0;
        return (
          <li key={r.key} onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink">{r.label}</span>
              <span className="tabular shrink-0 font-medium text-ink">{format(r.value)}</span>
            </div>
            <div className="relative h-2 rounded-full bg-surface-2">
              {hasNeg && <div className="absolute inset-y-[-3px] w-px bg-[var(--axis)]" style={{ left: `${zero}%` }} aria-hidden />}
              <div
                className={cn('absolute inset-y-0 transition-opacity', neg ? 'rounded-l-[4px]' : 'rounded-r-[4px]', hover && hover !== r.key && 'opacity-60')}
                style={{
                  left: neg ? `${zero - pct}%` : `${zero}%`,
                  width: `${Math.max(pct, r.value === 0 ? 0 : 0.8)}%`,
                  background: color,
                }}
              />
            </div>
            {r.sub && <div className="mt-1 text-xs text-ink-2">{r.sub}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** Quantity vs. alert level as a same-ramp meter. */
export function StockMeter({ quantity, threshold }: { quantity: number; threshold: number }) {
  const max = Math.max(threshold * 2, quantity, 1);
  const pct = Math.min(100, (quantity / max) * 100);
  const color = quantity === 0 ? 'var(--bad)' : quantity <= threshold ? 'var(--warn)' : 'var(--series-1)';
  return (
    <div className="relative h-1.5 w-full rounded-full bg-surface-3" aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: color }} />
      <div className="absolute inset-y-[-3px] w-px bg-ink-2" style={{ left: `${(threshold / max) * 100}%` }} />
    </div>
  );
}
