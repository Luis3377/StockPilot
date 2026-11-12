// Pieces shared by the Sourcing Performance pages.

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AppData, TimeLink } from '../../domain/types';
import { formatDate } from '../../domain/dates';
import { cn } from '../../ui/cn';

export const hoursText = (h: number) => (h === 0 ? '0 h' : `${Number(h.toFixed(2))} h`);
export const pctText = (n: number | null) => (n === null ? '—' : `${n}%`);

export function minutesText(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h ? `${h} h${min ? ` ${min} min` : ''}` : `${min} min`;
}

/** The URL key for a source (ids are URL-safe; text keys and "unassigned" are encoded). */
export const sourceHref = (key: string) => `/insights/sourcing/source/${encodeURIComponent(key)}`;

/** A time link in words, with a link to the record when it still exists. */
export function linkLabel(data: AppData, l: TimeLink): { label: string; href: string | null } {
  switch (l.kind) {
    case 'session': {
      const s = data.sourcing.sessions.find((x) => x.id === l.id);
      return s ? { label: `Trip: ${s.name} (${formatDate(s.date)})`, href: `/insights/sourcing/trips/${s.id}` } : { label: 'Deleted trip', href: null };
    }
    case 'source': {
      const s = data.sourcing.sources.find((x) => x.id === l.id);
      return s ? { label: `Source: ${s.name}`, href: sourceHref(s.id) } : { label: 'Deleted source', href: null };
    }
    case 'lot': {
      const lot = data.lots.find((x) => x.id === l.id);
      return lot ? { label: `Lot: ${lot.name}`, href: `/inventory/lots/${lot.id}` } : { label: 'Deleted lot', href: null };
    }
    case 'item': {
      const item = data.items.find((x) => x.id === l.id);
      return item ? { label: `Item: ${item.name}`, href: `/inventory/${item.id}` } : { label: 'Deleted item', href: null };
    }
  }
}

export function LinkText({ data, link }: { data: AppData; link: TimeLink }) {
  const { label, href } = linkLabel(data, link);
  return href ? (
    <Link to={href} className="text-accent-text hover:underline">
      {label}
    </Link>
  ) : (
    <span className="text-muted">{label}</span>
  );
}

/** A two-column figure list that stays readable on phones. */
export function Figures({ rows, className }: { rows: [ReactNode, ReactNode, string?][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3', className)}>
      {rows.map(([k, v, tone], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className={cn('tabular break-words', tone ?? 'text-ink')}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A table that scrolls sideways inside itself on phones, reachable by keyboard. */
export function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}
