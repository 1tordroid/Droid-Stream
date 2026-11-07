/**
 * Checks that a pattern from a rules file stays inside a small subset of
 * JavaScript regular expressions that cannot backtrack for ever (ReDoS).
 * JavaScript has no regex timeout, so a pattern is accepted only when its
 * shape is known to be safe:
 *
 * - at most MAX_PATTERN_LENGTH characters and MAX_REPEATS repeated parts;
 * - flags only from ALLOWED_FLAGS;
 * - no back-references, look-arounds, named groups or Unicode classes;
 * - nothing that repeats (*, +, {n,} or {n,m} with m > 1) contains a part
 *   of varying length ("star height" of one, and no "?" inside a repeat);
 * - inside a repeated part, every group with alternatives ("(?:a|b)*")
 *   has alternatives that start with characters that can never be the
 *   same, so the engine never has two ways to read the same text.
 */

export const MAX_PATTERN_LENGTH = 400;
export const MAX_REPEATS = 12;
export const ALLOWED_FLAGS = 'ims';
const MAX_COUNT = 1000;

type Range = [number, number];

/** The characters a part can start with: a set, everything except a set, or anything. */
type FirstSet = {kind: 'set'; ranges: Range[]} | {kind: 'not'; ranges: Range[]} | {kind: 'any'};

interface Atom {
  first: FirstSet;
  /** The atom is a group that contains a part of varying length (*, +, ?, {n,m}). */
  varying: boolean;
  /** The atom is, or contains, a group whose alternatives can start alike. */
  overlapping: boolean;
  /** The atom matches only an empty string (an anchor). */
  empty: boolean;
}

interface Piece {
  atom: Atom;
  min: number;
  max: number;
}

export class UnsafePattern extends Error {}

const fail = (why: string): never => {
  throw new UnsafePattern(why);
};

const code = (char: string) => char.codePointAt(0) as number;

const SHORTHAND = new Set(['d', 'D', 'w', 'W', 's', 'S']);
const ANCHOR_ESCAPES = new Set(['b', 'B']);
const CONTROL_ESCAPES: Record<string, number> = {n: 10, r: 13, t: 9, f: 12, v: 11, '0': 0};

class Parser {
  private at = 0;
  repeats = 0;
  private varying = 0;

  constructor(
    private readonly source: string,
    private readonly ignoreCase: boolean,
  ) {}

  parse(): void {
    this.alternation(false);
    if (this.at < this.source.length) fail(`unexpected ")" at ${this.at}`);
  }

  private peek(offset = 0): string {
    return this.source[this.at + offset] ?? '';
  }

  /** Alternatives up to ")" or the end. */
  private alternation(inGroup: boolean): {alternatives: Piece[][]} {
    const alternatives: Piece[][] = [this.sequence()];
    while (this.peek() === '|') {
      this.at += 1;
      alternatives.push(this.sequence());
    }
    if (inGroup) {
      if (this.peek() !== ')') fail('a group is not closed');
      this.at += 1;
    }
    return {alternatives};
  }

  private sequence(): Piece[] {
    const pieces: Piece[] = [];
    while (this.at < this.source.length && this.peek() !== '|' && this.peek() !== ')') {
      const atom = this.atom();
      const {min, max} = this.quantifier();
      if (max !== 1 || min !== 1) {
        if (atom.empty) fail('an anchor cannot repeat');
        if (min !== max) this.varying += 1;
        if (max > 1) {
          this.repeats += 1;
          if (atom.varying) fail('a repeated part contains a part of varying length');
          if (atom.overlapping) fail('a repeated part has alternatives that can start with the same character');
        }
      }
      pieces.push({atom, min, max});
    }
    return pieces;
  }

  private quantifier(): {min: number; max: number} {
    const char = this.peek();
    let min = 1;
    let max = 1;
    if (char === '*' || char === '+' || char === '?') {
      this.at += 1;
      min = char === '+' ? 1 : 0;
      max = char === '?' ? 1 : Infinity;
    } else if (char === '{') {
      const match = /^\{(\d{1,4})(,(\d{0,4}))?\}/.exec(this.source.slice(this.at));
      if (!match) fail('write a literal "{" as "\\{"');
      const found = match as RegExpExecArray;
      this.at += found[0].length;
      min = Number(found[1]);
      max = found[2] === undefined ? min : found[3] ? Number(found[3]) : Infinity;
      if (min > MAX_COUNT || (max !== Infinity && (max > MAX_COUNT || max < min))) fail('a repeat count is too large');
    } else {
      return {min, max};
    }
    if (this.peek() === '?') this.at += 1;
    const next = this.peek();
    if (next === '*' || next === '+' || next === '?' || next === '{') fail('two repeats in a row');
    return {min, max};
  }

