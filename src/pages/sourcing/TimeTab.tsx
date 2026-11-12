// Time log: a start/pause/stop timer (saved with your data, so closing the app or switching
// screens doesn't lose it), manual entries, and the history with edit and delete. Time can be
// linked to trips, sources, lots or items; when it covers several, it's split once, equally or
// by the shares you set.

import { useEffect, useState } from 'react';
import { Pause, Pencil, Play, Plus, Square, Trash2, X } from 'lucide-react';
import {
  ACTIVITIES,
  ACTIVITY_LABELS,
  addTimeEntry,
  deleteTimeEntry,
  discardTimer,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  timerElapsedMs,
  updateTimeEntry,
} from '../../domain/sourcing';
import { formatDate, todayISO } from '../../domain/dates';
import { isDomainError } from '../../domain/errors';
import type { TimeActivity, TimeEntry, TimeLink, TimeLinkKind } from '../../domain/types';
import { store, useAppState } from '../../data/store';
import { useAction } from '../../lib/useAction';
import { Card, SectionHeader } from '../../ui/Card';
import { Button, IconButton } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { SelectField, TextField } from '../../ui/Fields';
import { useConfirm } from '../../ui/Confirm';
import { useToast } from '../../ui/Toast';
import { LinkText, minutesText } from './parts';

const KIND_LABELS: Record<TimeLinkKind, string> = { session: 'Trip', source: 'Source', lot: 'Bulk lot', item: 'Item' };

function useTargets() {
  const data = useAppState((s) => s.data);
  return {
    session: data.sourcing.sessions.map((s) => ({ id: s.id, label: `${s.name} (${formatDate(s.date)})` })),
    source: data.sourcing.sources.map((s) => ({ id: s.id, label: s.name })),
    lot: data.lots.map((l) => ({ id: l.id, label: l.name })),
    item: data.items.map((i) => ({ id: i.id, label: i.name })),
  } as Record<TimeLinkKind, { id: string; label: string }[]>;
}

/** Rows of "what this time was for"; shares appear when splitting by custom percentages. */
function LinkEditor({ links, onChange, custom }: { links: TimeLink[]; onChange: (l: TimeLink[]) => void; custom: boolean }) {
  const targets = useTargets();
  const kinds = (Object.keys(KIND_LABELS) as TimeLinkKind[]).filter((k) => targets[k].length);
  return (
    <fieldset className="space-y-2" data-testid="time-links">
      <legend className="text-sm font-medium text-ink">What was it for? (optional)</legend>
      {links.map((l, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2" data-testid="time-link">
          <SelectField className="w-28" label={<span className="sr-only">Link {i + 1} kind</span>} value={l.kind} onChange={(v) => onChange(links.map((x, n) => (n === i ? { ...x, kind: v as TimeLinkKind, id: targets[v as TimeLinkKind][0]?.id ?? '' } : x)))}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </SelectField>
          <SelectField className="min-w-0 flex-1" label={<span className="sr-only">Link {i + 1}</span>} value={l.id} onChange={(v) => onChange(links.map((x, n) => (n === i ? { ...x, id: v } : x)))}>
            {targets[l.kind].map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </SelectField>
          {custom && (
            <TextField
              className="w-24"
              label={<span className="sr-only">Link {i + 1} share (%)</span>}
              inputMode="decimal"
              value={l.sharePct === null ? '' : String(l.sharePct)}
              onChange={(v) => onChange(links.map((x, n) => (n === i ? { ...x, sharePct: v.trim() === '' ? null : Number(v) } : x)))}
              placeholder="%"
            />
          )}
          <IconButton label={`Remove link ${i + 1}`} onClick={() => onChange(links.filter((_, n) => n !== i))}>
            <X className="size-4" />
          </IconButton>
        </div>
      ))}
      {kinds.length > 0 ? (
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => onChange([...links, { kind: kinds[0], id: targets[kinds[0]][0].id, sharePct: null }])} data-testid="time-add-link">
          Link to a trip, source, lot or item
        </Button>
      ) : (
        <p className="text-xs text-muted">Add a source, trip, lot or item first to link time to it. Unlinked time counts as general work.</p>
      )}
    </fieldset>
  );
}

