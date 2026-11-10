import { describe, expect, it } from 'vitest';
import { imageSize } from '../scripts/compare-models';

describe('compare-models imageSize', () => {
  it('reads PNG dimensions', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0, 0, 0x06, 0x40, 0, 0, 0x04, 0xb0], 16); // 1600 × 1200
    expect(imageSize(png, 'image/png')).toEqual({ w: 1600, h: 1200 });
  });

  it('reads JPEG dimensions after other segments', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
    const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x0b, 0xd0, 0x0f, 0xc0, ...new Array(8).fill(0)]; // 4032 × 3024
    const jpeg = new Uint8Array([0xff, 0xd8, ...app0, ...sof0]);
    expect(imageSize(jpeg, 'image/jpeg')).toEqual({ w: 4032, h: 3024 });
  });

  it('reads WebP (VP8X) dimensions', () => {
    const webp = new Uint8Array(30);
    webp.set([...'RIFF'].map((c) => c.charCodeAt(0)));
    webp.set([...'WEBPVP8X'].map((c) => c.charCodeAt(0)), 8);
    webp.set([0x3f, 0x06, 0x00, 0xaf, 0x04, 0x00], 24); // (1599+1) × (1199+1)
    expect(imageSize(webp, 'image/webp')).toEqual({ w: 1600, h: 1200 });
  });

  it('returns null for a truncated header', () => {
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0x00]), 'image/jpeg')).toBeNull();
  });
});
