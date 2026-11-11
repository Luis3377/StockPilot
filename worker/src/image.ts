// Validates the uploaded photo before anything is sent to the AI provider. The image is held
// in memory for the length of the request only; it is never written to storage or logs.

import { imageTokenBound, MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION } from './config';

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export type ImageCheck =
  | { ok: true; mediaType: ImageMediaType; data: string; bytes: number; width: number; height: number; imageTokens: number }
  | { ok: false; status: number; code: string; message: string };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_BYTES = 512;
/** How much of the file is decoded to find its dimensions: JPEG headers can sit after EXIF data. */
const HEADER_WINDOWS = [4 * 1024, 64 * 1024, 512 * 1024];

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

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));

/** Width and height from the file header (JPEG, PNG, WebP), or null if they can't be found. */
export function imageSize(b: Uint8Array, type: ImageMediaType): { w: number; h: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  if (type === 'image/png') {
    if (b.length < 24 || ascii(b, 12, 16) !== 'IHDR') return null;
    const u32 = (i: number) => b[i] * 2 ** 24 + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    return { w: u32(16), h: u32(20) };
  }
  if (type === 'image/jpeg') {
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) {
        i += 1; // fill byte
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        i += 2; // markers without a length
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) return null; // image data reached with no frame header
      const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrameHeader) return i + 8 < b.length ? { w: u16be(i + 7), h: u16be(i + 5) } : null;
      const length = u16be(i + 2);
      if (length < 2) return null;
      i += 2 + length;
    }
    return null;
  }
  const chunk = ascii(b, 12, 16);
  if (chunk === 'VP8 ' && b.length >= 30) return { w: ((b[27] << 8) | b[26]) & 0x3fff, h: ((b[29] << 8) | b[28]) & 0x3fff };
  if (chunk === 'VP8L' && b.length >= 25) return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
  if (chunk === 'VP8X' && b.length >= 30) return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  return null;
}

function decodeHead(data: string, bytes: number): Uint8Array {
  const chars = Math.min(data.length, Math.ceil(bytes / 3) * 4);
  const binary = atob(data.slice(0, chars));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Accepts `{ image: "<base64 or data URL>" }`; exactly one image per request. Checks size,
 * encoding, real file type and pixel dimensions, so nothing the API would reject (or that
 * isn't really an image) is ever sent to it.
 */
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

  const mediaType = sniffImageType(decodeHead(data, 12));
  if (!mediaType) return fail(415, 'unsupported_image', 'Use a JPEG, PNG or WebP photo.');

  let size: { w: number; h: number } | null = null;
  for (const window of HEADER_WINDOWS) {
    size = imageSize(decodeHead(data, window), mediaType);
    if (size || window >= bytes) break;
  }
  if (!size || size.w < 1 || size.h < 1) return fail(422, 'invalid_image', 'That file isn’t a readable image.');
  if (size.w > MAX_IMAGE_DIMENSION || size.h > MAX_IMAGE_DIMENSION) {
    return fail(422, 'image_too_large', `That photo is too large (over ${MAX_IMAGE_DIMENSION} pixels across). Try a smaller photo.`);
  }
  return { ok: true, mediaType, data, bytes, width: size.w, height: size.h, imageTokens: imageTokenBound(size.w, size.h) };
}
