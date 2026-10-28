import { newId } from '../domain/ids';

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const FULL_SIZE = 1600;
const THUMB_SIZE = 400;

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fall through to <img> decoding (older Safari).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function render(source: ImageBitmap | HTMLImageElement, maxSize: number, quality: number): string {
  const w = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const h = 'naturalHeight' in source ? source.naturalHeight : source.height;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not process this image.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export interface ProcessedPhoto {
  id: string;
  full: string;
  thumb: string;
  createdAt: string;
}

/** Resizes and compresses a photo so it stores efficiently on the device. */
export async function processPhoto(file: File): Promise<ProcessedPhoto> {
  if (!file.type.startsWith('image/') && !/\.(heic|heif|jpe?g|png|webp|gif)$/i.test(file.name)) {
    throw new Error(`"${file.name}" isn't an image.`);
  }
  if (file.size > MAX_FILE_BYTES) throw new Error(`"${file.name}" is larger than 30 MB.`);
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    throw new Error(`"${file.name}" couldn't be read. Try a JPEG or PNG.`);
  }
  const photo = {
    id: newId(),
    full: render(bitmap, FULL_SIZE, 0.82),
    thumb: render(bitmap, THUMB_SIZE, 0.78),
    createdAt: new Date().toISOString(),
  };
  if ('close' in bitmap) bitmap.close();
  return photo;
}
