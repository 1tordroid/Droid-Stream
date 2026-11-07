jest.mock('../src/lib/linkGrabber', () => ({queueLink: jest.fn()}));
jest.mock('../src/lib/torrentManager', () => ({torrentManager: {}}));
jest.mock('../src/lib/sources/vault', () => ({readPikPakAccount: () => undefined}));
jest.mock('../src/lib/storage', () => ({settingsStorage: {clipboardGrabber: () => 'ask'}}));
import {algorithmFor, checksumMatches} from '../src/lib/checksum';
import {classifyLink, linkInText, offerLink} from '../src/lib/linkIntake';

it('classifies incoming links', () => {
  expect(classifyLink('magnet:?xt=urn:btih:abc')).toBe('magnet');
  expect(classifyLink('https://x.test/a.torrent')).toBe('torrent');
  expect(classifyLink('content://downloads/1')).toBe('torrent');
  expect(classifyLink('https://x.test/video.mp4')).toBe('http');
  expect(classifyLink('hello')).toBeNull();
});

it('finds a magnet or file link inside copied text', () => {
  const magnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=x`;
  expect(linkInText(`look ${magnet} here`)).toBe(magnet);
  expect(linkInText('get https://cdn.test/file.mkv?token=1 now')).toBe('https://cdn.test/file.mkv?token=1');
  expect(linkInText('https://example.com/page')).toBeUndefined();
});

it('guesses checksum algorithms and compares case-insensitively', () => {
  expect(algorithmFor('d41d8cd98f00b204e9800998ecf8427e')).toBe('md5');
  expect(algorithmFor('a'.repeat(64))).toBe('sha256');
  expect(algorithmFor('nope')).toBeUndefined();
  expect(checksumMatches('ABC', ' abc ')).toBe(true);
});

it('opens the photo sheet for a shared social post, and asks first for a copied one', () => {
  const navigate = jest.fn();
  offerLink('See https://www.instagram.com/p/C3xYzAbCdEf/?igsh=1', navigate, 'shared');
  expect(navigate).toHaveBeenCalledWith('SocialDownload', {url: 'https://www.instagram.com/p/C3xYzAbCdEf/?igsh=1'});
  expect(linkInText('copied https://x.com/a/status/1850000000000000001 text')).toBe('https://x.com/a/status/1850000000000000001');
  navigate.mockClear();
  offerLink('https://www.reddit.com/r/pics/comments/2fghij/sunset/', navigate, 'clipboard');
  expect(navigate).not.toHaveBeenCalled();
});
