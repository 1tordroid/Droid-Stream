// AniList tokens last a year and cannot be renewed: read the expiry from the
// token, save a pasted token only once AniList accepts it, and end the sign-in
// with a message when it lapses or AniList rejects it.
const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});

const DAY = 86400_000;
const base64url = (value: string) => Buffer.from(value).toString('base64url');
const jwt = (payload: Record<string, unknown>) => `${base64url('{"alg":"RS256","typ":"JWT"}')}.${base64url(JSON.stringify(payload))}.signature`;
const tokenExpiringIn = (ms: number) => jwt({aud: '123', sub: '42', exp: Math.floor((Date.now() + ms) / 1000)});

const episode = {title: 'Frieren', type: 'series' as const, season: 1, episode: 3, malId: 52991, anime: true};

describe('AniList watch sync', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  const load = () => require('../src/lib/watchSync');

  it('reads the expiry from the JWT and ignores anything else', () => {
    const {anilistTokenExpiry} = load();
    expect(anilistTokenExpiry(jwt({exp: 1893456000}))).toBe(1893456000 * 1000);
    expect(anilistTokenExpiry('not-a-jwt')).toBeUndefined();
    expect(anilistTokenExpiry('a.b')).toBeUndefined();
    expect(anilistTokenExpiry('a.%%%.c')).toBeUndefined();
    expect(anilistTokenExpiry(jwt({sub: '42'}))).toBeUndefined();
    expect(anilistTokenExpiry(undefined)).toBeUndefined();
  });

  it('saves a pasted token only after AniList accepts it', async () => {
    const sync = load();
    sync.updateAccount('anilist', {clientId: '123'});
    fetchMock.mockImplementationOnce(() => json(401, {errors: [{message: 'Invalid token', status: 401}]}));
    await expect(sync.anilistConnect(tokenExpiringIn(300 * DAY))).rejects.toThrow(/did not accept this token/);
    expect(sync.readSyncSettings().anilist.accessToken).toBeUndefined();

    const token = tokenExpiringIn(300 * DAY);
    fetchMock.mockImplementationOnce(() => json(200, {data: {Viewer: {name: 'reader'}}}));
    await expect(sync.anilistConnect(`  ${token} `)).resolves.toBe('reader');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://graphql.anilist.co');
    expect(init.headers.Authorization).toBe(`Bearer ${token}`);
    const account = sync.readSyncSettings().anilist;
    expect(account).toMatchObject({accessToken: token, username: 'reader', clientId: '123'});
    expect(account.expiresAt).toBe(sync.anilistTokenExpiry(token));
  });

  it('refuses an already expired token without asking AniList', async () => {
    const sync = load();
    await expect(sync.anilistConnect(tokenExpiringIn(-DAY))).rejects.toThrow(/expired/);
    await expect(sync.anilistConnect('   ')).rejects.toThrow(/Paste the token/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sync.readSyncSettings().anilist.accessToken).toBeUndefined();
  });

  it('fills in the expiry of tokens saved before 5.5.0', () => {
    const sync = load();
    const token = tokenExpiringIn(100 * DAY);
    sync.updateAccount('anilist', {accessToken: token, username: 'reader'});
    expect(sync.readSyncSettings().anilist.expiresAt).toBe(sync.anilistTokenExpiry(token));
  });

  it('signs out when the saved expiry has passed', async () => {
    const sync = load();
    sync.updateAccount('anilist', {clientId: '123', accessToken: tokenExpiringIn(-DAY), username: 'reader'});
    await expect(sync.ensureFreshAll()).resolves.toEqual(['anilist']);
    expect(fetchMock).not.toHaveBeenCalled();
    const account = sync.readSyncSettings().anilist;
    expect(account).toMatchObject({accessToken: '', clientId: '123', username: 'reader'});
    expect(account.signedOutReason).toBe('Your AniList sign-in expired. Sign in again.');
  });

  it('checks a token saved without a username once, and signs out if AniList rejects it', async () => {
    const sync = load();
    sync.updateAccount('anilist', {accessToken: 'opaque-token'});
    fetchMock.mockImplementationOnce(() => json(400, {errors: [{message: 'Invalid token', status: 400}]}));
    await expect(sync.ensureFreshAll()).resolves.toEqual(['anilist']);
    expect(sync.readSyncSettings().anilist.accessToken).toBe('');
  });

  it('signs out when a sync gets an "Invalid token" GraphQL error', async () => {
    const sync = load();
    sync.updateAccount('anilist', {accessToken: tokenExpiringIn(200 * DAY), username: 'reader'});
    fetchMock.mockImplementation(() => json(400, {errors: [{message: 'Invalid token', status: 400}], data: null}));
    await expect(sync.syncWatched(episode)).resolves.toEqual({synced: [], signedOut: ['anilist']});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sync.readSyncSettings().anilist.signedOutReason).toBe('Your AniList sign-in expired. Sign in again.');
    expect(sync.signedOutNotice('anilist')).toBe('AniList signed you out. Reconnect in Settings > Watch sync.');
  });

  it('leaves a sign-in made during the sync alone when the old token is rejected', async () => {
    const sync = load();
    const oldToken = tokenExpiringIn(200 * DAY);
    const newToken = tokenExpiringIn(365 * DAY);
    sync.updateAccount('anilist', {accessToken: oldToken, username: 'reader'});
    fetchMock.mockImplementationOnce(() => {
      // The user pastes a new token while the request for the old one is on its way.
      sync.updateAccount('anilist', {accessToken: newToken});
      return json(401, {errors: [{message: 'Invalid token', status: 401}]});
    });
    await expect(sync.syncWatched(episode)).resolves.toEqual({synced: [], signedOut: []});
    const account = sync.readSyncSettings().anilist;
    expect(account.accessToken).toBe(newToken);
    expect(account.signedOutReason).toBeUndefined();
  });

  it('keeps the token on network errors and other GraphQL errors', async () => {
    const sync = load();
    const token = tokenExpiringIn(200 * DAY);
    sync.updateAccount('anilist', {accessToken: token, username: 'reader'});
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('Network request failed')));
    await expect(sync.syncWatched(episode)).resolves.toEqual({synced: [], signedOut: []});
    fetchMock.mockImplementationOnce(() => json(400, {errors: [{message: 'Validation error'}]}));
    await expect(sync.syncWatched(episode)).resolves.toEqual({synced: [], signedOut: []});
    expect(sync.readSyncSettings().anilist.accessToken).toBe(token);
  });

  it('updates progress with a live token', async () => {
    const sync = load();
    sync.updateAccount('anilist', {accessToken: tokenExpiringIn(200 * DAY), username: 'reader'});
    fetchMock
      .mockImplementationOnce(() => json(200, {data: {Media: {id: 7, episodes: 28, mediaListEntry: {progress: 2}}}}))
      .mockImplementationOnce(() => json(200, {data: {SaveMediaListEntry: {id: 1}}}));
    await expect(sync.syncWatched(episode)).resolves.toEqual({synced: ['anilist'], signedOut: []});
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).variables).toEqual({mediaId: 7, progress: 3, status: 'CURRENT'});
  });

  it('shows how long the sign-in lasts, with a reminder in the last two weeks', () => {
    const sync = load();
    const now = Date.UTC(2026, 10, 6);
    const later = {accessToken: 't', username: 'reader', enabled: true, expiresAt: now + 200 * DAY};
    const status = sync.describeAccount('anilist', later, now);
    expect(status.tone).toBe('connected');
    expect(status.label).toBe('Connected as reader');
    expect(status.detail).toMatch(/^Signed in until .*2027/);

    const soon = sync.describeAccount('anilist', {...later, expiresAt: now + 10 * DAY}, now);
    expect(soon.tone).toBe('warning');
    expect(soon.detail).toMatch(/^AniList ends this sign-in on .*sign in again/i);

    const lapsed = sync.describeAccount('anilist', {...later, expiresAt: now - DAY}, now);
    expect(lapsed.tone).toBe('warning');
    expect(lapsed.detail).toMatch(/^AniList ended this sign-in on /);

    expect(sync.describeAccount('anilist', {...later, expiresAt: undefined}, now)).toEqual({label: 'Connected as reader', tone: 'connected'});
  });
});
