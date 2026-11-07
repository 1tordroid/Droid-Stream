/* eslint-disable no-bitwise -- byte packing for the header. */
/**
 * Encryption for backup sync and setup transfer.
 *
 * Passphrase envelope (version 1), base64 of:
 *   "DSEC" | version 1 | kdf 1 (PBKDF2-HMAC-SHA256) | iterations (uint32 BE)
 *   | salt length | salt | nonce length | nonce | AES-256-GCM ciphertext + 16-byte tag
 * Everything before the ciphertext is the header, and the header is the
 * additional data, so changing any of it (iterations included) fails the tag.
 *
 * The work is done natively (SyncTransferModule.kt, javax.crypto); tests pass
 * their own [CryptoBackend].
 */
import {fromByteArray, toByteArray} from 'base64-js';
import {NativeModules} from 'react-native';

export interface CryptoBackend {
  randomBytes(size: number): Uint8Array;
  /** PBKDF2-HMAC-SHA256 over the UTF-8 bytes of [password]. */
  pbkdf2(password: string, salt: Uint8Array, iterations: number, length: number): Promise<Uint8Array>;
  /** HMAC-SHA256 of the UTF-8 bytes of [message]. */
  hmac(key: Uint8Array, message: string): Promise<Uint8Array>;
  /** AES-256-GCM of the UTF-8 bytes of [plaintext]; returns ciphertext + 16-byte tag. */
  seal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: string): Promise<Uint8Array>;
  /** Throws when the tag does not match (wrong key or changed data). */
  open(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, sealed: Uint8Array): Promise<string>;
}

export const MAGIC = [0x44, 0x53, 0x45, 0x43]; // "DSEC"
export const ENVELOPE_VERSION = 1;
export const KDF_PBKDF2_SHA256 = 1;
/** OWASP's figure for PBKDF2-HMAC-SHA256. */
export const PBKDF2_ITERATIONS = 310_000;
/** Envelopes asking for more are refused, so a changed file cannot stall the device. */
export const MAX_ITERATIONS = 5_000_000;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
export const MIN_PASSPHRASE_LENGTH = 8;

/** Wrong passphrase or code, or data that was changed. */
export class DecryptError extends Error {
  constructor(message = 'Wrong passphrase, or the backup was changed') {
    super(message);
    this.name = 'DecryptError';
  }
}

export const toBase64 = (bytes: Uint8Array): string => fromByteArray(bytes);
export const fromBase64 = (text: string): Uint8Array => toByteArray(text);

/** Same text for the same passphrase, however the keyboard composed accents. */
export const normalizeSecret = (value: string): string =>
  typeof value.normalize === 'function' ? value.normalize('NFC') : value;

const native = () => NativeModules.SyncTransferModule as
  | {
      pbkdf2Sha256(password: string, salt: string, iterations: number, length: number): Promise<string>;
      hmacSha256(key: string, message: string): Promise<string>;
      aesGcmSeal(key: string, nonce: string, aad: string, plaintext: string): Promise<string>;
      aesGcmOpen(key: string, nonce: string, aad: string, sealed: string): Promise<string>;
    }
  | undefined;

const requireNative = () => {
  const module = native();
  if (!module) throw new Error('Update Droid Stream to use this');
  return module;
};

export const nativeCrypto: CryptoBackend = {
  randomBytes: size => {
    const Crypto = require('expo-crypto') as typeof import('expo-crypto');
    const bytes = Crypto.getRandomBytes(size);
    if (!(bytes instanceof Uint8Array) || bytes.length !== size) throw new Error('No secure random source');
    return bytes;
  },
  pbkdf2: async (password, salt, iterations, length) =>
    fromBase64(await requireNative().pbkdf2Sha256(password, toBase64(salt), iterations, length)),
  hmac: async (key, message) => fromBase64(await requireNative().hmacSha256(toBase64(key), message)),
  seal: async (key, nonce, aad, plaintext) =>
    fromBase64(await requireNative().aesGcmSeal(toBase64(key), toBase64(nonce), toBase64(aad), plaintext)),
  open: async (key, nonce, aad, sealed) => {
    try {
      return await requireNative().aesGcmOpen(toBase64(key), toBase64(nonce), toBase64(aad), toBase64(sealed));
    } catch {
      throw new DecryptError();
    }
  },
};

export const isCryptoAvailable = (): boolean => Boolean(native());

