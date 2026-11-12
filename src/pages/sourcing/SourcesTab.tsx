// Sources: add, edit, rename and merge where you buy; register names typed on lots; assign a
// source to records that have none. Every change is explicit and listed in the change log.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GitMerge, Pencil, Plus, Trash2 } from 'lucide-react';
import { createSource, deleteSource, guessSourceType, mergeSources, assignSource, similarSources, SOURCE_TYPE_LABELS, SOURCE_TYPES, updateSource } from '../../domain/sourcing';
import { lotSource, itemSource, UNASSIGNED_KEY } from '../../insights/sourcing';
import { formatDateTime } from '../../domain/dates';
import { isDomainError } from '../../domain/errors';
import { lotForItem } from '../../domain/lots';
import type { Source, SourceType } from '../../domain/types';
import { store, useAppState } from '../../data/store';
import { useAction } from '../../lib/useAction';
import { Card, SectionHeader } from '../../ui/Card';
import { Button, IconButton } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../ui/Fields';
import { useConfirm } from '../../ui/Confirm';
import { useToast } from '../../ui/Toast';
import { sourceHref } from './parts';

export function SourcesTab() {
  const data = useAppState((s) => s.data);
  const run = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Source | null | 'new'>(null);
  const [merging, setMerging] = useState<Source | null>(null);
  const [prefill, setPrefill] = useState<{ name: string; type: SourceType } | null>(null);
  const sources = [...data.sourcing.sources].sort((a, b) => a.name.localeCompare(b.name));

  // Lot names that aren't registered sources yet.
  const unregistered = [...new Map(data.lots.map((l) => lotSource(data, l)).filter((r) => !r.registered && r.key !== UNASSIGNED_KEY).map((r) => [r.key, r])).values()];
  const unassignedLots = data.lots.filter((l) => lotSource(data, l).key === UNASSIGNED_KEY);
  const unassignedItems = data.items.filter((i) => !lotForItem(data, i.id) && itemSource(data, i).key === UNASSIGNED_KEY);

  const remove = async (s: Source) => {
    if (await confirm({ title: `Delete “${s.name}”?`, message: 'Only a source nothing refers to can be deleted.', confirmLabel: 'Delete', tone: 'danger' })) run(() => store.update((d) => deleteSource(d, s.id)), 'Source deleted.');
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5" data-testid="sources-list">
        <SectionHeader
          title="Your sources"
          description="Where you buy: a type (thrift store, estate sale…) and the specific place. Names are matched ignoring capitals and punctuation, so “goodwill west” and “Goodwill — West” are one source."
          action={
            <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')} data-testid="source-new">
              Add source
            </Button>
          }
        />
        {sources.length === 0 ? (
          <p className="mt-3 text-sm text-ink-2">No sources yet. Add one here, or type “Where you bought it” when adding an item or lot.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {sources.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-2 py-2" data-testid="source-row">
                <div className="min-w-0 flex-1 text-sm">
                  <Link to={sourceHref(s.id)} className="font-medium break-words text-accent-text hover:underline">
                    {s.name}
                  </Link>
                  <p className="text-xs text-ink-2">
                    {SOURCE_TYPE_LABELS[s.type]}
                    {s.location && ` · ${s.location}`}
                    {s.aliases.length > 0 && ` · also “${s.aliases.join('”, “')}”`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <IconButton label={`Edit ${s.name}`} onClick={() => setEditing(s)}>
                    <Pencil className="size-4" />
                  </IconButton>
                  {sources.length > 1 && (
                    <IconButton label={`Merge ${s.name} into another source`} onClick={() => setMerging(s)}>
                      <GitMerge className="size-4" />
                    </IconButton>
                  )}
                  <IconButton label={`Delete ${s.name}`} onClick={() => void remove(s)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {unregistered.length > 0 && (
        <Card className="p-4 sm:p-5" data-testid="sources-unregistered">
          <SectionHeader title="Names from your lots" description="Typed as “Where you bought it” on a lot but not in your sources yet. They’re already counted under these names; adding one lets you set its type and use it everywhere." />
          <ul className="mt-2 divide-y divide-line text-sm">
            {unregistered.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="text-ink">{r.name}</span>
                <Button size="sm" onClick={() => setPrefill({ name: r.name, type: r.type ?? guessSourceType(r.name) })}>
                  Add to my sources
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(unassignedItems.length > 0 || unassignedLots.length > 0) && (
        <Card className="p-4 sm:p-5" data-testid="sources-unassigned">
          <SectionHeader title="Unassigned source" description="Records with no source. Nothing is guessed: choose one for each when you know it. Each change is logged." />
          {sources.length === 0 ? (
            <p className="mt-2 text-sm text-ink-2">Add a source first.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {[...unassignedLots.map((l) => ({ kind: 'lot' as const, id: l.id, name: `Lot: ${l.name}`, href: `/inventory/lots/${l.id}` })), ...unassignedItems.map((i) => ({ kind: 'item' as const, id: i.id, name: i.name, href: `/inventory/${i.id}` }))].map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5" data-testid="unassigned-record">
                  <Link to={r.href} className="min-w-0 break-words text-accent-text hover:underline">
                    {r.name}
                  </Link>
                  <SelectField
                    className="w-56"
                    label={<span className="sr-only">Source for {r.name}</span>}
                    value=""
                    onChange={(v) => v && run(() => store.update((d) => assignSource(d, r.kind, r.id, v)), 'Source recorded.')}
                  >
                    <option value="">Choose a source…</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </SelectField>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {data.sourcing.changes.length > 0 && (
        <Card className="p-4 sm:p-5" data-testid="sources-log">
          <SectionHeader title="Change log" description="Every source added, renamed, edited, merged, deleted or assigned." />
          <ul className="mt-2 space-y-1 text-xs text-ink-2">
            {[...data.sourcing.changes].reverse().slice(0, 50).map((c) => (
              <li key={c.id}>
                {formatDateTime(c.at)}: {c.detail}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SourceDialog source={editing === 'new' ? null : editing} prefill={prefill} open={editing !== null || prefill !== null} onClose={() => (setEditing(null), setPrefill(null))} />
      <MergeDialog from={merging} onClose={() => setMerging(null)} />
    </div>
  );
}

function SourceDialog({ source, prefill, open, onClose }: { source: Source | null; prefill: { name: string; type: SourceType } | null; open: boolean; onClose: () => void }) {
  const data = useAppState((s) => s.data);
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState<SourceType>('other');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setName(source?.name ?? prefill?.name ?? '');
    setType(source?.type ?? prefill?.type ?? 'other');
    setLocation(source?.location ?? '');
    setNotes(source?.notes ?? '');
    setErrors({});
  }, [open, source, prefill]);
  const similar = !source && name.trim() ? similarSources(data, name) : [];
  const save = () => {
    try {
      const input = { name, type, location, notes };
      store.commit((d) => (source ? updateSource(d, source.id, input) : createSource(d, input)));
      toast.success(source ? 'Source saved.' : `Added “${name.trim()}”.`);
      onClose();
    } catch (e) {
      if (!isDomainError(e)) throw e;
      setErrors(Object.keys(e.fields).length ? e.fields : { name: e.message });
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={source ? `Edit “${source.name}”` : 'Add a source'}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} data-testid="source-save">
            Save
          </Button>
        </div>
      }
      testId="source-dialog"
    >
      <div className="space-y-3">
        <TextField label="Name" required value={name} onChange={(v) => (setName(v), !source && setType(guessSourceType(v)))} error={errors.name} placeholder="e.g. Goodwill — West Little Rock" maxLength={120} hint={source && name.trim() !== source.name ? 'Renaming keeps the old name as an alias, so past records stay with this source.' : undefined} />
        {similar.length > 0 && <p className="text-xs text-warn-text">Similar to {similar.map((s) => `“${s.name}”`).join(', ')}. If it’s the same place, use that one instead.</p>}
        <SelectField label="Type" value={type} onChange={(v) => setType(v as SourceType)}>
          {SOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {SOURCE_TYPE_LABELS[t]}
            </option>
          ))}
        </SelectField>
        <TextField label="Location or description (optional)" value={location} onChange={setLocation} maxLength={200} placeholder="e.g. 1201 Shackleford Rd" />
        <TextAreaField label="Notes (optional)" value={notes} onChange={setNotes} rows={2} />
      </div>
    </Dialog>
  );
}

function MergeDialog({ from, onClose }: { from: Source | null; onClose: () => void }) {
  const data = useAppState((s) => s.data);
  const run = useAction();
  const [into, setInto] = useState('');
  useEffect(() => setInto(''), [from]);
  const others = data.sourcing.sources.filter((s) => s.id !== from?.id);
  const merge = () => {
    if (!from || !into) return;
    if (run(() => store.commit((d) => mergeSources(d, from.id, into)), `Merged “${from.name}”.`)) onClose();
  };
  return (
    <Dialog
      open={from !== null}
      onClose={onClose}
      title={from ? `Merge “${from.name}”` : 'Merge'}
      description="For two sources that are the same place. Everything recorded with this one moves to the other, which keeps this name as an alias. Logged."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={merge} disabled={!into} data-testid="merge-confirm">
            Merge
          </Button>
        </div>
      }
    >
      <SelectField label="Merge into" value={into} onChange={setInto}>
        <option value="">Choose…</option>
        {others.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </SelectField>
    </Dialog>
  );
}
