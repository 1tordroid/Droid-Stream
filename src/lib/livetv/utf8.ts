/* eslint-disable no-bitwise -- byte-level decoding and hashing */
/**
 * Streaming UTF-8 to string. A multi-byte character split across two chunks
 * is held back until the next chunk arrives. Uses the runtime TextDecoder
 * when there is one.
 */
export class Utf8Stream {
  private carry: Uint8Array = new Uint8Array(0);
  private readonly native: {decode: (input?: Uint8Array, options?: {stream?: boolean}) => string} | undefined;

  constructor(useNative = true) {
    const Decoder = (globalThis as any).TextDecoder;
    this.native = useNative && typeof Decoder === 'function' ? new Decoder('utf-8') : undefined;
  }

  decode(chunk: Uint8Array, final = false): string {
    if (this.native) return this.native.decode(chunk, {stream: !final});
    let bytes = chunk;
    if (this.carry.length) {
      bytes = new Uint8Array(this.carry.length + chunk.length);
      bytes.set(this.carry);
      bytes.set(chunk, this.carry.length);
    }
    let end = bytes.length;
    if (!final) {
      // Step back over an unfinished sequence at the end.
      let i = end - 1;
      let back = 0;
      while (i >= 0 && back < 3 && (bytes[i] & 0xc0) === 0x80) {
        i--;
        back++;
      }
      if (i >= 0) {
        const lead = bytes[i];
        const size = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
        if (size > 1 && end - i < size) end = i;
      }
    }
    this.carry = bytes.slice(end);
    return decodeUtf8(bytes, 0, end);
  }
}

const REPLACEMENT = 0xfffd;

export const decodeUtf8 = (bytes: Uint8Array, start = 0, end = bytes.length): string => {
  const units = new Uint16Array(end - start);
  let n = 0;
  let i = start;
  while (i < end) {
    const b = bytes[i++];
    if (b < 0x80) {
      units[n++] = b;
      continue;
    }
    let cp: number;
    let extra: number;
    if (b >= 0xf8) {
      units[n++] = REPLACEMENT;
      continue;
    }
    if (b >= 0xf0) {
      cp = b & 7;
      extra = 3;
    } else if (b >= 0xe0) {
      cp = b & 15;
      extra = 2;
    } else if (b >= 0xc0) {
      cp = b & 31;
      extra = 1;
    } else {
      units[n++] = REPLACEMENT;
      continue;
    }
    if (i + extra > end) {
      units[n++] = REPLACEMENT;
      continue;
    }
    let ok = true;
    for (let k = 0; k < extra; k++) {
      const c = bytes[i + k];
      if ((c & 0xc0) !== 0x80) {
        ok = false;
        break;
      }
      cp = (cp << 6) | (c & 63);
    }
    if (!ok) {
      units[n++] = REPLACEMENT;
      continue;
    }
    i += extra;
    if (cp > 0xffff) {
      cp -= 0x10000;
      units[n++] = 0xd800 + (cp >> 10);
      units[n++] = 0xdc00 + (cp & 0x3ff);
    } else {
      units[n++] = cp;
    }
  }
  let out = '';
  for (let k = 0; k < n; k += 8192) {
    out += String.fromCharCode.apply(null, units.subarray(k, Math.min(n, k + 8192)) as unknown as number[]);
  }
  return out;
};
