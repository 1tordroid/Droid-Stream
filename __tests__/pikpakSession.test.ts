// PikPak sign-ins keep a refresh token, renew the access token before it
// expires or after a rejection, and end cleanly when PikPak ends the session.
const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});

describe('PikPak session', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  const load = () => ({
    client: require('../src/lib/pikpak/client'),
    session: require('../src/lib/pikpak/session'),
    vault: require('../src/lib/sources/vault'),
  });

  const signedIn = (vault: any, extra: Record<string, unknown> = {}) =>
    vault.savePikPakAccount({username: 'me@example.com', accessToken: 'old', refreshToken: 'r1', expiresAt: Date.now() + 3600_000, ...extra});

  it('keeps the refresh token and expiry from a password sign-in, with a persistent device id', async () => {
    const {client, vault} = load();
    fetchMock.mockImplementation((url: string) =>
      url.includes('captcha') ? json(200, {captcha_token: 'c'}) : json(200, {access_token: 'a1', refresh_token: 'r1', expires_in: 7200, sub: 'u'}),
    );
    const session = await client.signInToPikPak('me@example.com', 'pw');
    expect(session).toMatchObject({accessToken: 'a1', refreshToken: 'r1', userId: 'u'});
    expect(session.expiresAt).toBeGreaterThan(Date.now() + 7000_000);
    const device = fetchMock.mock.calls[1][1].headers['X-Device-Id'];
    expect(device).toMatch(/^[0-9a-f]{32}$/);
    expect(vault.readPikPakDeviceId()).toBe(device);
  });

  it('renews a token that is about to expire, saving the rotated refresh token', async () => {
    const {session, vault} = load();
    signedIn(vault, {expiresAt: Date.now() + 60_000});
    fetchMock.mockImplementation(() => json(200, {access_token: 'new', refresh_token: 'r2', expires_in: 7200}));
    await expect(session.getPikPakToken()).resolves.toBe('new');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://user.mypikpak.com/v1/auth/token');
    expect(JSON.parse(init.body)).toEqual({client_id: 'YNxT9w7GMdWvEOKa', grant_type: 'refresh_token', refresh_token: 'r1'});
    expect(vault.readPikPakAccount()).toMatchObject({accessToken: 'new', refreshToken: 'r2', username: 'me@example.com'});
  });

  it('renews once and retries when PikPak rejects the token', async () => {
    const {session, vault} = load();
    signedIn(vault);
    const {DebridHttpError} = require('../src/lib/debrid/http');
    fetchMock.mockImplementation(() => json(200, {access_token: 'new', refresh_token: 'r2', expires_in: 7200}));
    const request = jest
      .fn()
      .mockRejectedValueOnce(new DebridHttpError('unauthenticated', 401, {error_code: 16}))
      .mockResolvedValueOnce('ok');
    await expect(session.withPikPak('old', request)).resolves.toBe('ok');
    expect(request.mock.calls.map(call => call[0])).toEqual(['old', 'new']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ends the sign-in when the refresh token is rejected, keeping the username', async () => {
    const {client, session, vault} = load();
    signedIn(vault, {expiresAt: Date.now() - 1});
    fetchMock.mockImplementation(() => json(400, {error: 'invalid_grant', error_code: 4126}));
    await expect(session.getPikPakToken()).rejects.toBeInstanceOf(client.PikPakAuthError);
    expect(vault.readPikPakAccount()).toBeUndefined();
    expect(vault.readPikPakUsername()).toBe('me@example.com');
  });

  it('keeps the tokens when the renewal fails for network or server reasons', async () => {
    const {client, session, vault} = load();
    signedIn(vault, {expiresAt: Date.now() - 1});
    fetchMock.mockImplementation(() => json(503, {error: 'unavailable'}));
    const error = await session.getPikPakToken().catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(client.PikPakAuthError);
    expect(vault.readPikPakAccount()).toMatchObject({accessToken: 'old', refreshToken: 'r1'});
  });

  it('spends the refresh token once when callers renew in parallel', async () => {
    const {session, vault} = load();
    signedIn(vault, {expiresAt: Date.now() - 1});
    fetchMock.mockImplementation(() => json(200, {access_token: 'new', refresh_token: 'r2', expires_in: 7200}));
    const tokens = await Promise.all([session.getPikPakToken(), session.getPikPakToken(), session.getPikPakToken()]);
    expect(tokens).toEqual(['new', 'new', 'new']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses a pasted token as is and never renews it', async () => {
    const {session, vault} = load();
    signedIn(vault);
    const request = jest.fn().mockResolvedValue('ok');
    await session.withPikPak('pasted-token', request);
    expect(request).toHaveBeenCalledWith('pasted-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks a sign-in saved before refresh tokens to sign in once more when it ends', async () => {
    const {client, session, vault} = load();
    vault.savePikPakAccount({username: 'me@example.com', accessToken: 'legacy'});
    const request = jest.fn().mockRejectedValue(new client.PikPakAuthError());
    const error = await session.withPikPak('legacy', request).catch((e: Error) => e);
    expect(error).toBeInstanceOf(client.PikPakAuthError);
    expect(error.message).toMatch(/sign in once more/);
    expect(vault.readPikPakAccount()).toBeUndefined();
  });
});
