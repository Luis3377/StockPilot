import { describe, expect, it } from 'vitest';
import { clientKey, generateCode, hashCode, normalizeCode, secretsMatch } from '../src/codes';

const PEPPER = 'p'.repeat(40);

describe('invite codes', () => {
  it('generates long random codes in a readable format', () => {
    const codes = new Set(Array.from({ length: 500 }, generateCode));
    expect(codes.size).toBe(500);
    for (const code of [...codes].slice(0, 20)) {
      expect(code).toMatch(/^SP-[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
      expect(normalizeCode(code)).toHaveLength(20);
    }
  });

  it('normalizes what testers type', () => {
    const code = 'SP-ABCDE-FGH12-34567-89XYZ';
    const canonical = normalizeCode(code);
    expect(canonical).toBe('ABCDEFGH123456789XYZ');
    expect(normalizeCode('sp abcde fgh12 34567 89xyz')).toBe(canonical);
    expect(normalizeCode('ABCDEFGH123456789XYZ')).toBe(canonical);
    // Look-alike letters map to digits.
    expect(normalizeCode('SP-ABCDE-FGHI2-34567-89XYZ')).toBe('ABCDEFGH123456789XYZ');
    expect(normalizeCode('SP-0OOOO-00000-00000-00000')).toBe('0'.repeat(20));
  });

  it('rejects malformed codes', () => {
    for (const bad of ['', 'SP-1234', 'u'.repeat(20), 'SP-ABCDE-FGH12-34567-89XYZ-ZZZZZ', 'ABCDEFGH123456789XY!']) expect(normalizeCode(bad)).toBeNull();
  });

  it('hashes with the pepper so stored hashes are useless without it', async () => {
    const a = await hashCode(PEPPER, 'ABCDEFGH123456789XYZ');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashCode(PEPPER, 'ABCDEFGH123456789XYZ')).toBe(a);
    expect(await hashCode('q'.repeat(40), 'ABCDEFGH123456789XYZ')).not.toBe(a);
  });

  it('groups IPv6 clients by /64 and never stores the raw address', async () => {
    const k1 = await clientKey(PEPPER, '2001:db8:1:2:aaaa::1');
    expect(await clientKey(PEPPER, '2001:db8:1:2:bbbb::9')).toBe(k1);
    expect(await clientKey(PEPPER, '2001:db8:1:3::1')).not.toBe(k1);
    expect(k1).not.toContain('2001');
    expect(await clientKey(PEPPER, '203.0.113.7')).not.toBe(await clientKey(PEPPER, '203.0.113.8'));
  });

  it('compares secrets', async () => {
    expect(await secretsMatch(PEPPER, 'token-a', 'token-a')).toBe(true);
    expect(await secretsMatch(PEPPER, 'token-a', 'token-b')).toBe(false);
  });
});
