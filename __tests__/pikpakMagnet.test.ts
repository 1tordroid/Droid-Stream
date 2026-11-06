import {assertMagnet} from '../src/lib/pikpak/client';

it('accepts a magnet link and rejects other text', () => {
  expect(assertMagnet('  magnet:?xt=urn:btih:abc  ')).toBe('magnet:?xt=urn:btih:abc');
  expect(() => assertMagnet('https://example.com/file')).toThrow('magnet');
});
