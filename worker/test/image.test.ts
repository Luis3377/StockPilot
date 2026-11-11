import { describe, expect, it } from 'vitest';
import { checkImage, imageSize } from '../src/image';
import { fakeJpegBase64, jpegHeader } from './helpers';

const b64 = (bytes: number[], pad = 2048) => {
  const buf = Buffer.alloc(pad, 0);
  buf.set(bytes);
  return buf.toString('base64');
};
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const png = (w: number, h: number) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...Buffer.from('IHDR'), ...u32(w), ...u32(h)];
const webpVp8x = (w: number, h: number) => [
  ...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8X'), 10, 0, 0, 0, 0, 0, 0, 0,
  (w - 1) & 0xff, ((w - 1) >> 8) & 0xff, ((w - 1) >> 16) & 0xff, (h - 1) & 0xff, ((h - 1) >> 8) & 0xff, ((h - 1) >> 16) & 0xff,
];

describe('checkImage', () => {
  it('accepts JPEG, PNG and WebP by their real file signature, and reads their size', () => {
    expect(checkImage({ image: fakeJpegBase64() })).toMatchObject({ ok: true, mediaType: 'image/jpeg', bytes: 2048, width: 1600, height: 1200, imageTokens: 2494 });
    expect(checkImage({ image: b64(png(800, 600)) })).toMatchObject({ ok: true, mediaType: 'image/png', width: 800, height: 600 });
    expect(checkImage({ image: b64(webpVp8x(1600, 1200)) })).toMatchObject({ ok: true, mediaType: 'image/webp', width: 1600, height: 1200 });
    // Data URLs are fine; the declared type is ignored in favour of the signature.
    expect(checkImage({ image: `data:image/png;base64,${fakeJpegBase64()}` })).toMatchObject({ ok: true, mediaType: 'image/jpeg' });
  });

  it('finds the JPEG size after a large EXIF block', () => {
    const exif = [0xff, 0xe1, 0xfa, 0x00, ...new Array(0xfa00 - 2).fill(0x45)]; // 64 KB APP1 segment
    const header = jpegHeader(4032, 3024);
    const jpeg = [...header.slice(0, 2), ...exif, ...header.slice(2)];
    expect(checkImage({ image: b64(jpeg, jpeg.length + 1000) })).toMatchObject({ ok: true, width: 4032, height: 3024, imageTokens: 4784 });
  });

  it('rejects other file types', () => {
    expect(checkImage({ image: b64([...Buffer.from('%PDF-1.7')]) })).toMatchObject({ ok: false, status: 415, code: 'unsupported_image' });
    expect(checkImage({ image: b64([...Buffer.from('GIF89a')]) })).toMatchObject({ ok: false, status: 415 });
  });

  it('rejects malformed, tiny, oversized and missing images', () => {
    expect(checkImage({ image: 'not base64!!' })).toMatchObject({ ok: false, status: 422 });
    expect(checkImage({ image: fakeJpegBase64(100) })).toMatchObject({ ok: false, status: 422 });
    expect(checkImage({ image: fakeJpegBase64(5000) }, 4000)).toMatchObject({ ok: false, status: 413 });
    expect(checkImage({})).toMatchObject({ ok: false, status: 400 });
    expect(checkImage(null)).toMatchObject({ ok: false, status: 400 });
    expect(checkImage([fakeJpegBase64()])).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects images whose size can’t be read, or that the AI provider would refuse', () => {
    // A JPEG signature with no frame header (just the first bytes of a real file).
    const headless = Buffer.alloc(2048, 0x11);
    headless.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(checkImage({ image: headless.toString('base64') })).toMatchObject({ ok: false, status: 422, code: 'invalid_image' });
    expect(checkImage({ image: b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) })).toMatchObject({ ok: false, code: 'invalid_image' });
    expect(checkImage({ image: fakeJpegBase64(2048, 9000, 1000) })).toMatchObject({ ok: false, status: 422, code: 'image_too_large' });
    expect(checkImage({ image: b64(png(100, 8001)) })).toMatchObject({ ok: false, code: 'image_too_large' });
    expect(checkImage({ image: b64(png(0, 100)) })).toMatchObject({ ok: false, code: 'invalid_image' });
    expect(checkImage({ image: fakeJpegBase64(2048, 8000, 8000) })).toMatchObject({ ok: true, imageTokens: 4784 });
  });
});

describe('imageSize', () => {
  it('reads PNG, JPEG and WebP headers', () => {
    expect(imageSize(new Uint8Array(png(1600, 1200)), 'image/png')).toEqual({ w: 1600, h: 1200 });
    expect(imageSize(new Uint8Array(jpegHeader(4032, 3024)), 'image/jpeg')).toEqual({ w: 4032, h: 3024 });
    expect(imageSize(new Uint8Array(webpVp8x(1600, 1200)), 'image/webp')).toEqual({ w: 1600, h: 1200 });
  });

  it('returns null for truncated or unusual headers', () => {
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0x00]), 'image/jpeg')).toBeNull();
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 8]), 'image/jpeg')).toBeNull();
    expect(imageSize(new Uint8Array(png(10, 10)).slice(0, 20), 'image/png')).toBeNull();
  });
});
