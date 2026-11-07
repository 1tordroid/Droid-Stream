/* eslint-disable no-bitwise -- QR encoding is bit manipulation throughout. */
/**
 * A small QR code encoder (ISO/IEC 18004, model 2) for short texts such as a
 * sign-in URL. Byte mode, error correction level M, versions 1 to 10 (up to
 * 213 bytes). Pure TypeScript, no native code.
 */

/** A square of modules, row by row: true is dark. */
export interface QrMatrix {
  size: number;
  modules: boolean[][];
  version: number;
  mask: number;
}

// Per version (index 0 = version 1), level M: error correction codewords per
// block and the data codewords of each block.
const BLOCKS_M: {ec: number; data: number[]}[] = [
  {ec: 10, data: [16]},
  {ec: 16, data: [28]},
  {ec: 26, data: [44]},
  {ec: 18, data: [32, 32]},
  {ec: 24, data: [43, 43]},
  {ec: 16, data: [27, 27, 27, 27]},
  {ec: 18, data: [31, 31, 31, 31]},
  {ec: 22, data: [38, 38, 39, 39]},
  {ec: 22, data: [36, 36, 36, 37, 37]},
  {ec: 26, data: [43, 43, 43, 43, 44]},
];

const ALIGNMENT: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

/** Format bits of level M. */
const LEVEL_M_BITS = 0;

export const MAX_QR_BYTES = 213;

const utf8 = (text: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low < 0xe000) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return out;
};

// ---------------------------------------------------------------- Reed-Solomon over GF(256), polynomial 0x11d
const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const gfMul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial coefficients for `degree` EC codewords, highest power first, leading 1 dropped. */
const generator = (degree: number): number[] => {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly.slice(1);
};

const ecCodewords = (data: number[], degree: number): number[] => {
  const gen = generator(degree);
  const rem = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i], factor);
  }
  return rem;
};

// ---------------------------------------------------------------- data codewords
const dataCapacity = (version: number): number => BLOCKS_M[version - 1].data.reduce((sum, n) => sum + n, 0);

/** Smallest version whose capacity holds `length` bytes, or undefined when too long. */
const pickVersion = (length: number): number | undefined => {
  for (let version = 1; version <= BLOCKS_M.length; version++) {
    const countBits = version < 10 ? 8 : 16;
    if (4 + countBits + length * 8 <= dataCapacity(version) * 8) return version;
  }
  return undefined;
};

const encodeData = (bytes: number[], version: number): number[] => {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacityBits = dataCapacity(version) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  for (let pad = 0xec; codewords.length < dataCapacity(version); pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
};

const interleave = (data: number[], version: number): number[] => {
  const {ec, data: sizes} = BLOCKS_M[version - 1];
  const blocks: number[][] = [];
  let offset = 0;
  for (const size of sizes) {
    blocks.push(data.slice(offset, offset + size));
    offset += size;
  }
  const ecBlocks = blocks.map(block => ecCodewords(block, ec));
  const out: number[] = [];
  const longest = Math.max(...sizes);
  for (let i = 0; i < longest; i++) for (const block of blocks) if (i < block.length) out.push(block[i]);
  for (let i = 0; i < ec; i++) for (const block of ecBlocks) out.push(block[i]);
  return out;
};

// ---------------------------------------------------------------- matrix
const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  x => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

const bit = (value: number, index: number): boolean => ((value >>> index) & 1) !== 0;

class Builder {
  readonly size: number;
  readonly modules: boolean[][];
  readonly fixed: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({length: this.size}, () => new Array<boolean>(this.size).fill(false));
    this.fixed = Array.from({length: this.size}, () => new Array<boolean>(this.size).fill(false));
    this.drawFunctionPatterns();
  }

  /** x is the column, y the row. */
  set(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.fixed[y][x] = true;
  }

  private drawFunctionPatterns() {
    const {size} = this;
    for (let i = 0; i < size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(size - 4, 3);
    this.finder(3, size - 4);
    const positions = ALIGNMENT[this.version - 1];
    const last = positions.length - 1;
    positions.forEach((y, i) =>
      positions.forEach((x, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }),
    );
    // Reserve the format areas; the real bits are drawn once the mask is known.
    this.drawFormat(0);
    this.drawVersion();
  }

  private finder(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        this.set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }

  drawFormat(mask: number) {
    const data = (LEVEL_M_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const {size} = this;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(bits, i));
    this.set(8, 7, bit(bits, 6));
    this.set(8, 8, bit(bits, 7));
    this.set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.set(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.set(8, size - 15 + i, bit(bits, i));
    this.set(8, size - 8, true);
  }

  private drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = bit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, dark);
      this.set(b, a, dark);
    }
  }

  placeData(codewords: number[]) {
    const {size} = this;
    let index = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (this.fixed[y][x] || index >= codewords.length * 8) continue;
          this.modules[y][x] = bit(codewords[index >>> 3], 7 - (index & 7));
          index++;
        }
      }
    }
  }

  applyMask(mask: number) {
    const test = MASKS[mask];
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) if (!this.fixed[y][x] && test(x, y)) this.modules[y][x] = !this.modules[y][x];
  }
}

/** Penalty score from the standard's four rules; the lowest-scoring mask is used. */
export const penalty = (modules: boolean[][]): number => {
  const size = modules.length;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) {
        run++;
        continue;
      }
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
    }
    // Finder-like 1:1:3:1:1 with four light modules on one side.
    for (let i = 0; i + 10 < size; i++) {
      const seq = Array.from({length: 11}, (_, k) => get(i + k));
      const core = seq[4] && !seq[5] && seq[6] && seq[7] && seq[8] && !seq[9] && seq[10];
      const coreRev = seq[0] && !seq[1] && seq[2] && seq[3] && seq[4] && !seq[5] && seq[6];
      if (core && !seq[0] && !seq[1] && !seq[2] && !seq[3]) score += 40;
      if (coreRev && !seq[7] && !seq[8] && !seq[9] && !seq[10]) score += 40;
    }
  };
  for (let y = 0; y < size; y++) line(x => modules[y][x]);
  for (let x = 0; x < size; x++) line(y => modules[y][x]);
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
    }
  }
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return score + Math.max(0, k) * 10;
};

/**
 * Encodes `text` as a QR code. Throws when it is longer than MAX_QR_BYTES
 * bytes of UTF-8. `mask` forces a mask pattern (0 to 7); by default the one
 * with the lowest penalty is chosen.
 */
export const encodeQr = (text: string, options: {mask?: number} = {}): QrMatrix => {
  const bytes = utf8(text);
  const version = pickVersion(bytes.length);
  if (!version) throw new Error(`Text is too long for a QR code (${bytes.length} bytes, at most ${MAX_QR_BYTES})`);
  const codewords = interleave(encodeData(bytes, version), version);
  const build = (mask: number) => {
    const builder = new Builder(version);
    builder.placeData(codewords);
    builder.applyMask(mask);
    builder.drawFormat(mask);
    return builder;
  };
  if (options.mask !== undefined) {
    const builder = build(options.mask);
    return {size: builder.size, modules: builder.modules, version, mask: options.mask};
  }
  let best: {builder: Builder; mask: number; score: number} | undefined;
  for (let mask = 0; mask < 8; mask++) {
    const builder = build(mask);
    const score = penalty(builder.modules);
    if (!best || score < best.score) best = {builder, mask, score};
  }
  return {size: best!.builder.size, modules: best!.builder.modules, version, mask: best!.mask};
};
