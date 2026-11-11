// Invitation codes for the private beta.
//
// A code is 20 random Crockford base32 characters (100 bits), shown as
// "SP-XXXXX-XXXXX-XXXXX-XXXXX". Only an HMAC-SHA256 of the code (keyed with the CODE_PEPPER
// secret) is stored, so a leaked database doesn't reveal working codes. Codes are scoped to
// scanning, expire, and can be revoked; they are not user accounts.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32 symbols: no I, L, O, U
export const CODE_LENGTH = 20;

export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  // 256 is a multiple of 32, so masking to 5 bits keeps every symbol equally likely.
  const body = Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
  return `SP-${body.match(/.{5}/g)!.join('-')}`;
}

/** Canonical form for hashing: uppercase, no separators, common look-alikes fixed. Null if malformed. */
export function normalizeCode(input: string): string | null {
  let s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length === CODE_LENGTH + 2 && s.startsWith('SP')) s = s.slice(2);
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keyCache.set(secret, key);
  }
  return key;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hashCode(pepper: string, normalizedCode: string): Promise<string> {
  return hmacHex(pepper, `code:${normalizedCode}`);
}

/**
 * A privacy-preserving key for throttling failed attempts by network. IPv6 clients are
 * grouped by /64, since one device can rotate through addresses within it.
 */
export async function clientKey(pepper: string, ip: string | null): Promise<string> {
  let network = (ip ?? 'unknown').trim().toLowerCase();
  if (network.includes(':')) network = network.split(':').slice(0, 4).join(':');
  return (await hmacHex(pepper, `client:${network}`)).slice(0, 32);
}

/** Constant-time comparison of two secrets (compares their HMACs). */
export async function secretsMatch(pepper: string, given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([hmacHex(pepper, `cmp:${given}`), hmacHex(pepper, `cmp:${expected}`)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Short random id (not secret) for codes and reservations. */
export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `${prefix}_${Array.from(bytes, (b) => ALPHABET[b & 31]).join('').toLowerCase()}`;
}
