/* eslint-disable no-bitwise -- constant-time compare and base64url. */
/**
 * Token checks for remote control and command access.
 */

/**
 * Compares two strings in time that depends only on the longer length, so
 * the time a wrong token takes does not tell how much of it was right.
 */
export const safeEqual = (given: string, expected: string): boolean => {
  const length = Math.max(given.length, expected.length);
  let difference = given.length ^ expected.length;
  for (let index = 0; index < length; index += 1) {
    const left = index < given.length ? given.charCodeAt(index) : 0;
    const right = index < expected.length ? expected.charCodeAt(index) : 0;
    difference |= left ^ right;
  }
  return difference === 0 && expected.length > 0;
};

/** A token is long enough when it has at least 16 characters from the safe set. */
export const isUsableToken = (token: string): boolean => /^[A-Za-z0-9_-]{16,128}$/.test(token);

export interface AttemptLimiterOptions {
  /** Wrong tokens allowed in [windowMs] before the client is locked out. */
  maxFailures: number;
  windowMs: number;
  /** First lockout; each lockout after it is twice as long, up to [maxLockMs]. */
  lockMs: number;
  maxLockMs: number;
}

export const DEFAULT_ATTEMPT_LIMIT: AttemptLimiterOptions = {
  maxFailures: 5,
  windowMs: 60_000,
  lockMs: 60_000,
  maxLockMs: 15 * 60_000,
};

interface ClientRecord {
  failures: number[];
  lockedUntil: number;
  lockouts: number;
}

/** Counts wrong tokens per client and locks out a client that keeps guessing. */
export class FailedAttemptLimiter {
  private readonly clients = new Map<string, ClientRecord>();

  constructor(private readonly options: AttemptLimiterOptions = DEFAULT_ATTEMPT_LIMIT) {}

  isLocked(client: string, now = Date.now()): boolean {
    const record = this.clients.get(client);
    return Boolean(record && record.lockedUntil > now);
  }

  recordFailure(client: string, now = Date.now()): void {
    const record = this.clients.get(client) || {failures: [], lockedUntil: 0, lockouts: 0};
    record.failures = record.failures.filter(time => now - time < this.options.windowMs);
    record.failures.push(now);
    if (record.failures.length >= this.options.maxFailures) {
      const lock = Math.min(this.options.lockMs * 2 ** record.lockouts, this.options.maxLockMs);
      record.lockedUntil = now + lock;
      record.lockouts += 1;
      record.failures = [];
    }
    this.clients.set(client, record);
    // Keep the table small when many addresses guess.
    if (this.clients.size > 256) {
      for (const [key, value] of this.clients) {
        if (value.lockedUntil <= now && value.failures.every(time => now - time >= this.options.windowMs)) {
          this.clients.delete(key);
        }
      }
    }
  }

  recordSuccess(client: string): void {
    const record = this.clients.get(client);
    if (record) record.failures = [];
  }
}

const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A token from random bytes: base64url without padding (24 bytes give 32 characters). */
export const tokenFromBytes = (bytes: Uint8Array): string => {
  let text = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - index) * 8) / 6));
    for (let part = 0; part < chars; part += 1) text += URL_SAFE[(chunk >> (18 - part * 6)) & 63];
  }
  return text;
};

/** A new random token. Throws when no secure random source is available. */
export const newToken = (random?: (size: number) => Uint8Array): string => {
  const source =
    random ||
    ((size: number) => {
      const Crypto = require('expo-crypto');
      if (typeof Crypto?.getRandomBytes !== 'function') throw new Error('No secure random source');
      return Crypto.getRandomBytes(size) as Uint8Array;
    });
  const bytes = source(24);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 24) throw new Error('No secure random source');
  return tokenFromBytes(bytes);
};
