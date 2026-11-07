/* eslint-disable no-bitwise -- base64 decoding. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 to a string of byte values (one character per byte). */
export const base64ToBinary = (base64: string): string => {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
};

const utf8 = (binary: string): string => {
  try {
    return decodeURIComponent(binary.replace(/[\x80-\xff]/g, char => `%${char.charCodeAt(0).toString(16)}`));
  } catch {
    return binary;
  }
};

/** The torrent's name (its info dictionary's "name"), or undefined. Reads only the start of the file. */
export const torrentNameFromBase64 = (base64: string): string | undefined => {
  const binary = base64ToBinary(base64.slice(0, 1_400_000));
  const info = binary.indexOf('4:info');
  if (info < 0) return undefined;
  const match = binary.slice(info).match(/4:name(\d{1,4}):/);
  if (!match || match.index === undefined) return undefined;
  const start = info + match.index + match[0].length;
  const name = utf8(binary.slice(start, start + Number(match[1])))
    .replace(/[\\/]+/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .trim();
  return name || undefined;
};
