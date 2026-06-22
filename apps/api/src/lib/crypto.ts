import { scrypt } from '@noble/hashes/scrypt';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';

// Scrypt params — balanced for Cloudflare Workers CPU budget
const SCRYPT_N = 16384; // 2^14
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 32;

function toBase64(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Stored format: scrypt$N$r$p$salt_b64$hash_b64
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scrypt(password, salt, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, dkLen: SCRYPT_DKLEN });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${toBase64(salt)}$${toBase64(hash)}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N_str, r_str, p_str, saltB64, hashB64] = parts;
  const N = parseInt(N_str, 10);
  const r = parseInt(r_str, 10);
  const p = parseInt(p_str, 10);
  const salt = fromBase64(saltB64);
  const expected = fromBase64(hashB64);
  const actual = scrypt(password, salt, { N, r, p, dkLen: expected.length });
  // Constant-time comparison
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

// 32-byte opaque token → base64url (for sending to client)
export function generateToken(): string {
  const bytes = randomBytes(32);
  return toBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// sha-256 hex — what gets stored in DB
export function hashToken(token: string): string {
  return bytesToHex(sha256(token));
}
