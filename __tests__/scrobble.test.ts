// Trakt scrobbling: start, pause and stop with progress, a stop queued while
// offline and sent later, backing off on 420 and 429, a setting that turns it
// off, and one watch only when the player also reports the title as watched.
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: {get: (name: string) => headers[name] ?? null},
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

const HOUR = 3600_000;
const movie = {title: 'Heat', type: 'movie' as const, year: 1995, imdbId: 'tt0113277', tmdbId: '949'};
const episode = {title: 'Severance', type: 'series' as const, imdbId: 'tt11280740', season: 1, episode: 2};

describe('Trakt scrobble', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  const load = () => {
    const sync = require('../src/lib/watchSync');
    const scrobble = require('../src/lib/watchSync/scrobble');
    // The stores are in memory and shared between module loads: start clean.
    sync.watchSyncBaseStorage.clearStore();
    sync.updateAccount('trakt', {clientId: 'cid', clientSecret: 'secret', accessToken: 'a1', refreshToken: 'r1', issuedAt: Date.now(), expiresAt: Date.now() + 20 * HOUR});
    return {sync, scrobble};
  };

  const calls = (part: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(part));
  const bodyOf = (call: any[]) => JSON.parse(call[1].body);

  it('builds movie and episode bodies with the ids the app has', () => {
    const {scrobble} = load();
    expect(scrobble.scrobbleBody(movie, 42.123)).toEqual({movie: {title: 'Heat', year: 1995, ids: {imdb: 'tt0113277', tmdb: 949}}, progress: 42.12});
    expect(scrobble.scrobbleBody(episode, 101)).toEqual({show: {title: 'Severance', ids: {imdb: 'tt11280740'}}, episode: {season: 1, number: 2}, progress: 100});
    expect(scrobble.scrobbleBody({title: 'Show', type: 'series'}, 10)).toBeUndefined();
  });

  it('sends start, pause and stop from a session with the progress', async () => {
    const {scrobble} = load();
    fetchMock.mockImplementation(() => json(201, {}));
    const session = new scrobble.ScrobbleSession(movie);
    session.update(0, 0, true); // Not loaded yet: nothing to report.
    session.update(600, 6000, true);
    session.update(1200, 6000, true); // Still playing: no new request.
    session.update(1500, 6000, false);
    session.update(1800, 6000, true);
    await expect(session.stop()).resolves.toBe('sent');
    const urls = fetchMock.mock.calls.map(([url]) => String(url).replace('https://api.trakt.tv', ''));
    expect(urls).toEqual(['/scrobble/start', '/scrobble/pause', '/scrobble/start', '/scrobble/stop']);
    expect(fetchMock.mock.calls.map(call => bodyOf(call).progress)).toEqual([10, 25, 30, 30]);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({Authorization: 'Bearer a1', 'trakt-api-key': 'cid'});
  });

  it('sends nothing when scrobbling is off or Trakt is not connected', async () => {
    const {sync, scrobble} = load();
    sync.updateAccount('trakt', {scrobble: false});
    await expect(scrobble.sendScrobble('start', movie, 10)).resolves.toBe('skipped');
    sync.updateAccount('trakt', {scrobble: true, accessToken: ''});
    await expect(scrobble.sendScrobble('stop', movie, 90)).resolves.toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(scrobble.readScrobbleQueue()).toEqual([]);
  });

  it('queues a stop that fails offline, keeps only the newest per title, and sends it later', async () => {
    const {scrobble} = load();
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Network request failed')));
    await expect(scrobble.sendScrobble('start', movie, 50, 1000)).resolves.toBe('dropped');
    await expect(scrobble.sendScrobble('stop', movie, 60, 1000)).resolves.toBe('queued');
    await expect(scrobble.sendScrobble('stop', movie, 90, 2000)).resolves.toBe('queued');
    expect(scrobble.readScrobbleQueue()).toHaveLength(1);
    expect(scrobble.readScrobbleQueue()[0].body.progress).toBe(90);

    // Still offline: the entry waits two minutes before the next try.
    await expect(scrobble.flushScrobbleQueue(3000)).resolves.toBe(1);
    expect(scrobble.readScrobbleQueue()[0]).toMatchObject({attempts: 1, nextAt: 3000 + 120_000});
    fetchMock.mockClear();
    await scrobble.flushScrobbleQueue(4000);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementation(() => json(201, {}));
    await expect(scrobble.flushScrobbleQueue(3000 + 120_000)).resolves.toBe(0);
    expect(calls('/scrobble/stop')).toHaveLength(1);
    expect(bodyOf(calls('/scrobble/stop')[0]).progress).toBe(90);
  });

  it('treats 409 (already scrobbled) as done and drops a title Trakt does not know', async () => {
    const {scrobble} = load();
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('offline')));
    await scrobble.sendScrobble('stop', movie, 95, 1000);
    await scrobble.sendScrobble('stop', episode, 95, 1000);
    fetchMock.mockImplementation((url: string, init: any) => (JSON.parse(init.body).movie ? json(409, {watched_at: 'x'}) : json(404, {})));
    await expect(scrobble.flushScrobbleQueue(2000)).resolves.toBe(0);
    fetchMock.mockImplementation(() => json(409, {}));
    await expect(scrobble.sendScrobble('stop', movie, 95, 3000)).resolves.toBe('sent');
  });

  it('backs off on 429 with Retry-After and on 420 for at least an hour', async () => {
    const {scrobble} = load();
    fetchMock.mockImplementationOnce(() => json(429, {}, {'Retry-After': '30'}));
    await expect(scrobble.sendScrobble('stop', movie, 90, 10_000)).resolves.toBe('queued');
    expect(scrobble.scrobbleBlockedUntil()).toBe(40_000);
    fetchMock.mockClear();
    // While blocked: start is skipped, a stop is queued, the queue waits.
    await expect(scrobble.sendScrobble('start', episode, 5, 20_000)).resolves.toBe('skipped');
    await expect(scrobble.sendScrobble('stop', episode, 50, 20_000)).resolves.toBe('queued');
    await expect(scrobble.flushScrobbleQueue(20_000)).resolves.toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementation(() => json(420, {}));
    await expect(scrobble.flushScrobbleQueue(50_000)).resolves.toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(scrobble.scrobbleBlockedUntil()).toBeGreaterThanOrEqual(50_000 + HOUR);
  });

  it('drops a queued stop once something newer for the title was sent', async () => {
    const {scrobble} = load();
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('offline')));
    await scrobble.sendScrobble('stop', movie, 40, 1000);
    fetchMock.mockImplementation(() => json(201, {}));
    await scrobble.sendScrobble('start', movie, 45, 2000);
    expect(scrobble.readScrobbleQueue()).toEqual([]);
  });

  it('records the watch through the session stop, not a second history entry', async () => {
    const {sync, scrobble} = load();
    fetchMock.mockImplementation(() => json(201, {}));
    const session = new scrobble.ScrobbleSession(movie);
    session.update(5000, 6000, true);
    await expect(sync.syncWatched(movie)).resolves.toEqual({synced: ['trakt'], signedOut: []});
    expect(calls('/sync/history')).toHaveLength(0);
    expect(calls('/scrobble/stop')).toHaveLength(1);
    expect(bodyOf(calls('/scrobble/stop')[0]).progress).toBeGreaterThanOrEqual(scrobble.WATCHED_PERCENT);
    // Closing the player afterwards sends nothing more.
    await session.stop();
    expect(calls('/scrobble/stop')).toHaveLength(1);
  });

  it('falls back to the history entry when scrobbling is off', async () => {
    const {sync, scrobble} = load();
    sync.updateAccount('trakt', {scrobble: false});
    fetchMock.mockImplementation(() => json(201, {}));
    const session = new scrobble.ScrobbleSession(movie);
    session.update(5000, 6000, true);
    await sync.syncWatched(movie);
    expect(calls('/sync/history')).toHaveLength(1);
    expect(calls('/scrobble/')).toHaveLength(0);
  });

  it('skips the stop when playback never started and is short of a watch', async () => {
    const {scrobble} = load();
    const session = new scrobble.ScrobbleSession(movie);
    session.update(10, 6000, false);
    await expect(session.stop()).resolves.toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