  private atom(): Atom {
    const char = this.peek();
    if (char === '(') return this.group();
    if (char === '[') return this.charClass();
    if (char === '*' || char === '+' || char === '?' || char === '{') fail(`nothing to repeat at ${this.at}`);
    if (char === '}' || char === ']') fail(`write a literal "${char}" with a backslash`);
    this.at += 1;
    if (char === '^' || char === '$') return {first: {kind: 'any'}, varying: false, overlapping: false, empty: true};
    if (char === '.') return {first: {kind: 'any'}, varying: false, overlapping: false, empty: false};
    if (char === '\\') return this.escape();
    return this.literal(code(char));
  }

  private literal(value: number): Atom {
    return {first: {kind: 'set', ranges: this.fold([[value, value]])}, varying: false, overlapping: false, empty: false};
  }

  /** With the "i" flag, a letter also stands for its other case. */
  private fold(ranges: Range[]): Range[] {
    if (!this.ignoreCase) return ranges;
    const extra: Range[] = [];
    for (const [low, high] of ranges) {
      const upperLow = Math.max(low, 65);
      const upperHigh = Math.min(high, 90);
      if (upperLow <= upperHigh) extra.push([upperLow + 32, upperHigh + 32]);
      const lowerLow = Math.max(low, 97);
      const lowerHigh = Math.min(high, 122);
      if (lowerLow <= lowerHigh) extra.push([lowerLow - 32, lowerHigh - 32]);
      // Non-ASCII letters fold in ways this check does not model.
      if (high > 127) extra.push([128, 0x10ffff]);
    }
    return [...ranges, ...extra];
  }

  private escape(): Atom {
    const char = this.peek();
    if (!char) fail('the pattern ends with a backslash');
    this.at += 1;
    if (/[1-9]/.test(char) || char === 'k') fail('back-references are not allowed');
    if (char === 'p' || char === 'P') fail('Unicode classes are not allowed');
    if (char === 'c') fail('control escapes are not allowed');
    if (ANCHOR_ESCAPES.has(char)) return {first: {kind: 'any'}, varying: false, overlapping: false, empty: true};
    if (SHORTHAND.has(char)) return {first: {kind: 'any'}, varying: false, overlapping: false, empty: false};
    return this.literal(this.escapedValue(char));
  }

  /** Value of the character after a backslash (already read). */
  private escapedValue(char: string): number {
    if (char in CONTROL_ESCAPES) {
      if (char === '0' && /\d/.test(this.peek())) fail('octal escapes are not allowed');
      return CONTROL_ESCAPES[char];
    }
    if (char === 'x') {
      const hex = /^[0-9a-fA-F]{2}/.exec(this.source.slice(this.at));
      if (!hex) fail('"\\x" needs two hex digits');
      this.at += 2;
      return Number.parseInt((hex as RegExpExecArray)[0], 16);
    }
    if (char === 'u') {
      const hex = /^[0-9a-fA-F]{4}/.exec(this.source.slice(this.at));
      if (!hex) fail('"\\u" needs four hex digits');
      this.at += 4;
      return Number.parseInt((hex as RegExpExecArray)[0], 16);
    }
    if (/[A-Za-z]/.test(char)) fail(`unknown escape "\\${char}"`);
    return code(char);
  }

  private group(): Atom {
    this.at += 1;
    if (this.peek() === '?') {
      if (this.peek(1) !== ':') fail('only "(" and "(?:" groups are allowed');
      this.at += 2;
    }
    const before = this.varying;
    const {alternatives} = this.alternation(true);
    const varying = this.varying > before;
    const inner = alternatives.some(pieces => pieces.some(piece => piece.atom.overlapping));
    const firsts = alternatives.map(pieces => this.firstOf(pieces));
    if (firsts.length === 1) return {first: firsts[0], varying, overlapping: inner, empty: false};
    const disjoint = firsts.every((left, index) => firsts.slice(index + 1).every(right => apart(left, right)));
    return {
      first: disjoint ? firsts.reduce(union) : {kind: 'any'},
      varying,
      overlapping: inner || !disjoint,
      empty: false,
    };
  }

