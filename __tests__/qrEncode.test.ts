// The QR encoder matches a reference encoder bit for bit (checked once against
// an independent MIT encoder for versions 1 to 10), keeps the fixed patterns
// in place, and refuses text that does not fit.
import {encodeQr, MAX_QR_BYTES, penalty} from '../src/lib/qr/encode';
import {qrPath} from '../src/components/QrCode';

const rows = (modules: boolean[][]) => modules.map(row => row.map(dark => (dark ? '#' : '.')).join(''));

// "https://trakt.tv/activate", version 2, level M, mask 6.
const TRAKT_ACTIVATE = [
  '#######.#.#.###...#######',
  '#.....#.#...###.#.#.....#',
  '#.###.#.##.#.##...#.###.#',
  '#.###.#..##..#.##.#.###.#',
  '#.###.#.#.....#...#.###.#',
  '#.....#...#.##..#.#.....#',
  '#######.#.#.#.#.#.#######',
  '............##.##........',
  '#..#######.##.##.#..#.###',
  '..###......#...#.#.#####.',
  '#.##..#####.#..#.##.##..#',
  '.####...##.......#.#.####',
  '.##...###...#..#..#.....#',
  '#..#....#.#...###...#..#.',
  '####..##..####.##.#.#####',
  '#.##...##.##...#.###.##.#',
  '#...#.#.#...##..#####.##.',
  '........#.###.#.#...#.##.',
  '#######.##.#....#.#.#...#',
  '#.....#.##...##.#...#..##',
  '#.###.#.#.#.#.#######....',
  '#.###.#.#.##..#.###....##',
  '#.###.#..#.##.#..#..#####',
  '#.....#..###..##.#.##.###',
  '#######.#.##....#....#..#',
];

// Top rows of 150 "z", version 8 (with version information), mask 1.
const V8_TOP = [
  '#######.##...##.#.#...##..##..##..##....#.#######',
  '#.....#..#.##.#.#..####.###.###.###.#.###.#.....#',
  '#.###.#.#.#...#.#....#...#...#...#...#.##.#.###.#',
  '#.###.#....#.#.##..#..##..##..##..##.#.#..#.###.#',
  '#.###.#...##..#....#########..##..##......#.###.#',
  '#.....#.#.#..###.###.##...#.###.###.###...#.....#',
  '#######.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#######',
];

describe('QR encoder', () => {
  it('encodes the Trakt activation URL exactly', () => {
    const qr = encodeQr('https://trakt.tv/activate', {mask: 6});
    expect(qr.version).toBe(2);
    expect(qr.size).toBe(25);
    expect(rows(qr.modules)).toEqual(TRAKT_ACTIVATE);
  });

  it('places version information from version 7 up', () => {
    const qr = encodeQr('z'.repeat(150), {mask: 1});
    expect(qr.version).toBe(8);
    expect(rows(qr.modules).slice(0, 7)).toEqual(V8_TOP);
  });

  it('picks the smallest version that fits and the mask with the lowest penalty', () => {
    expect(encodeQr('A').version).toBe(1);
    expect(encodeQr('x'.repeat(14)).version).toBe(1);
    expect(encodeQr('x'.repeat(15)).version).toBe(2);
    expect(encodeQr('w'.repeat(MAX_QR_BYTES)).version).toBe(10);
    const auto = encodeQr('https://simkl.com/pin');
    const scores = Array.from({length: 8}, (_, mask) => penalty(encodeQr('https://simkl.com/pin', {mask}).modules));
    expect(penalty(auto.modules)).toBe(Math.min(...scores));
  });

  it('keeps the three finder patterns and the timing lines on every mask', () => {
    for (let mask = 0; mask < 8; mask++) {
      const {modules, size} = encodeQr('https://trakt.tv/activate', {mask});
      const finder = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######'];
      const block = (x: number, y: number) => modules.slice(y, y + 7).map(row => row.slice(x, x + 7).map(dark => (dark ? '#' : '.')).join(''));
      expect(block(0, 0)).toEqual(finder);
      expect(block(size - 7, 0)).toEqual(finder);
      expect(block(0, size - 7)).toEqual(finder);
      for (let i = 8; i < size - 8; i++) {
        expect(modules[6][i]).toBe(i % 2 === 0);
        expect(modules[i][6]).toBe(i % 2 === 0);
      }
      // The dark module next to the lower finder.
      expect(modules[size - 8][8]).toBe(true);
    }
  });

  it('counts UTF-8 bytes and refuses text that does not fit', () => {
    expect(encodeQr('é€😀 hello').version).toBe(2);
    expect(() => encodeQr('w'.repeat(MAX_QR_BYTES + 1))).toThrow(/too long/);
  });

  it('draws one square per dark module inside the quiet zone', () => {
    const path = qrPath([[true, false], [false, true]], 4);
    expect(path).toBe('M4 4h1v1h-1zM5 5h1v1h-1z');
  });
});