function TimerCard() {
  const timer = useAppState((s) => s.data.sourcing.timer);
  const data = useAppState((s) => s.data);
  const run = useAction();
  const [, tick] = useState(0);
  const [activity, setActivity] = useState<TimeActivity>('sourcing');
  const [links, setLinks] = useState<TimeLink[]>([]);
  useEffect(() => {
    if (!timer?.runningSince) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [timer?.runningSince]);
  const elapsed = timer ? timerElapsedMs(timer) : 0;
  const hms = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  return (
    <Card className="p-4 sm:p-5" data-testid="timer">
      <SectionHeader title="Timer" description="Keeps counting if you close the app or switch screens: it’s saved with your data." />
      {timer ? (
        <div className="mt-3 space-y-3">
          <p className="tabular text-3xl font-semibold text-ink" data-testid="timer-elapsed" aria-live="off">
            {hms(elapsed)}
          </p>
          <p className="text-sm text-ink-2">
            {ACTIVITY_LABELS[timer.activity]} · started {new Date(timer.startedAt).toLocaleString()} · {timer.runningSince ? 'running' : 'paused'}
            {timer.links.map((l) => (
              <span key={`${l.kind}:${l.id}`}>
                {' · '}
                <LinkText data={data} link={l} />
              </span>
            ))}
          </p>
          <div className="flex flex-wrap gap-2">
            {timer.runningSince ? (
              <Button icon={<Pause className="size-4" />} onClick={() => run(() => store.update((d) => pauseTimer(d)))} data-testid="timer-pause">
                Pause
              </Button>
            ) : (
              <Button icon={<Play className="size-4" />} onClick={() => run(() => store.update((d) => resumeTimer(d)))} data-testid="timer-resume">
                Resume
              </Button>
            )}
            <Button variant="primary" icon={<Square className="size-4" />} onClick={() => run(() => store.commit((d) => stopTimer(d)), 'Saved the time to your log.')} data-testid="timer-stop">
              Stop and save
            </Button>
            <Button variant="ghost" onClick={() => run(() => store.update((d) => discardTimer(d)), 'Timer discarded.')}>
              Discard
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <SelectField label="Activity" value={activity} onChange={(v) => setActivity(v as TimeActivity)} data-testid="timer-activity">
            {ACTIVITIES.map((a) => (
              <option key={a} value={a}>
                {ACTIVITY_LABELS[a]}
              </option>
            ))}
          </SelectField>
          <LinkEditor links={links} onChange={setLinks} custom={false} />
          <Button variant="primary" icon={<Play className="size-4" />} onClick={() => run(() => store.update((d) => startTimer(d, { activity, links })))} data-testid="timer-start">
            Start timer
          </Button>
        </div>
      )}
    </Card>
  );
}

function EntryDialog({ entry, open, onClose }: { entry: TimeEntry | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [hours, setHours] = useState('');
  const [mins, setMins] = useState('');
  const [activity, setActivity] = useState<TimeActivity>('sourcing');
  const [note, setNote] = useState('');
  const [links, setLinks] = useState<TimeLink[]>([]);
  const [split, setSplit] = useState<'equal' | 'custom'>('equal');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setDate(entry?.date ?? todayISO());
    setHours(entry ? String(Math.floor(entry.minutes / 60)) : '');
    setMins(entry ? String(entry.minutes % 60) : '');
    setActivity(entry?.activity ?? 'sourcing');
    setNote(entry?.note ?? '');
    setLinks(entry?.links ?? []);
    setSplit(entry?.split ?? 'equal');
    setErrors({});
  }, [open, entry]);
  const save = () => {
    const h = hours.trim() === '' ? 0 : Number(hours);
    const m = mins.trim() === '' ? 0 : Number(mins);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0) return setErrors({ minutes: 'Enter whole hours and minutes.' });
    const input = { date, minutes: h * 60 + m || null, activity, note, links, split };
    try {
      store.commit((d) => (entry ? updateTimeEntry(d, entry.id, input) : addTimeEntry(d, input)));
      toast.success(entry ? 'Time entry updated.' : 'Time logged.');
      onClose();
    } catch (e) {
      if (!isDomainError(e)) throw e;
      setErrors(Object.keys(e.fields).length ? e.fields : { form: e.message });
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={entry ? 'Edit time' : 'Log time'}
      dismissOnBackdrop={false}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} data-testid="time-save">
            Save
          </Button>
        </div>
      }
      testId="time-dialog"
    >
      <div className="space-y-3">
        {errors.form && (
          <p className="text-sm text-bad-text" role="alert">
            {errors.form}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TextField className="col-span-2" label="Date" type="date" value={date} onChange={setDate} error={errors.date} />
          <TextField label="Hours" inputMode="numeric" value={hours} onChange={setHours} data-testid="time-hours" />
          <TextField label="Minutes" inputMode="numeric" value={mins} onChange={setMins} data-testid="time-minutes" />
        </div>
        {errors.minutes && (
          <p className="text-sm text-bad-text" role="alert">
            {errors.minutes}
          </p>
        )}
        <SelectField label="Activity" value={activity} onChange={(v) => setActivity(v as TimeActivity)} data-testid="time-activity">
          {ACTIVITIES.map((a) => (
            <option key={a} value={a}>
              {ACTIVITY_LABELS[a]}
            </option>
          ))}
        </SelectField>
        <LinkEditor links={links} onChange={setLinks} custom={split === 'custom' && links.length > 1} />
        {links.length > 1 && (
          <SelectField label="Split the time between them" value={split} onChange={(v) => setSplit(v as 'equal' | 'custom')} hint="Each minute is counted once, divided between the links." data-testid="time-split">
            <option value="equal">Equally</option>
            <option value="custom">By the shares I set (%)</option>
          </SelectField>
        )}
        {errors.links && (
          <p className="text-sm text-bad-text" role="alert">
            {errors.links}
          </p>
        )}
        <TextField label="Note (optional)" value={note} onChange={setNote} maxLength={500} />
      </div>
    </Dialog>
  );
}