  private firstOf(pieces: Piece[]): FirstSet {
    const lead = pieces[0];
    // An empty alternative, or one that may skip its first part, can start with anything.
    if (!lead || lead.min === 0 || lead.atom.empty) return {kind: 'any'};
    return lead.atom.first;
  }

  private charClass(): Atom {
    this.at += 1;
    let negated = false;
    if (this.peek() === '^') {
      negated = true;
      this.at += 1;
    }
    const ranges: Range[] = [];
    let any = false;
    if (this.peek() === ']') fail('a character class is empty');
    while (this.peek() !== ']') {
      const char = this.peek();
      if (!char) fail('a character class is not closed');
      if (char === '[') fail('write a literal "[" in a class as "\\["');
      const low = this.classChar();
      if (low === undefined) {
        any = true;
        continue;
      }
      if (this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== '') {
        this.at += 1;
        const high = this.classChar();
        if (high === undefined) fail('a range cannot end in a class shorthand');
        if ((high as number) < low) fail('a range is out of order');
        ranges.push([low, high as number]);
      } else {
        ranges.push([low, low]);
      }
    }
    this.at += 1;
    if (any) return {first: {kind: 'any'}, varying: false, overlapping: false, empty: false};
    const folded = this.fold(ranges);
    return {first: negated ? {kind: 'not', ranges: folded} : {kind: 'set', ranges: folded}, varying: false, overlapping: false, empty: false};
  }

  /** One character inside [...]; undefined for \d, \w and the like. */
  private classChar(): number | undefined {
    const char = this.peek();
    this.at += 1;
    if (char !== '\\') return code(char);
    const next = this.peek();
    if (!next) fail('the pattern ends with a backslash');
    this.at += 1;
    if (SHORTHAND.has(next)) return undefined;
    if (next === 'b') return 8;
    if (/[1-9]/.test(next) || next === 'k' || next === 'p' || next === 'P' || next === 'c' || next === 'B') {
      fail(`"\\${next}" is not allowed in a class`);
    }
    return this.escapedValue(next);
  }
}

const overlaps = (left: Range[], right: Range[]): boolean =>
  left.some(([lowA, highA]) => right.some(([lowB, highB]) => lowA <= highB && lowB <= highA));

/** Every character of [inner] is in [outer]. */
const covered = (inner: Range[], outer: Range[]): boolean =>
  inner.every(([low, high]) => {
    // Walk the range through the outer ranges.
    let next = low;
    while (next <= high) {
      const holder = outer.find(([a, b]) => a <= next && next <= b);
      if (!holder) return false;
      next = holder[1] + 1;
    }
    return true;
  });

/** No character can start both. */
const apart = (left: FirstSet, right: FirstSet): boolean => {
  if (left.kind === 'any' || right.kind === 'any') return false;
  if (left.kind === 'set' && right.kind === 'set') return !overlaps(left.ranges, right.ranges);
  if (left.kind === 'not' && right.kind === 'not') return false;
  const set = left.kind === 'set' ? left : right;
  const not = left.kind === 'not' ? left : right;
  return covered(set.ranges, not.ranges);
};

const union = (left: FirstSet, right: FirstSet): FirstSet => {
  if (left.kind === 'set' && right.kind === 'set') return {kind: 'set', ranges: [...left.ranges, ...right.ranges]};
  return {kind: 'any'};
};

/**
 * Throws UnsafePattern when the pattern is outside the safe subset, and
 * returns the compiled pattern otherwise.
 */
export const checkSafePattern = (source: string, flags = ''): RegExp => {
  if (typeof source !== 'string' || !source) fail('the pattern is empty');
  if (source.length > MAX_PATTERN_LENGTH) fail(`the pattern is longer than ${MAX_PATTERN_LENGTH} characters`);
  if (typeof flags !== 'string' || flags.length > ALLOWED_FLAGS.length) fail('too many flags');
  for (const [index, flag] of [...flags].entries()) {
    if (!ALLOWED_FLAGS.includes(flag)) fail(`the flag "${flag}" is not allowed`);
    if (flags.indexOf(flag) !== index) fail(`the flag "${flag}" is given twice`);
  }
  const parser = new Parser(source, flags.includes('i'));
  parser.parse();
  if (parser.repeats > MAX_REPEATS) fail(`more than ${MAX_REPEATS} repeated parts`);
  try {
    return new RegExp(source, flags);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'the pattern does not compile');
  }
};
