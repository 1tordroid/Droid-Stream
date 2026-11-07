// Progress back to Jellyfin, Emby and Plex: the requests (ticks and
// milliseconds), when a playing session reports (start, every 10 seconds,
// pause, resume, played at 90%, stop), the offline queue for the final stop,
// the setting, and the server's resume position when an item opens.
jest.mock('expo-crypto', () => ({randomUUID: () => 'install-a'}));

const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});

const JF_ID = '0123456789abcdef0123456789abcdef';
const jellyfin = {id: 'jf', kind: 'jellyfin' as const, name: 'Home', server: 'https://jf.local/', username: 'user-guid', secret: 'jf-token', deviceId: 'install-a-jf'};
const emby = {id: 'em', kind: 'emby' as const, name: 'Emby', server: 'https://emby.local', username: 'u1', secret: 'emby-token', deviceId: 'install-a-em'};
const plex = {id: 'px', kind: 'plex' as const, name: 'Plex', server: 'https://plex.local:32400', username: '', secret: 'plex-token', deviceId: 'install-a'};

describe('server progress', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn(() => json(204, {}));
    (globalThis as any).fetch = fetchMock;
  });

  const load = () => {
    const progress = require('../src/lib/sources/serverProgress');
    const {mainStorage} = require('../src/lib/storage/StorageService');
    const vault = require('../src/lib/sources/vault');
    const {watchProgressStorage} = require('../src/lib/storage/WatchProgressStorage');
    // The in-memory stores outlive module resets: start clean.
    mainStorage.delete('server-progress-queue');
    mainStorage.delete('server-progress-sync');
    vault.listSources().forEach((source: {id: string}) => vault.deleteSource(source.id));
    watchProgressStorage.clearAllProgress();
    return {progress, mainStorage, vault, watchProgressStorage};
  };

  const fakeTransport = () => {
    const sent: Array<{kind: string; position?: number; paused?: boolean; event?: string}> = [];
    let fail: unknown;
    const transport = {
      report: jest.fn(async (_item: unknown, report: any) => {
        if (fail) throw fail;
        sent.push({kind: report.kind, position: report.positionSeconds, paused: report.paused, event: report.event});
      }),
      markPlayed: jest.fn(async () => {
        if (fail) throw fail;
        sent.push({kind: 'played'});
      }),
    };
    return {transport, sent, failWith: (error: unknown) => (fail = error)};
  };

  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  it('converts seconds and ticks', () => {
    const {progress} = load();
    expect(progress.secondsToTicks(1)).toBe(10_000_000);
    expect(progress.secondsToTicks(61.25)).toBe(612_500_000);
    expect(progress.secondsToTicks(-3)).toBe(0);
    expect(progress.secondsToTicks(Number.NaN)).toBe(0);
    expect(progress.ticksToSeconds(36_000_000_000)).toBe(3600);
    expect(progress.ticksToSeconds(undefined)).toBe(0);
  });

  it('finds the server item behind a stream address', () => {
    const {progress, vault} = load();
    vault.saveSource(jellyfin);
    vault.saveSource(emby);
    expect(progress.findServerItem([`https://jf.local/Videos/${JF_ID}/stream?static=true&ApiKey=jf-token`])).toMatchObject({kind: 'jellyfin', itemId: JF_ID});
    expect(progress.findServerItem(['https://emby.local/Videos/77/stream?static=true'])).toMatchObject({kind: 'emby', itemId: '77'});
    expect(progress.findServerItem(['https://elsewhere/movie.mkv'])).toBeUndefined();
    vault.updateSource('jf', {authState: 'signedOut'});
    expect(progress.findServerItem([`https://jf.local/Videos/${JF_ID}/stream`])).toBeUndefined();
  });

  it('builds Jellyfin and Emby reports with ticks and the session id', () => {
    const {progress} = load();
    const item = {kind: 'jellyfin', source: jellyfin, itemId: JF_ID};
    const base = {positionSeconds: 90.5, durationSeconds: 3000, paused: false, playSessionId: 'ps1'};
    const start = progress.progressRequest(item, {...base, kind: 'start'});
    expect(start.url).toBe('https://jf.local/Sessions/Playing');
    expect(start.method).toBe('POST');
    expect(start.headers.Authorization).toContain('Token="jf-token"');
    expect(start.headers.Authorization).toContain('DeviceId="install-a-jf"');
    expect(JSON.parse(start.body)).toEqual({ItemId: JF_ID, PositionTicks: 905_000_000, PlaySessionId: 'ps1', IsPaused: false, CanSeek: true, PlayMethod: 'DirectStream'});

    const pause = progress.progressRequest(item, {...base, kind: 'progress', paused: true, event: 'Pause'});
    expect(pause.url).toBe('https://jf.local/Sessions/Playing/Progress');
    expect(JSON.parse(pause.body)).toMatchObject({IsPaused: true, EventName: 'Pause', PositionTicks: 905_000_000});

    const stop = progress.progressRequest({...item, kind: 'emby', source: emby, itemId: '77'}, {...base, kind: 'stop'});
    expect(stop.url).toBe('https://emby.local/Sessions/Playing/Stopped');
    expect(JSON.parse(stop.body)).toEqual({ItemId: '77', PositionTicks: 905_000_000, PlaySessionId: 'ps1'});
  });

  it('builds Plex timeline and scrobble requests in milliseconds', () => {
    const {progress} = load();
    const item = {kind: 'plex', source: plex, itemId: '812'};
    const base = {positionSeconds: 61.2345, durationSeconds: 1500, playSessionId: 'ps1'};
    const playing = progress.progressRequest(item, {...base, kind: 'progress', paused: false});
    expect(playing.method).toBe('GET');
    expect(playing.url).toBe('https://plex.local:32400/:/timeline?ratingKey=812&key=%2Flibrary%2Fmetadata%2F812&state=playing&time=61235&duration=1500000');
    expect(playing.headers).toMatchObject({'X-Plex-Token': 'plex-token', 'X-Plex-Client-Identifier': 'install-a', 'X-Plex-Product': 'Droid Stream'});
    expect(progress.progressRequest(item, {...base, kind: 'progress', paused: true}).url).toContain('state=paused');
    expect(progress.progressRequest(item, {...base, kind: 'stop', paused: true}).url).toContain('state=stopped');
    expect(progress.playedRequests(item).map((request: any) => request.url)).toEqual([
      'https://plex.local:32400/:/scrobble?key=812&identifier=com.plexapp.plugins.library',
    ]);
  });

  it('marks played on Jellyfin with the new address, and the old one on older servers', async () => {
    const {progress} = load();
    const item = {kind: 'jellyfin', source: jellyfin, itemId: JF_ID};
    await progress.httpTransport.markPlayed(item);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([`https://jf.local/UserPlayedItems/${JF_ID}?userId=user-guid`]);

    fetchMock.mockClear();
    fetchMock.mockReturnValueOnce(json(404, {})).mockReturnValueOnce(json(200, {}));
    await progress.httpTransport.markPlayed(item);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      `https://jf.local/UserPlayedItems/${JF_ID}?userId=user-guid`,
      `https://jf.local/Users/user-guid/PlayedItems/${JF_ID}`,
    ]);

    // A server error is not a missing address: no second try, the caller queues it.
    fetchMock.mockClear();
    fetchMock.mockReturnValueOnce(json(503, {}));
    await expect(progress.httpTransport.markPlayed(item)).rejects.toMatchObject({status: 503});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(progress.playedRequests({kind: 'emby', source: emby, itemId: '77'}).map((request: any) => request.url)).toEqual([
      'https://emby.local/Users/u1/PlayedItems/77',
    ]);
  });

  it('reports start, every 10 seconds, pause and resume, and played once at 90%', async () => {
    const {progress} = load();
    const {transport, sent} = fakeTransport();
    const session = new progress.ServerProgressSession({kind: 'jellyfin', source: jellyfin, itemId: JF_ID}, transport, 'ps1');
    const t0 = 1_000_000;
    session.update(0, 0, true, t0); // Not loaded yet.
    session.update(10, 1000, false, t0); // Loaded but not playing yet.
    expect(transport.report).not.toHaveBeenCalled();
    session.update(10, 1000, true, t0);
    session.update(12, 1000, true, t0 + 2000);
    session.update(14, 1000, true, t0 + 4000);
    session.update(18, 1000, true, t0 + 8000);
    session.update(20, 1000, true, t0 + 10_000);
    session.update(22, 1000, true, t0 + 12_000);
    session.update(22, 1000, false, t0 + 13_000);
    session.update(22, 1000, false, t0 + 23_000); // Still paused: the server keeps hearing from it.
    session.update(22, 1000, true, t0 + 24_000);
    await settle();
    expect(sent).toEqual([
      {kind: 'start', position: 10, paused: false, event: undefined},
      {kind: 'progress', position: 20, paused: false, event: 'TimeUpdate'},
      {kind: 'progress', position: 22, paused: true, event: 'Pause'},
      {kind: 'progress', position: 22, paused: true, event: 'TimeUpdate'},
      {kind: 'progress', position: 22, paused: false, event: 'Unpause'},
    ]);

    sent.length = 0;
    session.update(899, 1000, true, t0 + 26_000);
    session.update(900, 1000, true, t0 + 28_000);
    session.update(950, 1000, true, t0 + 30_000);
    await settle();
    expect(sent.filter(entry => entry.kind === 'played')).toHaveLength(1);

    sent.length = 0;
    await expect(session.stop()).resolves.toBe('sent');
    // Already marked played: the stop does not mark it again.
    expect(sent).toEqual([{kind: 'stop', position: 950, paused: true, event: undefined}]);
    await expect(session.stop()).resolves.toBe('skipped');
    session.update(990, 1000, true, t0 + 40_000);
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('sends nothing for an item that never started playing', async () => {
    const {progress} = load();
    const {transport} = fakeTransport();
    const session = new progress.ServerProgressSession({kind: 'plex', source: plex, itemId: '812'}, transport);
    session.update(5, 1000, false);
    await expect(session.stop()).resolves.toBe('skipped');
    expect(transport.report).not.toHaveBeenCalled();
  });

  it('queues the final stop while offline and sends it later, played included', async () => {
    const {progress, vault} = load();
    vault.saveSource(jellyfin);
    const {transport, sent, failWith} = fakeTransport();
    const item = {kind: 'jellyfin', source: jellyfin, itemId: JF_ID};
    const session = new progress.ServerProgressSession(item, transport);
    failWith(new TypeError('Network request failed'));
    session.update(100, 1000, true, 0);
    session.update(950, 1000, true, 2000);
    await expect(session.stop(5000)).resolves.toBe('queued');
    const [queued] = progress.readServerProgressQueue();
    expect(queued).toMatchObject({key: `jf:${JF_ID}`, sourceId: 'jf', kind: 'jellyfin', itemId: JF_ID, positionSeconds: 950, durationSeconds: 1000, played: true, attempts: 0});
    // The queue keeps no sign-in.
    expect(JSON.stringify(queued)).not.toContain('jf-token');

    // Still offline: tried again later, with a growing wait.
    await expect(progress.flushServerProgressQueue(6000, transport)).resolves.toBe(1);
    expect(progress.readServerProgressQueue()[0]).toMatchObject({attempts: 1, nextAt: 6000 + 120_000});
    await expect(progress.flushServerProgressQueue(7000, transport)).resolves.toBe(1);
    expect(progress.readServerProgressQueue()[0].attempts).toBe(1);

    failWith(undefined);
    await expect(progress.flushServerProgressQueue(6000 + 120_000, transport)).resolves.toBe(0);
    expect(sent.map(entry => entry.kind)).toEqual(['stop', 'played']);
    expect(sent[0].position).toBe(950);
  });

  it('keeps only the newest stop per item and drops ones that cannot work', async () => {
    const {progress, vault} = load();
    vault.saveSource(jellyfin);
    vault.saveSource({...plex});
    const {transport, sent, failWith} = fakeTransport();
    const jf = {kind: 'jellyfin', source: jellyfin, itemId: JF_ID};
    progress.enqueueServerStop(jf, {positionSeconds: 10, durationSeconds: 100, played: false}, 1);
    progress.enqueueServerStop(jf, {positionSeconds: 20, durationSeconds: 100, played: false}, 2);
    expect(progress.readServerProgressQueue().map((entry: any) => entry.positionSeconds)).toEqual([20]);

    // A removed source's stop goes; a signed-out source's stop waits for a new sign-in.
    progress.enqueueServerStop({kind: 'emby', source: emby, itemId: '77'}, {positionSeconds: 5, durationSeconds: 100, played: false}, 3);
    vault.updateSource('px', {authState: 'signedOut'});
    progress.enqueueServerStop({kind: 'plex', source: plex, itemId: '812'}, {positionSeconds: 6, durationSeconds: 100, played: false}, 4);
    // The server refuses the request itself (400): sending again will not help.
    failWith(new progress.ServerReportError(400));
    await expect(progress.flushServerProgressQueue(10, transport)).resolves.toBe(1);
    expect(progress.readServerProgressQueue().map((entry: any) => entry.key)).toEqual(['px:812']);
    expect(sent).toEqual([]);

    failWith(undefined);
    vault.updateSource('px', {authState: 'ok'});
    await expect(progress.flushServerProgressQueue(20, transport)).resolves.toBe(0);
    expect(sent.map(entry => entry.kind)).toEqual(['stop']);

    // Old stops are dropped after 30 days.
    progress.enqueueServerStop(jf, {positionSeconds: 20, durationSeconds: 100, played: false}, 0);
    await expect(progress.flushServerProgressQueue(31 * 24 * 3600_000, transport)).resolves.toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('drops a stop the server refuses, and gives up on a queued one after 10 tries', async () => {
    const {progress, vault} = load();
    vault.saveSource(jellyfin);
    const {transport, failWith} = fakeTransport();
    const item = {kind: 'jellyfin', source: jellyfin, itemId: JF_ID};
    const session = new progress.ServerProgressSession(item, transport);
    session.update(100, 1000, true, 0);
    failWith(new progress.ServerReportError(400));
    await expect(session.stop()).resolves.toBe('dropped');
    expect(progress.readServerProgressQueue()).toEqual([]);

    expect(progress.isRetryable(new progress.ServerReportError(401))).toBe(true);
    expect(progress.isRetryable(new progress.ServerReportError(503))).toBe(true);
    expect(progress.isRetryable(new progress.ServerReportError(404))).toBe(false);

    failWith(new progress.ServerReportError(503));
    progress.enqueueServerStop(item, {positionSeconds: 1, durationSeconds: 100, played: false}, 0);
    let now = 0;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      now = Math.max(now, progress.readServerProgressQueue()[0]?.nextAt ?? now);
      await progress.flushServerProgressQueue(now, transport);
    }
    expect(progress.readServerProgressQueue()).toEqual([]);
  });

  it('is on by default and sends nothing queued when turned off', async () => {
    const {progress, vault} = load();
    expect(progress.isServerProgressSyncEnabled()).toBe(true);
    vault.saveSource(jellyfin);
    const {transport} = fakeTransport();
    progress.enqueueServerStop({kind: 'jellyfin', source: jellyfin, itemId: JF_ID}, {positionSeconds: 1, durationSeconds: 100, played: false}, 0);
    progress.setServerProgressSyncEnabled(false);
    expect(progress.isServerProgressSyncEnabled()).toBe(false);
    await expect(progress.flushServerProgressQueue(1, transport)).resolves.toBe(1);
    expect(transport.report).not.toHaveBeenCalled();
  });

  describe('resume from the server', () => {
    const url = `https://jf.local/Videos/${JF_ID}/stream?static=true&ApiKey=jf-token`;
    const link = `https://jf.local/Videos/${JF_ID}/stream?static=true`;

    it('takes the server position when this device has none', async () => {
      const {progress, watchProgressStorage} = load();
      fetchMock.mockReturnValueOnce(json(200, {RunTimeTicks: 36_000_000_000, UserData: {PlaybackPositionTicks: 12_000_000_000, Played: false}}));
      await expect(progress.seedServerResume(jellyfin, url, link)).resolves.toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe(`https://jf.local/Items/${JF_ID}?userId=user-guid`);
      expect(watchProgressStorage.getProgress(link)).toEqual({position: 1200, duration: 3600});
    });

    it('keeps this device progress, and skips played or barely started items', async () => {
      const {progress, watchProgressStorage} = load();
      watchProgressStorage.setProgress(link, 300, 3600);
      await expect(progress.seedServerResume(jellyfin, url, link)).resolves.toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(watchProgressStorage.getProgress(link)).toEqual({position: 300, duration: 3600});

      watchProgressStorage.removeProgress(link);
      fetchMock.mockReturnValueOnce(json(200, {RunTimeTicks: 36_000_000_000, UserData: {PlaybackPositionTicks: 0, Played: true}}));
      await expect(progress.seedServerResume(jellyfin, url, link)).resolves.toBe(false);
      fetchMock.mockReturnValueOnce(json(200, {RunTimeTicks: 36_000_000_000, UserData: {PlaybackPositionTicks: 30_000_000}}));
      await expect(progress.seedServerResume(jellyfin, url, link)).resolves.toBe(false);
      expect(watchProgressStorage.getProgress(link)).toBeNull();
    });

    it('uses the older Jellyfin address and never blocks opening on errors or the setting', async () => {
      const {progress, watchProgressStorage} = load();
      fetchMock
        .mockReturnValueOnce(json(404, {}))
        .mockReturnValueOnce(json(200, {RunTimeTicks: 6_000_000_000, UserData: {PlaybackPositionTicks: 600_000_000}}));
      await expect(progress.seedServerResume(jellyfin, url, link)).resolves.toBe(true);
      expect(fetchMock.mock.calls[1][0]).toBe(`https://jf.local/Users/user-guid/Items/${JF_ID}`);
      expect(watchProgressStorage.getProgress(link)).toEqual({position: 60, duration: 600});

      watchProgressStorage.removeProgress(link);
      fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('Network request failed')));
      await expect(progress.seedServerResume(jellyfin, url, link)).resolves.toBe(false);

      progress.setServerProgressSyncEnabled(false);
      fetchMock.mockClear();
      await expect(progress.seedServerResume(jellyfin, url, link)).resolves.toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reads Plex viewOffset in milliseconds', async () => {
      const {progress, watchProgressStorage} = load();
      const {rememberPlexPart} = require('../src/lib/sources/plexParts');
      const part = 'https://plex.local:32400/library/parts/31/1/film.mkv?X-Plex-Token=plex-token';
      rememberPlexPart(plex.server, part, '812');
      fetchMock.mockReturnValueOnce(json(200, {MediaContainer: {Metadata: [{ratingKey: '812', viewOffset: 754_000, duration: 6_000_000}]}}));
      await expect(progress.seedServerResume(plex, part, 'https://plex.local:32400/library/parts/31/1/film.mkv')).resolves.toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe('https://plex.local:32400/library/metadata/812');
      expect(fetchMock.mock.calls[0][1].headers['X-Plex-Token']).toBe('plex-token');
      expect(watchProgressStorage.getProgress('https://plex.local:32400/library/parts/31/1/film.mkv')).toEqual({position: 754, duration: 6000});
    });

    it('reads Emby from the user item address', async () => {
      const {progress} = load();
      fetchMock.mockReturnValueOnce(json(200, {RunTimeTicks: 6_000_000_000, UserData: {PlaybackPositionTicks: 600_000_000}}));
      await expect(progress.fetchServerResume({kind: 'emby', source: emby, itemId: '77'})).resolves.toEqual({positionSeconds: 60, durationSeconds: 600, played: false});
      expect(fetchMock.mock.calls[0][0]).toBe('https://emby.local/Users/u1/Items/77');
    });
  });
});
