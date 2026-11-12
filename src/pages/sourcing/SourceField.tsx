// "Where you bought it": pick a registered source, or type a new one and choose its type. Close
// spellings of an existing source are pointed out before a duplicate is created. Separate from
// the storage location (where the item is kept now).

import { useId } from 'react';
import { findSourceByName, similarSources, SOURCE_TYPE_LABELS, SOURCE_TYPES } from '../../domain/sourcing';
import type { SourceType, SourcingSession } from '../../domain/types';
import { useAppState } from '../../data/store';
import { formatDate } from '../../domain/dates';
import { SelectField, TextField } from '../../ui/Fields';

export interface SourceDraft {
  text: string;
  type: SourceType;
  sessionId: string;
}

export function SourceField({ value, onChange, error, className }: { value: SourceDraft; onChange: (v: SourceDraft) => void; error?: string; className?: string }) {
  const data = useAppState((s) => s.data);
  const typeId = useId();
  const sources = data.sourcing.sources;
  // Your sources, plus names typed on lots before they were sources (as the field offered before).
  const suggestions = [...new Set([...sources.map((s) => s.name), ...data.lots.map((l) => l.source.trim()).filter((t) => t && !findSourceByName(data, t))])].sort((a, b) => a.localeCompare(b));
  const text = value.text.trim();
  const match = text ? findSourceByName(data, text) : undefined;
  const similar = text && !match ? similarSources(data, text) : [];
  return (
    <div className={className} data-testid="source-field">
      <TextField
        label="Where you bought it"
        value={value.text}
        onChange={(v) => onChange({ ...value, text: v })}
        suggestions={suggestions}
        placeholder="e.g. Goodwill — West Little Rock"
        maxLength={120}
        error={error}
        hint={match ? `${SOURCE_TYPE_LABELS[match.type]}${match.name !== text ? ` · saved as “${match.name}”` : ''}` : text ? undefined : 'Optional. The store, sale or supplier, not where you keep it.'}
      />
      {similar.length > 0 && (
        <p className="mt-1 text-xs text-warn-text" data-testid="source-similar">
          Did you mean{' '}
          {similar.slice(0, 3).map((s, i) => (
            <span key={s.id}>
              {i > 0 && ' or '}
              <button type="button" className="font-medium underline" onClick={() => onChange({ ...value, text: s.name })}>
                {s.name}
              </button>
            </span>
          ))}
          ? Otherwise a new source is added.
        </p>
      )}
      {text && !match && (
        <SelectField
          className="mt-2"
          label={<span id={typeId}>New source: type</span>}
          value={value.type}
          onChange={(v) => onChange({ ...value, type: v as SourceType })}
          hint={`“${text}” will be added to your sources.`}
          data-testid="source-type"
        >
          {SOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {SOURCE_TYPE_LABELS[t]}
            </option>
          ))}
        </SelectField>
      )}
    </div>
  );
}

export function TripField({ value, onChange, className }: { value: string; onChange: (id: string) => void; className?: string }) {
  const sessions = useAppState((s) => s.data.sourcing.sessions);
  if (!sessions.length) return null;
  return (
    <SelectField label="Sourcing trip (optional)" value={value} onChange={onChange} className={className} data-testid="trip-field">
      <option value="">None</option>
      {[...sessions]
        .sort((a: SourcingSession, b: SourcingSession) => b.date.localeCompare(a.date))
        .map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({formatDate(s.date)})
          </option>
        ))}
    </SelectField>
  );
}
