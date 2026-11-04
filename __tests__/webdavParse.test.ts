import {joinUrl, parsePropfind} from '../src/lib/sources/webdav';

it('joins a WebDAV href onto the server', () => {
  expect(joinUrl('https://nas.local/dav', '/dav/movies')).toBe('https://nas.local/dav/movies');
});

it('reads files and folders from a PROPFIND body', () => {
  const xml = `
    <d:response><d:href>/dav/</d:href><d:resourcetype><d:collection/></d:resourcetype></d:response>
    <d:response><d:href>/dav/clip.mkv</d:href><d:getcontentlength>42</d:getcontentlength></d:response>
  `;
  expect(parsePropfind(xml, 'https://nas.local')).toEqual([
    {name: 'dav', href: 'https://nas.local/dav', directory: true, size: undefined},
    {name: 'clip.mkv', href: 'https://nas.local/dav/clip.mkv', directory: false, size: 42},
  ]);
});
