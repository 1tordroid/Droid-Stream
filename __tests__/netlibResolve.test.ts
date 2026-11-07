// Playing library files: WebDAV with its sign-in headers, device files as they
// are, SMB through a stream; matching four at a time with backoff on 429.
jest.mock('../src/lib/sources/smb', () => ({
  openSmbStream: jest.fn(async () => `http://127.0.0.1:1/${'c'.repeat(32)}/a.mkv`),
  listSmbShare: jest.fn(),
  canStreamSmb: () => true,
  normalizeSmbPath: (path: string) => path,
  smbFileLink: jest.fn(),
}));

describe('netlib resolve and match', () => {
  beforeEach(() => jest.resetModules());

  const load = () => ({
    vault: require('../src/lib/sources/vault'),
    cache: require('../src/lib/netlib/cache'),
    ids: require('../src/lib/netlib/ids'),
    resolve: require('../src/lib/netlib/resolve'),
  });

  it('resolves WebDAV, SMB and device files', async () => {
    const {vault, cache, ids, resolve} = load();
    vault.saveSource({id: 'w', kind: 'webdav', name: 'DAV', server: 'https://dav.local', username: 'me', secret: 'pw'});
    vault.saveSource({id: 's', kind: 'smb', name: 'NAS', server: 'nas', username: 'u', secret: 'p', share: 'M'});
    cache.saveDeviceSource({id: 'device:1', kind: 'device', name: 'Phone', root: 'content://tree'});
    const webdav = await resolve.resolveNetlibStream(ids.versionKey('w', 'https://dav.local/a b.mkv'));
    expect(webdav).toMatchObject({url: 'https://dav.local/a b.mkv', headers: {Authorization: expect.stringMatching(/^Basic /)}});
    expect((await resolve.resolveNetlibStream(ids.versionKey('s', '/Movies/a.mkv'))).url).toMatch(/^http:\/\/127\.0\.0\.1/);
    expect(await resolve.resolveNetlibStream(ids.versionKey('device:1', 'content://tree/doc/a.mkv'))).toMatchObject({local: true, url: 'content://tree/doc/a.mkv'});
    await expect(resolve.resolveNetlibStream(ids.versionKey('gone', '/x.mkv'))).rejects.toThrow(/removed/);
    expect(resolve.listNetlibSources().map((source: any) => source.id)).toEqual(['w', 's', 'device:1']);
  });

  it('matches with TMDB four at a time, retries a 429 and caches the answers', async () => {
    const {cache} = load();
    const {matchItems, MATCH_CONCURRENCY} = require('../src/lib/netlib/match');
    let inFlight = 0;
    let peak = 0;
    let limited = false;
    const fetchMock = jest.fn(async (url: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      if (!limited) {
        limited = true;
        return {ok: false, status: 429, headers: {get: () => '0.001'}};
      }
      const query = decodeURIComponent(/query=([^&]+)/.exec(url)![1]);
      return {
        ok: true,
        status: 200,
        json: async () => ({results: [{id: query.length, title: query, release_date: '2010-01-01', popularity: 1, poster_path: '/p.jpg'}]}),
      };
    });
    (globalThis as any).fetch = fetchMock;
    const items = Array.from({length: 9}, (_, index) => ({id: `i${index}`, sourceId: 'w', kind: 'movie', title: `Title ${index}`, year: 2010, versions: [], episodes: [], added: 0}));
    const found: Record<string, any> = {};
    await matchItems(items, {tmdbKey: 'k', onMatch: (id: string, match: any) => (found[id] = match)});
    expect(peak).toBeLessThanOrEqual(MATCH_CONCURRENCY);
    expect(Object.keys(found)).toHaveLength(9);
    expect(found.i3).toMatchObject({title: 'Title 3', tmdbId: 7, poster: 'https://image.tmdb.org/t/p/w342/p.jpg'});
    const calls = fetchMock.mock.calls.length;
    await matchItems(items, {tmdbKey: 'k', onMatch: () => undefined});
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(cache.getCachedMatch('movie:title 3:2010')).toMatchObject({tmdbId: 7});
  }, 15000);
});
