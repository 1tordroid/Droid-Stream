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

it('reads any namespace prefix, dates, etags and bad percent-encoding', () => {
  const xml = `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:lp1="DAV:">
    <response><href>/dav/50%25%20off%zz.mkv</href><propstat><prop>
      <lp1:getcontentlength>7</lp1:getcontentlength>
      <lp1:getlastmodified>Tue, 03 Nov 2026 10:00:00 GMT</lp1:getlastmodified>
      <lp1:getetag>W/"abc&amp;1"</lp1:getetag><resourcetype/></prop></propstat></response>
    <a:response xmlns:a="DAV:"><a:href>/dav/Shows/</a:href><a:propstat><a:prop><a:resourcetype><a:collection></a:collection></a:resourcetype></a:prop></a:propstat></a:response>
  </multistatus>`;
  const [file, folder] = parsePropfind(xml, 'https://nas.local');
  expect(file).toMatchObject({name: '50%25%20off%zz.mkv', directory: false, size: 7, modified: Date.UTC(2026, 10, 3, 10), etag: 'abc&1'});
  expect(folder).toMatchObject({name: 'Shows', directory: true});
});
