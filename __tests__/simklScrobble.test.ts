// Simkl scrobbling: start, pause and stop with progress, its own switch and
// offline queue, anime bodies, 409 as already recorded, and the 20-second lock.
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: {get: (name: string) => headers[name] ?? null},
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

const movie = {title: 'Heat', type: 'movie' as const, year: 1995, imdbId: 'tt0113277', tmdbId: '949'};
const episode = {title: 'Severance', type: 'series' as const, imdbId: 'tt11280740', season: 1, episode: 2};
const anime = {title: 'Frieren', type: 'series' as const, anime: true, malId: 52991, season: 1, episode: 5};

describe('Simkl scrobble', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  const load = () => {
    const sync = require('../src/lib/watchSync');
    const scrobble = require('../src/lib/watchSync/scrobble');
    sync.watchSyncBaseStorage.clearStore();
    sync.updateAccount('simkl', {clientId: 'scid', accessToken: 's1', tokenType: 'v1', expiresAt: Date.now() + 1e10});
    return {sync, scrobble};
  };

  const calls = (part: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(part));
  const bodyOf = (call: any[]) => JSON.parse(call[1].body);

  it('builds movie, show and anime bodies', () => {
    const {scrobble} = load();
    expect(scrobble.simklScrobbleBody(movie, 12.345)).toEqual({movie: {title: 'Heat', year: 1995, ids: {imdb: 'tt0113277', tmdb: 949}}, progress: 12.35});
    expect(scrobble.simklScrobbleBody(episode, 42)).toEqual({show: {title: 'Severance', ids: {imdb: 'tt11280740'}}, episode: {season: 1, number: 2}, progress: 42});
    expect(scrobble.simklScrobbleBody(anime, 50)).toEqual({anime: {title: 'Frieren', ids: {mal: 52991}}, episode: {season: 1, number: 5}, progress: 50});
    expect(scrobble.simklScrobbleBody({title: 'Show', type: 'series'}, 10)).toBeUndefined();
  });

  it('sends start, pause and stop to Simkl with the token and app key', async () => {
    const {scrobble} = load();
    fetchMock.mockImplementation(() => json(201, {}));
    const session = new scrobble.ScrobbleSession(movie, scrobble.simklScrobbler);
    session.update(600, 6000, true);
    session.update(1500, 6000, false);
    await expect(session.stop()).resolves.toBe('sent');
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.map(url => url.replace(/\?.*$/, ''))).toEqual([
      'https://api.simkl.com/scrobble/start',
      'https://api.simkl.com/scrobble/pause',
      'https://api.simkl.com/scrobble/stop',
    ]);
    expect(urls[0]).toContain('client_id=scid');
    expect(fetchMock.mock.calls.map(call => bodyOf(call).progress)).toEqual([10, 25, 25]);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({Authorization: 'Bearer s1', 'simkl-api-key': 'scid'});
    // Trakt is not connected: nothing went there.
    expect(calls('api.trakt.tv')).toHaveLength(0);
  });

  it('has its own switch, off without touching Trakt', async () => {
    const {sync, scrobble} = load();
    expect(scrobble.simklScrobbleEnabled()).toBe(true);
    sync.updateAccount('simkl', {scrobble: false});
    expect(scrobble.simklScrobbleEnabled()).toBe(false);
    await expect(scrobble.sendSimklScrobble('start', movie, 10)).resolves.toBe('skipped');
    sync.updateAccount('simkl', {scrobble: true, enabled: false});
    await expect(scrobble.sendSimklScrobble('stop', movie, 90)).resolves.toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('queues a stop while offline in its own queue and sends it later', async () => {
    const {scrobble} = load();
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Network request failed')));
    await expect(scrobble.sendSimklScrobble('stop', episode, 90, 1000)).resolves.toBe('queued');
    expect(scrobble.readSimklScrobbleQueue()).toHaveLength(1);
    expect(scrobble.readScrobbleQueue()).toEqual([]);
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => json(201, {action: 'scrobble'}));
    await expect(scrobble.flushAllScrobbleQueues(2000)).resolves.toBe(0);
    expect(calls('/scrobble/stop')).toHaveLength(1);
    expect(bodyOf(calls('/scrobble/stop')[0]).progress).toBe(90);
  });

  it('treats 409 as already recorded and waits after the 20-second lock', async () => {
    const {scrobble} = load();
    fetchMock.mockImplementation(() => json(409, {watched_at: 'x'}));
    await expect(scrobble.sendSimklScrobble('stop', movie, 95, 1000)).resolves.toBe('sent');
    fetchMock.mockImplementation(() => json(429, {}, {'Retry-After': '20'}));
    await expect(scrobble.sendSimklScrobble('stop', movie, 95, 5000)).resolves.toBe('queued');
    expect(scrobble.simklScrobbler.blockedUntil()).toBe(25_000);
    // Trakt's wait is separate.
    expect(scrobble.scrobbleBlockedUntil()).toBe(0);
    fetchMock.mockClear();
    await expect(scrobble.sendSimklScrobble('start', episode, 5, 10_000)).resolves.toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops scrobbles once Simkl ends the sign-in', async () => {
    const {sync, scrobble} = load();
    fetchMock.mockImplementation(() => json(401, {error: 'invalid_token'}));
    await expect(scrobble.sendSimklScrobble('stop', movie, 90, 1000)).resolves.toBe('dropped');
    expect(scrobble.readSimklScrobbleQueue()).toEqual([]);
    expect(sync.readSyncSettings().simkl.accessToken).toBe('');
  });
});
