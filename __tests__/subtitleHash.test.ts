import {opensubtitlesHash} from '../src/lib/subtitles/hashMatch';

it('computes the OpenSubtitles hash with 64-bit wraparound', () => {
  const head = new Uint8Array(65536);
  const tail = new Uint8Array(65536);
  // One word of all 0xff in each chunk forces carries across both halves.
  head.fill(0xff, 0, 8);
  tail.fill(0x01, 0, 8);
  const size = 131072;
  // size + 0xffffffffffffffff + 0x0101010101010101 (mod 2^64)
  const expected = ((BigInt(size) + 0xffffffffffffffffn + 0x0101010101010101n) & 0xffffffffffffffffn).toString(16).padStart(16, '0');
  expect(opensubtitlesHash(size, head, tail)).toBe(expected);
  expect(opensubtitlesHash(0, new Uint8Array(16), new Uint8Array(16))).toBe('0000000000000000');
});
