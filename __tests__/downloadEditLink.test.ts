import {
  applyHeaderEdit,
  checkReplacementLink,
  readEditableHeaders,
  validateDownloadUrl,
} from '../src/lib/downloadEngine/linkIdentity';

describe('replacement link check', () => {
  const saved = {totalBytes: 1_000_000, etag: '"abc"', lastModified: 'Tue, 01 Oct 2024 10:00:00 GMT'};

  it('accepts the same size with a matching validator', () => {
    expect(checkReplacementLink(saved, {size: 1_000_000, etag: 'W/"abc"', acceptRanges: true})).toEqual({ok: true});
    // A different ETag from another host is fine when Last-Modified matches.
    expect(checkReplacementLink(saved, {size: 1_000_000, etag: '"zzz"', lastModified: saved.lastModified, acceptRanges: true})).toEqual({ok: true});
  });

  it('accepts the same size when the server sends no validators', () => {
    expect(checkReplacementLink({totalBytes: 10}, {size: 10, acceptRanges: true})).toEqual({ok: true});
    expect(checkReplacementLink(saved, {size: 1_000_000, acceptRanges: true})).toEqual({ok: true});
  });

  it('refuses a different size', () => {
    const result = checkReplacementLink(saved, {size: 999_999, acceptRanges: true});
    expect(result).toMatchObject({ok: false, reason: 'size'});
  });

  it('refuses an unknown size', () => {
    expect(checkReplacementLink(saved, {size: -1, acceptRanges: true})).toMatchObject({ok: false, reason: 'no-size'});
    expect(checkReplacementLink({totalBytes: 0}, {size: 5, acceptRanges: true})).toMatchObject({ok: false, reason: 'no-size'});
  });

  it('refuses a server without byte ranges', () => {
    expect(checkReplacementLink(saved, {size: 1_000_000, acceptRanges: false})).toMatchObject({ok: false, reason: 'ranges'});
  });

  it('refuses when a validator says the file changed', () => {
    expect(checkReplacementLink(saved, {size: 1_000_000, etag: '"new"', acceptRanges: true})).toMatchObject({ok: false, reason: 'changed'});
    expect(
      checkReplacementLink(saved, {size: 1_000_000, etag: '"new"', lastModified: 'Wed, 02 Oct 2024 10:00:00 GMT', acceptRanges: true}),
    ).toMatchObject({ok: false, reason: 'changed'});
  });
});

describe('header edits', () => {
  it('replaces Cookie, Referer and User-Agent whatever their case, keeping the rest', () => {
    const headers = {cookie: 'a=1', 'user-agent': 'Old', Authorization: 'Bearer x'};
    expect(readEditableHeaders(headers)).toEqual({cookie: 'a=1', referer: '', userAgent: 'Old'});
    expect(applyHeaderEdit(headers, {cookie: 'b=2', referer: 'https://site.example/', userAgent: ''})).toEqual({
      Authorization: 'Bearer x',
      Cookie: 'b=2',
      Referer: 'https://site.example/',
    });
  });

  it('leaves fields that were not edited and strips line breaks', () => {
    expect(applyHeaderEdit({Referer: 'r'}, {cookie: 'x=1\r\ny=2'})).toEqual({Referer: 'r', Cookie: 'x=1 y=2'});
  });
});

describe('typed links', () => {
  it('accepts http, https and ftp links', () => {
    expect(validateDownloadUrl('https://cdn.example.com/file.mkv')).toBeUndefined();
    expect(validateDownloadUrl('ftp://user@host/file')).toBeUndefined();
    expect(validateDownloadUrl('')).toBe('Enter a link.');
    expect(validateDownloadUrl('https://a b')).toBe('The link has spaces in it.');
    expect(validateDownloadUrl('magnet:?xt=1')).toMatch(/must start/);
  });
});
