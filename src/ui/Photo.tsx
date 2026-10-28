import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Package, Star, Trash2 } from 'lucide-react';
import type { PhotoRecord } from '../domain/types';
import { store } from '../data/store';
import { processPhoto } from '../lib/images';
import { cn } from './cn';

// In-memory cache of loaded photos so lists don't re-read IndexedDB on every render.
const cache = new Map<string, PhotoRecord | null>();
const inflight = new Map<string, Promise<PhotoRecord | null>>();

function loadPhoto(id: string): Promise<PhotoRecord | null> {
  if (cache.has(id)) return Promise.resolve(cache.get(id)!);
  let p = inflight.get(id);
  if (!p) {
    p = store.storage
      .getPhoto(id)
      .then((rec) => {
        cache.set(id, rec ?? null);
        return rec ?? null;
      })
      .catch(() => null)
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

export function primePhotoCache(photo: PhotoRecord) {
  cache.set(photo.id, photo);
}

export function forgetPhotos(ids: string[]) {
  for (const id of ids) cache.delete(id);
}

export function usePhoto(id: string | undefined, variant: 'thumb' | 'full' = 'thumb'): string | null {
  const [src, setSrc] = useState<string | null>(() => (id && cache.get(id)?.[variant]) || null);
  useEffect(() => {
    let alive = true;
    if (!id) {
      setSrc(null);
      return;
    }
    loadPhoto(id).then((rec) => alive && setSrc(rec?.[variant] ?? null));
    return () => {
      alive = false;
    };
  }, [id, variant]);
  return src;
}

/** A softly tinted tile with the item's initial, used when an item has no photo. */
function Placeholder({ name, className }: { name: string; className?: string }) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const initial = name.trim()[0]?.toUpperCase();
  return (
    <div className={cn('@container flex items-center justify-center bg-surface-2', className)} aria-hidden>
      <div
        className="flex size-full items-center justify-center"
        style={{ background: `hsl(${hue} 55% 50% / 0.12)`, color: `hsl(${hue} 45% 45%)` }}
      >
        {initial ? <span className="text-[clamp(0.9rem,32cqw,2.75rem)] font-semibold opacity-80">{initial}</span> : <Package className="size-5" />}
      </div>
    </div>
  );
}

export function ItemThumb({ photoId, name, className, variant = 'thumb' }: { photoId?: string; name: string; className?: string; variant?: 'thumb' | 'full' }) {
  const src = usePhoto(photoId, variant);
  if (photoId && src) {
    return <img src={src} alt={name} loading="lazy" className={cn('object-cover', className)} />;
  }
  return <Placeholder name={name} className={className} />;
}

interface PhotoPickerProps {
  photoIds: string[];
  onChange: (ids: string[]) => void;
  /** Called with ids of photos created during this session, so a cancelled form can delete them. */
  onCreated: (ids: string[]) => void;
  onError: (message: string) => void;
  max?: number;
}

export function PhotoPicker({ photoIds, onChange, onCreated, onError, max = 8 }: PhotoPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = max - photoIds.length;
    const list = [...files].slice(0, room);
    if (files.length > room) onError(`You can add up to ${max} photos per item.`);
    setBusy(true);
    const created: string[] = [];
    for (const file of list) {
      try {
        const photo = await processPhoto(file);
        await store.savePhotos([photo]);
        primePhotoCache({ ...photo, dataset: store.getState().dataset });
        created.push(photo.id);
      } catch (e) {
        onError(e instanceof Error ? e.message : 'A photo could not be added.');
      }
    }
    setBusy(false);
    if (created.length) {
      onCreated(created);
      onChange([...photoIds, ...created]);
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {photoIds.map((id, i) => (
          <div key={id} className="group relative size-20 overflow-hidden rounded-xl border border-line sm:size-24">
            <ItemThumb photoId={id} name="" className="size-full" />
            {i === 0 && (
              <span className="absolute top-1 left-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">Cover</span>
            )}
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-1">
              {i > 0 && (
                <button
                  type="button"
                  aria-label="Make cover photo"
                  title="Make cover photo"
                  onClick={() => onChange([id, ...photoIds.filter((p) => p !== id)])}
                  className="rounded-md bg-black/50 p-1 text-white hover:bg-black/70"
                >
                  <Star className="size-3.5" />
                </button>
              )}
              <button
                type="button"
                aria-label="Remove photo"
                title="Remove photo"
                onClick={() => onChange(photoIds.filter((p) => p !== id))}
                className="rounded-md bg-black/50 p-1 text-white hover:bg-black/70"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
        {photoIds.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex size-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong bg-surface-2 text-xs text-ink-2 hover:border-accent hover:text-accent-text sm:size-24"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : photoIds.length ? <ImagePlus className="size-5" /> : <Camera className="size-5" />}
            {busy ? 'Adding…' : photoIds.length ? 'Add more' : 'Add photo'}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        aria-label="Upload item photos"
        data-testid="photo-input"
        onChange={(e) => void addFiles(e.target.files)}
      />
    </div>
  );
}
