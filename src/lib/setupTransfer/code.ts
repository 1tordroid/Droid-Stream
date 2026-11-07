/**
 * The short code a receiving device shows, the QR link around it, and the
 * key and token both sides make from it.
 *
 * The code is 8 characters of Crockford base32 (40 bits). Both sides stretch
 * it with PBKDF2-HMAC-SHA256 (310,000 rounds) and a salt the receiver picks,
 * then split the result with HMAC into an AES-256-GCM key and a token the
 * receiver checks before it decrypts anything.
 */
import {PBKDF2_ITERATIONS, toBase64, type CryptoBackend} from '../backupSync/crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 8;
export const SETUP_PORT = 47860;
export const SETUP_LINK_PREFIX = 'droidstream://setup';
/** Extra data bound to every transfer. */
export const SETUP_AAD = 'droid-stream-setup-v1';

export const newCode = (random: (size: number) => Uint8Array): string => {
  const bytes = random(5);
  if (bytes.length !== 5) throw new Error('No secure random source');
  let bits = 0;
  for (const byte of bytes) bits = bits * 256 + byte;
  let code = '';
  for (let index = CODE_LENGTH - 1; index >= 0; index -= 1) {
    code += ALPHABET[Math.floor(bits / 2 ** (index * 5)) % 32];
  }
  return code;
};

/** "ABCD-EFGH" for the screen. */
export const formatCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

/** What a person typed, as a code: case, spaces and dashes do not matter; O, I and L read as 0, 1 and 1. */
export const normalizeCode = (input: string): string | undefined => {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
  if (cleaned.length !== CODE_LENGTH) return undefined;
  for (const char of cleaned) if (!ALPHABET.includes(char)) return undefined;
  return cleaned;
};

export interface SetupLink {
  host: string;
  port: number;
  code: string;
}

export const buildSetupLink = (link: SetupLink): string =>
  `${SETUP_LINK_PREFIX}?a=${encodeURIComponent(link.host)}&p=${link.port}&c=${link.code}`;

export const parseSetupLink = (text: string): SetupLink | undefined => {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith(`${SETUP_LINK_PREFIX}?`)) return undefined;
  const params: Record<string, string> = {};
  for (const part of trimmed.slice(SETUP_LINK_PREFIX.length + 1).split('&')) {
    const [key, value = ''] = part.split('=');
    try {
      params[key] = decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  const port = Number(params.p);
  const code = normalizeCode(params.c || '');
  const host = params.a || '';
  if (!host || !code || !Number.isInteger(port) || port < 1024 || port > 65535) return undefined;
  return {host, port, code};
};

const base64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/[=]+$/, '');

export interface CodeKeys {
  key: Uint8Array;
  token: string;
}

export const deriveCodeKeys = async (
  code: string,
  salt: Uint8Array,
  backend: CryptoBackend,
  iterations = PBKDF2_ITERATIONS,
): Promise<CodeKeys> => {
  const master = await backend.pbkdf2(code, salt, iterations, 32);
  const key = await backend.hmac(master, 'droid-stream setup key v1');
  const token = base64Url(await backend.hmac(master, 'droid-stream setup token v1'));
  return {key, token};
};

/** The other addresses of a /24 home network, nearest numbers first. */
export const neighbourAddresses = (own: string): string[] => {
  const parts = own.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return [];
  const prefix = parts.slice(0, 3).join('.');
  const self = parts[3];
  const hosts: number[] = [];
  for (let host = 1; host <= 254; host += 1) if (host !== self) hosts.push(host);
  hosts.sort((a, b) => Math.abs(a - self) - Math.abs(b - self) || a - b);
  return hosts.map(host => `${prefix}.${host}`);
};