const header = (iterations: number, salt: Uint8Array, nonce: Uint8Array): Uint8Array => {
  const bytes = new Uint8Array(4 + 1 + 1 + 4 + 1 + salt.length + 1 + nonce.length);
  let at = 0;
  for (const byte of MAGIC) bytes[at++] = byte;
  bytes[at++] = ENVELOPE_VERSION;
  bytes[at++] = KDF_PBKDF2_SHA256;
  bytes[at++] = (iterations >>> 24) & 0xff;
  bytes[at++] = (iterations >>> 16) & 0xff;
  bytes[at++] = (iterations >>> 8) & 0xff;
  bytes[at++] = iterations & 0xff;
  bytes[at++] = salt.length;
  bytes.set(salt, at);
  at += salt.length;
  bytes[at++] = nonce.length;
  bytes.set(nonce, at);
  return bytes;
};

interface ParsedEnvelope {
  header: Uint8Array;
  iterations: number;
  salt: Uint8Array;
  nonce: Uint8Array;
  sealed: Uint8Array;
}

const parseEnvelope = (text: string): ParsedEnvelope => {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(text);
  } catch {
    throw new DecryptError('This backup is damaged');
  }
  const damaged = () => new DecryptError('This backup is damaged');
  if (bytes.length < 12 || MAGIC.some((byte, index) => bytes[index] !== byte)) throw damaged();
  if (bytes[4] !== ENVELOPE_VERSION) throw new DecryptError('This backup was made by a newer version of Droid Stream');
  if (bytes[5] !== KDF_PBKDF2_SHA256) throw damaged();
  const iterations = ((bytes[6] << 24) | (bytes[7] << 16) | (bytes[8] << 8) | bytes[9]) >>> 0;
  if (iterations < 100_000 || iterations > MAX_ITERATIONS) throw damaged();
  let at = 10;
  const saltLength = bytes[at++];
  if (saltLength < 16 || at + saltLength >= bytes.length) throw damaged();
  const salt = bytes.slice(at, at + saltLength);
  at += saltLength;
  const nonceLength = bytes[at++];
  if (nonceLength !== NONCE_BYTES || at + nonceLength + TAG_BYTES > bytes.length) throw damaged();
  const nonce = bytes.slice(at, at + nonceLength);
  at += nonceLength;
  return {header: bytes.slice(0, at), iterations, salt, nonce, sealed: bytes.slice(at)};
};

/** Encrypts [plaintext] with a key made from [passphrase]. Returns the base64 envelope. */
export const encryptWithPassphrase = async (
  plaintext: string,
  passphrase: string,
  backend: CryptoBackend = nativeCrypto,
  iterations = PBKDF2_ITERATIONS,
): Promise<string> => {
  if (!passphrase) throw new Error('Set a passphrase first');
  const salt = backend.randomBytes(SALT_BYTES);
  const nonce = backend.randomBytes(NONCE_BYTES);
  const key = await backend.pbkdf2(normalizeSecret(passphrase), salt, iterations, 32);
  const head = header(iterations, salt, nonce);
  const sealed = await backend.seal(key, nonce, head, plaintext);
  const out = new Uint8Array(head.length + sealed.length);
  out.set(head, 0);
  out.set(sealed, head.length);
  return toBase64(out);
};

/** Throws [DecryptError] for a wrong passphrase or changed data. */
export const decryptWithPassphrase = async (
  envelope: string,
  passphrase: string,
  backend: CryptoBackend = nativeCrypto,
): Promise<string> => {
  const parsed = parseEnvelope(envelope);
  if (!passphrase) throw new DecryptError('Enter the passphrase');
  const key = await backend.pbkdf2(normalizeSecret(passphrase), parsed.salt, parsed.iterations, 32);
  try {
    return await backend.open(key, parsed.nonce, parsed.header, parsed.sealed);
  } catch {
    throw new DecryptError();
  }
};

/** AES-256-GCM with a ready key: base64 of nonce + ciphertext + tag. */
export const sealWithKey = async (
  key: Uint8Array,
  plaintext: string,
  aad: string,
  backend: CryptoBackend = nativeCrypto,
): Promise<string> => {
  const nonce = backend.randomBytes(NONCE_BYTES);
  const sealed = await backend.seal(key, nonce, utf8(aad), plaintext);
  const out = new Uint8Array(nonce.length + sealed.length);
  out.set(nonce, 0);
  out.set(sealed, nonce.length);
  return toBase64(out);
};

export const openWithKey = async (
  key: Uint8Array,
  data: string,
  aad: string,
  backend: CryptoBackend = nativeCrypto,
): Promise<string> => {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(data);
  } catch {
    throw new DecryptError('The data is damaged');
  }
  if (bytes.length < NONCE_BYTES + TAG_BYTES) throw new DecryptError('The data is damaged');
  try {
    return await backend.open(key, bytes.slice(0, NONCE_BYTES), utf8(aad), bytes.slice(NONCE_BYTES));
  } catch {
    throw new DecryptError('Wrong code, or the data was changed');
  }
};

export const utf8 = (text: string): Uint8Array => {
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
