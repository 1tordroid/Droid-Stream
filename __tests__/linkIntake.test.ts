jest.mock('../src/lib/linkGrabber', () => ({queueLink: jest.fn()}));
jest.mock('../src/lib/torrentManager', () => ({torrentManager: {}}));
jest.mock('../src/lib/sources/vault', () => ({readPikPakAccount: () => undefined}));
jest.mock('../src/lib/storage', () => ({settingsStorage: {clipboardGrabber: () => 'ask'}}));
import {algorithmFor, checksumMatches} from '../src/lib/checksum';
import {classifyLink, linkInText} from '../src/lib/linkIntake';

it('classifies incoming links', () => {
  expect(classifyLink('magnet:?xt=urn:btih:abc')).toBe('magnet');
  expect(classifyLink('https://x.test/a.torrent')).toBe('torrent');
  expect(classifyLink('content://downloads/1')).toBe('torrent');
  expect(classifyLink('https://x.test/video.mp4')).toBe('http');
  expect(classifyLink('hello')).toBeNull();
  expect(classifyLink('ed2k://|file|a.iso|10|965c013e991ee246d63d45ea71954c4d|/')).toBe('ed2k');
});

it('finds a magnet or file link inside copied text', () => {
  const magnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=x`;
  expect(linkInText(`look ${magnet} here`)).toBe(magnet);
  expect(linkInText('get https://cdn.test/file.mkv?token=1 now')).toBe('https://cdn.test/file.mkv?token=1');
  expect(linkInText('https://example.com/page')).toBeUndefined();
  expect(linkInText('see ed2k://|server|1.2.3.4|4661|/ please')).toBe('ed2k://|server|1.2.3.4|4661|/');
});

it('guesses checksum algorithms and compares case-insensitively', () => {
  expect(algorithmFor('d41d8cd98f00b204e9800998ecf8427e')).toBe('md5');
  expect(algorithmFor('a'.repeat(64))).toBe('sha256');
  expect(algorithmFor('nope')).toBeUndefined();
  expect(checksumMatches('ABC', ' abc ')).toBe(true);
});
