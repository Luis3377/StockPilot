import { describe, expect, it } from 'vitest';
import { checkImage } from '../src/image';
import { fakeJpegBase64 } from './helpers';

const b64 = (bytes: number[], pad = 2048) => {
  const buf = Buffer.alloc(pad, 0);
  buf.set(bytes);
  return buf.toString('base64');
};

describe('checkImage', () => {
  it('accepts JPEG, PNG and WebP by their real file signature', () => {
    expect(checkImage({ image: fakeJpegBase64() })).toMatchObject({ ok: true, mediaType: 'image/jpeg', bytes: 2048 });
    expect(checkImage({ image: b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) })).toMatchObject({ ok: true, mediaType: 'image/png' });
    const webp = [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')];
    expect(checkImage({ image: b64(webp) })).toMatchObject({ ok: true, mediaType: 'image/webp' });
    // Data URLs are fine; the declared type is ignored in favour of the signature.
    expect(checkImage({ image: `data:image/png;base64,${fakeJpegBase64()}` })).toMatchObject({ ok: true, mediaType: 'image/jpeg' });
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
});