export function TimeTab() {
  const data = useAppState((s) => s.data);
  const confirm = useConfirm();
  const run = useAction();
  const [editing, setEditing] = useState<TimeEntry | null | 'new'>(null);
  const entries = [...data.sourcing.timeEntries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const remove = async (e: TimeEntry) => {
    if (await confirm({ title: 'Delete this time entry?', message: `${minutesText(e.minutes)} of ${ACTIVITY_LABELS[e.activity].toLowerCase()} on ${formatDate(e.date)}.`, confirmLabel: 'Delete', tone: 'danger' })) {
      run(() => store.update((d) => deleteTimeEntry(d, e.id)), 'Time entry deleted.');
    }
  };
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <TimerCard />
      <Card className="p-4 sm:p-5" data-testid="time-log">
        <SectionHeader
          title="Work sessions"
          description="Time you’ve logged. It’s used for profit per hour and never subtracted from profit."
          action={
            <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')} data-testid="time-new">
              Log time
            </Button>
          }
        />
        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-ink-2">No time logged yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-2 py-2" data-testid="time-entry">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="text-ink">
                    <span className="font-medium">{minutesText(e.minutes)}</span> · {ACTIVITY_LABELS[e.activity]} · {formatDate(e.date)}
                  </p>
                  <p className="text-xs text-ink-2">
                    {e.links.length === 0
                      ? 'General work (not linked)'
                      : e.links.map((l, i) => (
                          <span key={`${l.kind}:${l.id}`}>
                            {i > 0 && ' · '}
                            <LinkText data={data} link={l} />
                            {e.split === 'custom' && l.sharePct !== null && ` (${l.sharePct}%)`}
                          </span>
                        ))}
                    {e.links.length > 1 && e.split === 'equal' && ' (split equally)'}
                    {e.note && ` · ${e.note}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <IconButton label={`Edit ${minutesText(e.minutes)} on ${formatDate(e.date)}`} onClick={() => setEditing(e)}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton label={`Delete ${minutesText(e.minutes)} on ${formatDate(e.date)}`} onClick={() => void remove(e)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <EntryDialog entry={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </div>
  );
}
