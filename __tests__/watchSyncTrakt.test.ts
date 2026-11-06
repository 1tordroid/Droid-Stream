// Trakt sign-ins renew before the 24 h access token lapses, renew once after a
// rejection, never spend a rotated refresh token twice, and end with a clear
// message only when Trakt rejects the refresh token.
const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});

const HOUR = 3600_000;
const movie = (title = 'Heat', imdbId = 'tt0113277') => ({title, type: 'movie' as const, imdbId});

describe('Trakt watch sync', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  const load = () => require('../src/lib/watchSync');

  const signedIn = (sync: any, extra: Record<string, unknown> = {}) =>
    sync.updateAccount('trakt', {
      clientId: 'cid',
      clientSecret: 'secret',
      accessToken: 'a1',
      refreshToken: 'r1',
      issuedAt: Date.now() - 4 * HOUR,
      expiresAt: Date.now() + 20 * HOUR,
      username: 'viewer',
      ...extra,
    });

  const calls = (part: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(part));

  const tokenResponse = (extra: Record<string, unknown> = {}) =>
    json(200, {access_token: 'a2', refresh_token: 'r2', created_at: Math.floor(Date.now() / 1000), expires_in: 86400, ...extra});

  it('does not renew while plenty of the token life is left', async () => {
    const sync = load();
    signedIn(sync);
    fetchMock.mockImplementation(() => json(201, {}));
    await expect(sync.syncWatched(movie())).resolves.toEqual({synced: ['trakt'], signedOut: []});
    expect(calls('/oauth/token')).toHaveLength(0);
    expect(calls('/sync/history')[0][1].headers.Authorization).toBe('Bearer a1');
  });

  it('renews near expiry with the exact body and saves the rotated token and issue time', async () => {
    const sync = load();
    signedIn(sync, {issuedAt: Date.now() - 23 * HOUR, expiresAt: Date.now() + HOUR});
    fetchMock.mockImplementation((url: string) => (url.endsWith('/oauth/token') ? tokenResponse() : json(201, {})));
    await sync.syncWatched(movie());
    const [[url, init]] = calls('/oauth/token');
    expect(url).toBe('https://api.trakt.tv/oauth/token');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      refresh_token: 'r1',
      client_id: 'cid',
      client_secret: 'secret',
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
      grant_type: 'refresh_token',
    });
    const account = sync.readSyncSettings().trakt;
    expect(account).toMatchObject({accessToken: 'a2', refreshToken: 'r2', username: 'viewer'});
    expect(account.expiresAt - account.issuedAt).toBe(86400_000);
    expect(calls('/sync/history')[0][1].headers.Authorization).toBe('Bearer a2');
  });

  it('assumes a 24 h lifetime for sessions saved without an issue time', async () => {
    const sync = load();
    signedIn(sync, {issuedAt: undefined, expiresAt: Date.now() + 10 * HOUR});
    fetchMock.mockImplementation((url: string) => (url.endsWith('/oauth/token') ? tokenResponse() : json(201, {})));
    await sync.traktEnsureFresh();
    expect(fetchMock).not.toHaveBeenCalled();
    sync.updateAccount('trakt', {expiresAt: Date.now() + 3 * HOUR});
    await expect(sync.traktEnsureFresh()).resolves.toMatchObject({accessToken: 'a2'});
    expect(calls('/oauth/token')).toHaveLength(1);
  });

  it('spends the refresh token once when two titles finish together', async () => {
    const sync = load();
    signedIn(sync, {issuedAt: Date.now() - 23 * HOUR, expiresAt: Date.now() + HOUR});
    fetchMock.mockImplementation((url: string) => (url.endsWith('/oauth/token') ? tokenResponse() : json(201, {})));
    const [first, second] = await Promise.all([sync.syncWatched(movie('Heat', 'tt1')), sync.syncWatched(movie('Ronin', 'tt2'))]);
    expect(first.synced).toEqual(['trakt']);
    expect(second.synced).toEqual(['trakt']);
    expect(calls('/oauth/token')).toHaveLength(1);
    expect(calls('/sync/history').map(([, init]) => init.headers.Authorization)).toEqual(['Bearer a2', 'Bearer a2']);
  });

  it('renews once and retries when Trakt rejects the token on /sync/history', async () => {
    const sync = load();
    signedIn(sync);
    const history = jest.fn().mockReturnValueOnce(json(401, {error: 'invalid_token'})).mockReturnValueOnce(json(201, {}));
    fetchMock.mockImplementation((url: string) => (url.endsWith('/oauth/token') ? tokenResponse() : history()));
    await expect(sync.syncWatched(movie())).resolves.toEqual({synced: ['trakt'], signedOut: []});
    expect(calls('/oauth/token')).toHaveLength(1);
    expect(calls('/sync/history').map(([, init]) => init.headers.Authorization)).toEqual(['Bearer a1', 'Bearer a2']);
  });

  it('signs out with a message and reports it when Trakt rejects the refresh token', async () => {
    const sync = load();
    signedIn(sync, {issuedAt: Date.now() - 23 * HOUR, expiresAt: Date.now() + HOUR});
    fetchMock.mockImplementation((url: string) => (url.endsWith('/oauth/token') ? json(401, {error: 'invalid_grant'}) : json(201, {})));
    await expect(sync.syncWatched(movie())).resolves.toEqual({synced: [], signedOut: ['trakt']});
    expect(calls('/sync/history')).toHaveLength(0);
    const account = sync.readSyncSettings().trakt;
    expect(account).toMatchObject({accessToken: '', refreshToken: '', clientId: 'cid', clientSecret: 'secret', username: 'viewer', enabled: true});
    expect(account.signedOutReason).toBe('Trakt ended your session. Sign in again to keep syncing.');
    expect(account.expiresAt).toBeUndefined();
    expect(sync.connectedSync()).toEqual([]);
    expect(sync.signedOutNotice('trakt')).toBe('Trakt signed you out. Reconnect in Settings > Watch sync.');
    expect(sync.describeAccount('trakt', account)).toEqual({label: account.signedOutReason, tone: 'signedOut'});
  });

  it('signs out when Trakt rejects the token again right after a renewal', async () => {
    const sync = load();
    signedIn(sync);
    fetchMock.mockImplementation((url: string) => (url.endsWith('/oauth/token') ? tokenResponse() : json(401, {})));
    await expect(sync.syncWatched(movie())).resolves.toEqual({synced: [], signedOut: ['trakt']});
    expect(sync.readSyncSettings().trakt.accessToken).toBe('');
  });

  it('keeps the tokens when the renewal fails on the network', async () => {
    const sync = load();
    signedIn(sync, {issuedAt: Date.now() - 23 * HOUR, expiresAt: Date.now() + HOUR});
    fetchMock.mockImplementation((url: string) => (url.endsWith('/oauth/token') ? Promise.reject(new TypeError('Network request failed')) : json(201, {})));
    // The current token still works, so the title is synced with it.
    await expect(sync.syncWatched(movie())).resolves.toEqual({synced: ['trakt'], signedOut: []});
    expect(sync.readSyncSettings().trakt).toMatchObject({accessToken: 'a1', refreshToken: 'r1'});

    sync.updateAccount('trakt', {expiresAt: Date.now() - HOUR});
    await expect(sync.syncWatched(movie('Ronin', 'tt2'))).resolves.toEqual({synced: [], signedOut: []});
    expect(sync.readSyncSettings().trakt).toMatchObject({accessToken: 'a1', refreshToken: 'r1'});
    expect(sync.readSyncSettings().trakt.signedOutReason).toBeUndefined();
  });

  it('keeps the tokens and records a hint when Trakt rejects the app', async () => {
    const sync = load();
    signedIn(sync, {expiresAt: Date.now() - HOUR});
    fetchMock.mockImplementation(() => json(403, {}));
    await expect(sync.traktEnsureFresh()).rejects.toMatchObject({status: 403});
    const account = sync.readSyncSettings().trakt;
    expect(account).toMatchObject({accessToken: 'a1', refreshToken: 'r1'});
    expect(account.lastSyncError).toMatch(/Client ID/);
    expect(sync.describeAccount('trakt', account).tone).toBe('warning');
  });

  it('keeps the sign-in when Trakt refuses the app on a sync, and clears the hint once a sync works', async () => {
    const sync = load();
    signedIn(sync);
    fetchMock.mockImplementationOnce(() => json(403, {}));
    await expect(sync.syncWatched(movie())).resolves.toEqual({synced: [], signedOut: []});
    expect(calls('/oauth/token')).toHaveLength(0);
    expect(sync.readSyncSettings().trakt).toMatchObject({accessToken: 'a1', refreshToken: 'r1', lastSyncError: expect.stringMatching(/Client ID/)});

    fetchMock.mockImplementation(() => json(201, {}));
    await expect(sync.syncWatched(movie())).resolves.toEqual({synced: ['trakt'], signedOut: []});
    expect(sync.readSyncSettings().trakt.lastSyncError).toBeUndefined();
  });

  it('gives up on a renewal that never answers, keeps the tokens and frees the next renewal', async () => {
    jest.useFakeTimers();
    try {
      const sync = load();
      signedIn(sync, {issuedAt: Date.now() - 25 * HOUR, expiresAt: Date.now() - HOUR});
      fetchMock.mockImplementation(
        (_url: string, init: any) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), {name: 'AbortError'})));
          }),
      );
      const renewal = sync.traktEnsureFresh().catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(20000);
      expect(await renewal).toMatchObject({message: 'The service did not answer in time'});
      expect(sync.readSyncSettings().trakt).toMatchObject({accessToken: 'a1', refreshToken: 'r1'});
      expect(sync.readSyncSettings().trakt.signedOutReason).toBeUndefined();

      fetchMock.mockImplementation(() => tokenResponse());
      await expect(sync.traktEnsureFresh()).resolves.toMatchObject({accessToken: 'a2', refreshToken: 'r2'});
    } finally {
      jest.useRealTimers();
    }
  });

  it('maps device polling answers to clear results', async () => {
    const sync = load();
    sync.updateAccount('trakt', {clientId: 'cid', clientSecret: 'secret'});
    const code = {userCode: 'ABCD', verificationUrl: 'https://trakt.tv/activate', deviceCode: 'dev', intervalSeconds: 5, expiresAt: Date.now() + 600_000};
    fetchMock.mockImplementationOnce(() => json(400, {}));
    await expect(sync.traktPollDevice(code)).resolves.toBe('pending');
    fetchMock.mockImplementationOnce(() => json(429, {}));
    await expect(sync.traktPollDevice(code)).resolves.toBe('slow');
    for (const [status, message] of [
      [404, /did not recognise/],
      [409, /already used/],
      [410, /expired/],
      [418, /denied/],
    ] as const) {
      fetchMock.mockImplementationOnce(() => json(status, {}));
      await expect(sync.traktPollDevice(code)).rejects.toThrow(message);
    }
    sync.updateAccount('trakt', {signedOutReason: 'old reason'});
    const createdAt = Math.floor(Date.now() / 1000);
    fetchMock.mockImplementationOnce(() => json(200, {access_token: 'a1', refresh_token: 'r1', created_at: createdAt, expires_in: 86400}));
    fetchMock.mockImplementationOnce(() => json(200, {username: 'viewer'}));
    await expect(sync.traktPollDevice(code)).resolves.toBe('approved');
    expect(sync.readSyncSettings().trakt).toMatchObject({
      accessToken: 'a1',
      refreshToken: 'r1',
      issuedAt: createdAt * 1000,
      expiresAt: (createdAt + 86400) * 1000,
      username: 'viewer',
    });
    expect(sync.readSyncSettings().trakt.signedOutReason).toBeUndefined();
  });

  it('revokes the token at Trakt and clears it on disconnect', () => {
    const sync = load();
    signedIn(sync);
    fetchMock.mockImplementation(() => json(200, {}));
    const next = sync.disconnectService('trakt');
    expect(next.trakt).toMatchObject({accessToken: '', refreshToken: '', username: '', clientId: 'cid', clientSecret: 'secret'});
    expect(next.trakt.expiresAt).toBeUndefined();
    const [[url, init]] = fetchMock.mock.calls;
    expect(url).toBe('https://api.trakt.tv/oauth/revoke');
    expect(JSON.parse(init.body)).toEqual({token: 'a1', client_id: 'cid', client_secret: 'secret'});
  });

  it('keeps idle sessions renewed at most once every six hours', async () => {
    const sync = load();
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    signedIn(sync);
    fetchMock.mockImplementation(() => tokenResponse({created_at: Math.floor(Date.now() / 1000)}));
    await expect(sync.ensureFreshAll()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    // Due for renewal an hour later, but the last check was under six hours ago.
    now.mockReturnValue(start + HOUR);
    sync.updateAccount('trakt', {expiresAt: start + 2 * HOUR});
    await sync.ensureFreshAll();
    expect(fetchMock).not.toHaveBeenCalled();

    now.mockReturnValue(start + 6 * HOUR + 1);
    sync.updateAccount('trakt', {expiresAt: start + 7 * HOUR});
    await sync.ensureFreshAll();
    expect(calls('/oauth/token')).toHaveLength(1);
    expect(sync.readSyncSettings().trakt.accessToken).toBe('a2');
  });

  it('asks for one more sign-in when an old session without a refresh token lapses', async () => {
    const sync = load();
    signedIn(sync, {refreshToken: undefined, expiresAt: Date.now() - HOUR});
    await expect(sync.ensureFreshAll()).resolves.toEqual(['trakt']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sync.readSyncSettings().trakt.signedOutReason).toBe('Sign in to Trakt again so Droid Stream can keep you signed in.');
  });

  it('says the session renews automatically while connected', () => {
    const sync = load();
    signedIn(sync);
    expect(sync.describeAccount('trakt', sync.readSyncSettings().trakt)).toEqual({label: 'Connected as viewer', tone: 'connected', detail: 'Renews automatically'});
    // A session saved without a refresh token cannot renew, so the card says what to do.
    const stuck = sync.describeAccount('trakt', {...sync.readSyncSettings().trakt, refreshToken: undefined});
    expect(stuck.tone).toBe('warning');
    expect(stuck.detail).toMatch(/sign in again/);
  });
});
