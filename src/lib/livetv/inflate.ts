/* eslint-disable no-bitwise -- byte-level decoding and hashing */
/**
 * Small gzip / zlib / raw DEFLATE decoder (RFC 1950, 1951, 1952) for TV
 * guide files. The JS runtime has no gunzip, and many XMLTV guides are only
 * served as .xml.gz. Output comes out in chunks, so a large guide never has to
 * sit in memory as one string, and the caller can pause between chunks.
 */

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289,
  16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const WINDOW = 32 * 1024;
const MAX_MATCH = 258;

/** A lookup table: index by the next `bits` input bits, entry = symbol << 4 | code length. */
interface Huffman {
  table: Int32Array;
  bits: number;
}

const reverse = (code: number, length: number) => {
  let out = 0;
  for (let i = 0; i < length; i++) {
    out = (out << 1) | (code & 1);
    code >>= 1;
  }
  return out;
};

const buildHuffman = (lengths: ArrayLike<number>, count: number): Huffman => {
  let max = 0;
  const counts = new Uint16Array(16);
  for (let i = 0; i < count; i++) {
    counts[lengths[i]]++;
    if (lengths[i] > max) max = lengths[i];
  }
  const bits = Math.max(1, max);
  const table = new Int32Array(1 << bits);
  if (!max) return {table, bits};
  counts[0] = 0;
  const next = new Uint16Array(16);
  let code = 0;
  for (let len = 1; len <= 15; len++) {
    code = (code + counts[len - 1]) << 1;
    next[len] = code;
  }
  for (let symbol = 0; symbol < count; symbol++) {
    const len = lengths[symbol];
    if (!len) continue;
    const entry = (symbol << 4) | len;
    for (let i = reverse(next[len]++, len); i < table.length; i += 1 << len) table[i] = entry;
  }
  return {table, bits};
};

let fixed: {lit: Huffman; dist: Huffman} | undefined;
const fixedTables = () => {
  if (!fixed) {
    const lit = new Uint8Array(288);
    lit.fill(8, 0, 144);
    lit.fill(9, 144, 256);
    lit.fill(7, 256, 280);
    lit.fill(8, 280, 288);
    const dist = new Uint8Array(30).fill(5);
    fixed = {lit: buildHuffman(lit, 288), dist: buildHuffman(dist, 30)};
  }
  return fixed;
};

export const isGzip = (data: Uint8Array) => data.length > 2 && data[0] === 0x1f && data[1] === 0x8b;

export class InflateError extends Error {
  constructor(message = 'The guide file is damaged.') {
    super(message);
    this.name = 'InflateError';
  }
}

type State = 'member' | 'block' | 'stored' | 'codes' | 'done';

export class Inflater {
  private pos = 0;
  private bitBuf = 0;
  private bitCnt = 0;
  private readonly out: Uint8Array;
  private outPos = 0;
  private emitted = 0;
  private state: State = 'member';
  private final = false;
  private stored = 0;
  private lit: Huffman | undefined;
  private dist: Huffman | undefined;
  private readonly gzip: boolean;

  constructor(private readonly data: Uint8Array, chunkSize = 256 * 1024) {
    this.out = new Uint8Array(WINDOW + Math.max(chunkSize, MAX_MATCH * 4));
    this.gzip = isGzip(data);
  }

  private need(n: number) {
    while (this.bitCnt < n) {
      // Past the end reads zeros; the overrun check below catches real damage.
      const byte = this.pos < this.data.length ? this.data[this.pos] : 0;
      this.pos++;
      this.bitBuf |= byte << this.bitCnt;
      this.bitCnt += 8;
    }
  }

  private bits(n: number): number {
    if (!n) return 0;
    this.need(n);
    const value = this.bitBuf & ((1 << n) - 1);
    this.bitBuf >>>= n;
    this.bitCnt -= n;
    return value;
  }

  private symbol(h: Huffman): number {
    this.need(h.bits);
    const entry = h.table[this.bitBuf & ((1 << h.bits) - 1)];
    const len = entry & 15;
    if (!len) throw new InflateError();
    this.bitBuf >>>= len;
    this.bitCnt -= len;
    return entry >> 4;
  }

  /** Drops the partial byte and gives back whole bytes still held in the bit buffer. */
  private alignToByte() {
    this.pos -= this.bitCnt >> 3;
    this.bitBuf = 0;
    this.bitCnt = 0;
  }

  private byteAt(offset: number) {
    if (offset >= this.data.length) throw new InflateError();
    return this.data[offset];
  }

  private readMember() {
    if (this.pos >= this.data.length) {
      this.state = 'done';
      return;
    }
    const d = this.data;
    if (this.gzip) {
      if (d[this.pos] !== 0x1f || d[this.pos + 1] !== 0x8b) {
        // Trailing padding after the last member.
        this.state = 'done';
        return;
      }
      if (this.byteAt(this.pos + 2) !== 8) throw new InflateError('Unknown compression in the guide file.');
      const flags = this.byteAt(this.pos + 3);
      let p = this.pos + 10;
      if (flags & 4) p += 2 + (this.byteAt(p) | (this.byteAt(p + 1) << 8));
      if (flags & 8) while (this.byteAt(p++) !== 0);
      if (flags & 16) while (this.byteAt(p++) !== 0);
      if (flags & 2) p += 2;
      this.pos = p;
    } else if (this.pos === 0 && (d[0] & 15) === 8 && ((d[0] << 8) | d[1]) % 31 === 0) {
      // zlib wrapper.
      this.pos = 2;
    } else if (this.pos > 0) {
      this.state = 'done';
      return;
    }
    this.final = false;
    this.state = 'block';
  }

