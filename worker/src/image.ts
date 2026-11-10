// Validates the uploaded photo before anything is sent to the AI provider. The image is held
// in memory for the length of the request only; it is never written to storage or logs.

import { MAX_IMAGE_BYTES } from './config';

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export type ImageCheck =
  | { ok: true; mediaType: ImageMediaType; data: string; bytes: number }
  | { ok: false; status: number; code: string; message: string };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_BYTES = 512;

function fail(status: number, code: string, message: string): ImageCheck {
  return { ok: false, status, code, message };
}

/** Detects the real format from the file's first bytes (the declared type isn't trusted). */
export function sniffImageType(head: Uint8Array): ImageMediaType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b)) return 'image/png';
  if (
    head.length >= 12 &&
    String.fromCharCode(...head.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...head.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Accepts `{ image: "<base64 or data URL>" }`; exactly one image per request. */
export function checkImage(body: unknown, maxBytes = MAX_IMAGE_BYTES): ImageCheck {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(400, 'invalid_request', 'Send the photo as JSON: { "image": "<base64>" }.');
  }
  const raw = (body as { image?: unknown }).image;
  if (typeof raw !== 'string' || raw.length === 0) return fail(400, 'invalid_request', 'No photo was included.');

  let data = raw;
  const dataUrl = /^data:([\w/+.-]+);base64,/.exec(raw);
  if (dataUrl) data = raw.slice(dataUrl[0].length);

  const maxBase64 = Math.ceil(maxBytes / 3) * 4;
  if (data.length > maxBase64) return fail(413, 'image_too_large', 'That photo is too large. Try a smaller photo.');
  if (data.length % 4 !== 0 || !BASE64.test(data)) return fail(422, 'invalid_image', 'That file isn’t a readable image.');

  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const bytes = (data.length / 4) * 3 - padding;
  if (bytes < MIN_BYTES) return fail(422, 'invalid_image', 'That image is too small to analyze.');

  const head = Uint8Array.from(atob(data.slice(0, 24)), (c) => c.charCodeAt(0));
  const mediaType = sniffImageType(head);
  if (!mediaType) return fail(415, 'unsupported_image', 'Use a JPEG, PNG or WebP photo.');
  return { ok: true, mediaType, data, bytes };
}
