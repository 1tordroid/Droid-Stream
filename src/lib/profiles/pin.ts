/* eslint-disable no-bitwise -- SHA-256 is defined with bitwise operations. */
/**
 * Profile PINs: 4 digits, saved only as a salted, stretched SHA-256 hash, and
 * a growing wait after repeated wrong tries.
 */

export const PIN_LENGTH = 4;
/** Hash rounds. A 4-digit PIN cannot be made strong; this only slows a copied hash down. */
export const PIN_HASH_ROUNDS = 2000;
/** Wrong tries allowed before the first wait. */
export const FREE_PIN_ATTEMPTS = 5;
export const FIRST_LOCKOUT_MS = 30 * 1000;
export const MAX_LOCKOUT_MS = 15 * 60 * 1000;

export interface PinHash {
  salt: string;
  hash: string;
  rounds: number;
}

export interface PinAttempts {
  /** Wrong tries since the last right one. */
  failures: number;
  /** No try is checked before this time (ms since epoch). */
  lockedUntil: number;
}

export const NO_ATTEMPTS: PinAttempts = {failures: 0, lockedUntil: 0};

export const isValidPin = (pin: string): boolean => new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);

// ---------------------------------------------------------------- SHA-256

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const utf8 = (text: string): Uint8Array => {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return Uint8Array.from(bytes);
};

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 of [input] (text is UTF-8 encoded), as lowercase hex. */
export const sha256Hex = (input: string | Uint8Array): string => {
  const data = typeof input === 'string' ? utf8(input) : input;
  const bitLength = data.length * 8;
  const padded = new Uint8Array((((data.length + 9 + 63) >> 6) << 6));
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return Array.from(h, value => value.toString(16).padStart(8, '0')).join('');
};

// ---------------------------------------------------------------- hashing

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};

const stretch = (pin: string, salt: string, rounds: number): string => {
  let digest = sha256Hex(`${salt}:${pin}`);
  for (let i = 1; i < rounds; i++) {
    const previous = hexToBytes(digest);
    const block = new Uint8Array(previous.length + salt.length);
    block.set(previous);
    block.set(utf8(salt), previous.length);
    digest = sha256Hex(block);
  }
  return digest;
};

/** 16 random bytes as hex. [random] fills the bytes; the default uses expo-crypto. */
export const createSalt = (random: (size: number) => Uint8Array = defaultRandomBytes): string =>
  Array.from(random(16), byte => byte.toString(16).padStart(2, '0')).join('');

const defaultRandomBytes = (size: number): Uint8Array => {
  try {
    const Crypto = require('expo-crypto');
    if (typeof Crypto?.getRandomBytes === 'function') return Crypto.getRandomBytes(size);
  } catch {}
  return Uint8Array.from({length: size}, () => Math.floor(Math.random() * 256));
};

export const hashPin = (pin: string, salt: string = createSalt(), rounds = PIN_HASH_ROUNDS): PinHash => {
  if (!isValidPin(pin)) throw new Error('A PIN is 4 digits');
  return {salt, rounds, hash: stretch(pin, salt, rounds)};
};

/** Compares every character, so the time taken does not hint at the PIN. */
const sameText = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const verifyPinHash = (pin: string, saved: PinHash | undefined): boolean => {
  if (!saved || !isValidPin(pin) || typeof saved.salt !== 'string' || typeof saved.hash !== 'string') return false;
  const rounds = Number.isInteger(saved.rounds) && saved.rounds > 0 ? saved.rounds : PIN_HASH_ROUNDS;
  return sameText(stretch(pin, saved.salt, rounds), saved.hash);
};

export const isPinHash = (value: unknown): value is PinHash => {
  const item = value as PinHash;
  return Boolean(item) && typeof item.salt === 'string' && /^[0-9a-f]{64}$/.test(item.hash) &&
    Number.isInteger(item.rounds) && item.rounds > 0 && item.rounds <= 100000;
};

// ---------------------------------------------------------------- lockout

/** How long to wait after [failures] wrong tries in a row. */
export const lockoutFor = (failures: number): number => {
  if (failures < FREE_PIN_ATTEMPTS) return 0;
  const doublings = failures - FREE_PIN_ATTEMPTS;
  return Math.min(MAX_LOCKOUT_MS, FIRST_LOCKOUT_MS * 2 ** Math.min(doublings, 20));
};

/** Milliseconds left before another try is checked; 0 when one may be made now. */
export const lockoutRemaining = (attempts: PinAttempts, now = Date.now()): number =>
  Math.max(0, attempts.lockedUntil - now);

export const recordPinFailure = (attempts: PinAttempts, now = Date.now()): PinAttempts => {
  const failures = attempts.failures + 1;
  const wait = lockoutFor(failures);
  return {failures, lockedUntil: wait > 0 ? now + wait : 0};
};

export type PinCheck =
  | {ok: true; attempts: PinAttempts}
  | {ok: false; attempts: PinAttempts; waitMs: number; triesLeft: number};

/**
 * Checks [pin] against [saved] unless a wait is running. Returns the new
 * attempt record for the caller to save.
 */
export const checkPin = (
  pin: string,
  saved: PinHash | undefined,
  attempts: PinAttempts = NO_ATTEMPTS,
  now = Date.now(),
): PinCheck => {
  const waiting = lockoutRemaining(attempts, now);
  if (waiting > 0) {
    return {ok: false, attempts, waitMs: waiting, triesLeft: 0};
  }
  if (verifyPinHash(pin, saved)) return {ok: true, attempts: NO_ATTEMPTS};
  const next = recordPinFailure(attempts, now);
  return {
    ok: false,
    attempts: next,
    waitMs: lockoutRemaining(next, now),
    triesLeft: Math.max(0, FREE_PIN_ATTEMPTS - next.failures),
  };
};

/** "30 seconds", "2 minutes": how long the PIN pad stays closed. */
export const formatWait = (ms: number): string => {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
};

/** Short text for a failed check. */
export const pinCheckMessage = (check: PinCheck): string | undefined => {
  if (check.ok) return undefined;
  if (check.waitMs > 0) return `Too many tries. Try again in ${formatWait(check.waitMs)}.`;
  return check.triesLeft > 0 && check.triesLeft < FREE_PIN_ATTEMPTS
    ? `Wrong PIN. ${check.triesLeft} ${check.triesLeft === 1 ? 'try' : 'tries'} left.`
    : 'Wrong PIN.';
};