  private readBlockHeader() {
    if (this.final) {
      this.alignToByte();
      // gzip: CRC32 + size; zlib: Adler-32. Not checked: the XML parser copes with bad data.
      this.pos += this.gzip ? 8 : 4;
      this.state = this.gzip ? 'member' : 'done';
      return;
    }
    this.final = this.bits(1) === 1;
    const type = this.bits(2);
    if (type === 0) {
      this.alignToByte();
      const len = this.byteAt(this.pos) | (this.byteAt(this.pos + 1) << 8);
      const nlen = this.byteAt(this.pos + 2) | (this.byteAt(this.pos + 3) << 8);
      if ((len ^ 0xffff) !== nlen) throw new InflateError();
      this.pos += 4;
      this.stored = len;
      this.state = 'stored';
    } else if (type === 1) {
      const tables = fixedTables();
      this.lit = tables.lit;
      this.dist = tables.dist;
      this.state = 'codes';
    } else if (type === 2) {
      this.readDynamicTables();
      this.state = 'codes';
    } else {
      throw new InflateError();
    }
  }

  private readDynamicTables() {
    const hlit = this.bits(5) + 257;
    const hdist = this.bits(5) + 1;
    const hclen = this.bits(4) + 4;
    const clLengths = new Uint8Array(19);
    for (let i = 0; i < hclen; i++) clLengths[CODE_LENGTH_ORDER[i]] = this.bits(3);
    const cl = buildHuffman(clLengths, 19);
    const lengths = new Uint8Array(hlit + hdist);
    let i = 0;
    while (i < hlit + hdist) {
      const sym = this.symbol(cl);
      if (sym < 16) {
        lengths[i++] = sym;
        continue;
      }
      let repeat: number;
      let value = 0;
      if (sym === 16) {
        if (!i) throw new InflateError();
        value = lengths[i - 1];
        repeat = 3 + this.bits(2);
      } else if (sym === 17) {
        repeat = 3 + this.bits(3);
      } else {
        repeat = 11 + this.bits(7);
      }
      if (i + repeat > lengths.length) throw new InflateError();
      lengths.fill(value, i, i + repeat);
      i += repeat;
    }
    this.lit = buildHuffman(lengths.subarray(0, hlit), hlit);
    this.dist = buildHuffman(lengths.subarray(hlit), hdist);
  }

  /** Decodes until the output buffer is nearly full or the stream ends. */
  private fill() {
    const out = this.out;
    const limit = out.length - MAX_MATCH;
    while (this.state !== 'done' && this.outPos < limit) {
      if (this.pos > this.data.length + 8) throw new InflateError('The guide file is cut short.');
      if (this.state === 'member') this.readMember();
      else if (this.state === 'block') this.readBlockHeader();
      else if (this.state === 'stored') {
        const n = Math.min(this.stored, limit - this.outPos, this.data.length - this.pos);
        if (n <= 0 && this.stored > 0) throw new InflateError('The guide file is cut short.');
        out.set(this.data.subarray(this.pos, this.pos + n), this.outPos);
        this.outPos += n;
        this.pos += n;
        this.stored -= n;
        if (!this.stored) this.state = 'block';
      } else {
        const lit = this.lit!;
        const dist = this.dist!;
        while (this.outPos < limit) {
          const sym = this.symbol(lit);
          if (sym < 256) {
            out[this.outPos++] = sym;
          } else if (sym === 256) {
            this.state = 'block';
            break;
          } else {
            const li = sym - 257;
            if (li >= 29) throw new InflateError();
            const length = LEN_BASE[li] + this.bits(LEN_EXTRA[li]);
            const di = this.symbol(dist);
            if (di >= 30) throw new InflateError();
            const distance = DIST_BASE[di] + this.bits(DIST_EXTRA[di]);
            let from = this.outPos - distance;
            if (from < 0) throw new InflateError();
            for (let k = 0; k < length; k++) out[this.outPos++] = out[from++];
          }
          if (this.pos > this.data.length + 8) throw new InflateError('The guide file is cut short.');
        }
      }
    }
  }

  /** The next piece of decoded output, or null once everything is out. */
  read(): Uint8Array | null {
    if (this.emitted >= this.outPos && this.state === 'done') return null;
    this.fill();
    const chunk = this.out.slice(this.emitted, this.outPos);
    // Keep the last 32 KB: back references reach that far.
    if (this.outPos > WINDOW) {
      this.out.copyWithin(0, this.outPos - WINDOW, this.outPos);
      this.outPos = WINDOW;
    }
    this.emitted = this.outPos;
    if (!chunk.length && this.state === 'done') return null;
    return chunk;
  }
}

/** Decodes everything at once; for tests and small inputs. */
export const inflateAll = (data: Uint8Array): Uint8Array => {
  const inflater = new Inflater(data);
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let chunk = inflater.read(); chunk; chunk = inflater.read()) {
    parts.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
