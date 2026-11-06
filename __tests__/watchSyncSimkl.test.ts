// Simkl V1 PIN sign-ins cannot be renewed: keep the advertised expiry, and end
// the sign-in with a message as soon as Simkl rejects the token.
const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});

const show = {title: 'Severance', type: 'series' as const, imdbId: 'tt11280740', season: 1, episode: 2};
const code = {userCode: 'PIN1', verificationUrl: 'https://simkl.com/pin', deviceCode: 'PIN1', intervalSeconds: 5, expiresAt: Date.now() + 600_000};

describe('Simkl watch sync', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  const load = () => require('../src/lib/watchSync');
  const signedIn = (sync: any) => sync.updateAccount('simkl', {clientId: 'sid', accessToken: 's1', tokenType: 'v1', username: 'me'});

  it('stores the V1 token type and the advertised expiry from the PIN poll', async () => {
    const sync = load();
    sync.updateAccount('simkl', {clientId: 'sid', signedOutReason: 'old reason'});
    fetchMock.mockImplementationOnce(() => json(200, {result: 'KO', message: 'Authorization pending'}));
    await expect(sync.simklPollPin(code)).resolves.toBe('pending');
    expect(sync.readSyncSettings().simkl.accessToken).toBeUndefined();

    const before = Date.now();
    fetchMock.mockImplementationOnce(() => json(200, {result: 'OK', access_token: 's1'}));
    await expect(sync.simklPollPin(code)).resolves.toBe('approved');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.simkl.com/oauth/pin/PIN1?client_id=sid');
    const account = sync.readSyncSettings().simkl;
    expect(account).toMatchObject({accessToken: 's1', tokenType: 'v1'});
    expect(account.signedOutReason).toBeUndefined();
    // No expires_in in the answer: about five years, as Simkl documents for V1.
    expect(account.expiresAt).toBeGreaterThanOrEqual(before + 157680000 * 1000);

    fetchMock.mockImplementationOnce(() => json(200, {result: 'OK', access_token: 's2', expires_in: 1000}));
    await sync.simklPollPin(code);
    expect(sync.readSyncSettings().simkl.expiresAt).toBeLessThanOrEqual(Date.now() + 1000 * 1000);
  });

  it('marks V1 sign-ins saved before 5.5.0 as V1 without touching the token', () => {
    const sync = load();
    sync.updateAccount('simkl', {clientId: 'sid', accessToken: 'legacy'});
    expect(sync.readSyncSettings().simkl).toMatchObject({accessToken: 'legacy', tokenType: 'v1'});
  });

  it('sends the token to /sync/history', async () => {
    const sync = load();
    signedIn(sync);
    fetchMock.mockImplementation(() => json(201, {}));
    await expect(sync.syncWatched(show)).resolves.toEqual({synced: ['simkl'], signedOut: []});
    const [[url, init]] = fetchMock.mock.calls;
    expect(url).toBe('https://api.simkl.com/sync/history');
    expect(init.headers).toMatchObject({Authorization: 'Bearer s1', 'simkl-api-key': 'sid'});
  });

  it('signs out with a message when Simkl rejects the token', async () => {
    const sync = load();
    signedIn(sync);
    fetchMock.mockImplementation(() => json(401, {error: 'invalid_token'}));
    await expect(sync.syncWatched(show)).resolves.toEqual({synced: [], signedOut: ['simkl']});
    expect(fetchMock).toHaveBeenCalledTimes(1); // V1 has nothing to renew with
    const account = sync.readSyncSettings().simkl;
    expect(account).toMatchObject({accessToken: '', clientId: 'sid', enabled: true});
    expect(account.signedOutReason).toBe('Simkl ended your session. Sign in again.');
    expect(sync.signedOutNotice('simkl')).toBe('Simkl signed you out. Reconnect in Settings > Watch sync.');
  });

  it('keeps the token on network errors, server errors and user_token_required', async () => {
    const sync = load();
    signedIn(sync);
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('Network request failed')));
    await expect(sync.syncWatched(show)).resolves.toEqual({synced: [], signedOut: []});
    fetchMock.mockImplementationOnce(() => json(503, {}));
    await expect(sync.syncWatched(show)).resolves.toEqual({synced: [], signedOut: []});
    fetchMock.mockImplementationOnce(() => json(401, {error: 'user_token_required'}));
    await expect(sync.syncWatched(show)).resolves.toEqual({synced: [], signedOut: []});
    expect(sync.readSyncSettings().simkl.accessToken).toBe('s1');
  });

  it('makes no request for Simkl when keeping sign-ins fresh', async () => {
    const sync = load();
    signedIn(sync);
    await expect(sync.ensureFreshAll()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sync.describeAccount('simkl', sync.readSyncSettings().simkl)).toEqual({label: 'Connected as me', tone: 'connected'});
  });

  it('clears the Simkl sign-in locally on disconnect', () => {
    const sync = load();
    signedIn(sync);
    expect(sync.disconnectService('simkl').simkl).toMatchObject({accessToken: '', username: '', clientId: 'sid'});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
