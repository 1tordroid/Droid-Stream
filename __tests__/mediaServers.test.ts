// Jellyfin, Emby, Plex and WebDAV sources: each install signs in with its own
// device id, and a rejected sign-in surfaces as a SourceAuthError.
let mockUuidCount = 0;
jest.mock('expo-crypto', () => ({randomUUID: () => `uuid-${++mockUuidCount}`}));

const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});

describe('media server sign-ins', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  const load = () => ({
    media: require('../src/lib/sources/mediaServers'),
    webdav: require('../src/lib/sources/webdav'),
    vault: require('../src/lib/sources/vault'),
    auth: require('../src/lib/sources/authErrors'),
  });

  it('signs in to Jellyfin with the given device id and no token', async () => {
    const {media} = load();
    fetchMock.mockReturnValue(json(200, {User: {Id: 'u1'}, AccessToken: 't1'}));
    await expect(media.signInJellyfin('https://jf.local/', 'me', 'pw', 'dev-1')).resolves.toEqual({userId: 'u1', token: 't1'});
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://jf.local/Users/AuthenticateByName');
    expect(init.headers.Authorization).toContain('DeviceId="dev-1"');
    expect(init.headers.Authorization).not.toContain('Token=');
    expect(JSON.parse(init.body)).toEqual({Username: 'me', Pw: 'pw'});
  });

  it('says the password was not accepted when Jellyfin refuses the sign-in', async () => {
    const {media} = load();
    fetchMock.mockReturnValue(json(401, {}));
    await expect(media.signInEmby('https://emby.local', 'me', 'bad', 'dev-1')).rejects.toThrow('Emby did not accept this username or password.');
  });

  it('browses with the device id and token, and plays with ApiKey on Jellyfin', async () => {
    const {media} = load();
    fetchMock.mockReturnValue(json(200, {Items: [{Id: 'm1', Name: 'Movie', Type: 'Movie'}, {Id: 'f1', Name: 'Shows', Type: 'Folder'}]}));
    const items = await media.listJellyfin('https://jf.local', 'u1', 'tok', 'p1', 'dev-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://jf.local/Users/u1/Items?Recursive=false&ParentId=p1');
    expect(init.headers.Authorization).toContain('DeviceId="dev-1"');
    expect(init.headers.Authorization).toContain('Token="tok"');
    expect(items[0].playUrl).toBe('https://jf.local/Videos/m1/stream?static=true&ApiKey=tok');
    expect(items[0].playUrl).not.toContain('api_key=');
    expect(items[1]).toMatchObject({kind: 'folder', playUrl: undefined});
  });

  it('keeps the documented api_key query for Emby', async () => {
    const {media} = load();
    fetchMock.mockReturnValue(json(200, {Items: [{Id: 'm1', Name: 'Movie', Type: 'Movie'}]}));
    const [item] = await media.listEmby('https://emby.local', 'u1', 'tok', undefined, 'dev-1');
    expect(item.playUrl).toBe('https://emby.local/Videos/m1/stream?static=true&api_key=tok');
    // Emby keeps the MediaBrowser Authorization scheme; only the DeviceId is new.
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      'MediaBrowser Client="DroidStream", Device="Droid Stream", DeviceId="dev-1", Version="1.0", Token="tok"',
    );
  });

  it('sends the old shared device id for a source saved without one', async () => {
    const {media} = load();
    fetchMock.mockReturnValue(json(200, {Items: []}));
    await media.listJellyfin('https://jf.local', 'u1', 'tok');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toContain('DeviceId="droid-stream"');
  });

  it.each([401, 403])('turns a %i from Emby browsing into a SourceAuthError for Emby', async status => {
    const {media, auth} = load();
    fetchMock.mockReturnValue(json(status, {}));
    const error = await media.listEmby('https://emby.local', 'u1', 'tok', undefined, 'dev-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(auth.SourceAuthError);
    expect(error).toMatchObject({kind: 'emby', status});
    expect(error.message).toContain('Emby');
  });

  it('keeps other server errors as plain errors naming the real service', async () => {
    const {media, auth} = load();
    fetchMock.mockReturnValue(json(500, {}));
    const error = await media.listEmby('https://emby.local', 'u1', 'tok').catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(auth.SourceAuthError);
    expect(error.message).toBe('Emby library failed (500)');
  });

  it('signs in to Plex with the given client identifier', async () => {
    const {media} = load();
    fetchMock.mockReturnValue(json(201, {user: {authToken: 'plex-token'}}));
    await expect(media.signInPlex('me', 'pw', 'install-1')).resolves.toBe('plex-token');
    expect(fetchMock.mock.calls[0][1].headers['X-Plex-Client-Identifier']).toBe('install-1');
  });

  it('maps a Plex 401 to a SourceAuthError and puts the token on play URLs', async () => {
    const {media, auth} = load();
    fetchMock.mockReturnValueOnce(json(401, {}));
    await expect(media.listPlex('https://plex.local', 'tok')).rejects.toBeInstanceOf(auth.SourceAuthError);

    fetchMock.mockReturnValueOnce(
      json(200, {
        MediaContainer: {
          Metadata: [
            {ratingKey: '7', title: 'Film', type: 'movie', Media: [{Part: [{key: '/library/parts/9/1/file.mkv'}]}]},
            {ratingKey: '8', title: 'Other', type: 'movie'},
          ],
        },
      }),
    );
    const [film, other] = await media.listPlex('https://plex.local', 'tok', '/library/sections/1/all');
    expect(film.playUrl).toBe('https://plex.local/library/parts/9/1/file.mkv?X-Plex-Token=tok');
    expect(other.playUrl).toBe('https://plex.local/library/metadata/8?X-Plex-Token=tok');
  });

  it('opens Plex libraries as folders and follows relative keys', async () => {
    const {media} = load();
    fetchMock.mockReturnValueOnce(json(200, {MediaContainer: {Directory: [{key: '1', title: 'Movies', type: 'movie'}]}}));
    expect(await media.listPlex('https://plex.local/', 'tok')).toEqual([{id: '/library/sections/1', title: 'Movies', kind: 'folder'}]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://plex.local/library/sections?X-Plex-Token=tok');

    fetchMock.mockReturnValueOnce(json(200, {MediaContainer: {Directory: [{key: 'all', title: 'All Movies'}]}}));
    expect(await media.listPlex('https://plex.local', 'tok', '/library/sections/1')).toEqual([{id: '/library/sections/1/all', title: 'All Movies', kind: 'folder'}]);

    fetchMock.mockReturnValueOnce(json(200, {MediaContainer: {Metadata: [{ratingKey: '5', key: '/library/metadata/5/children', title: 'Show', type: 'show'}]}}));
    const [show] = await media.listPlex('https://plex.local', 'tok', '/library/sections/2/all');
    expect(show).toEqual({id: '/library/metadata/5/children', title: 'Show', kind: 'folder', playUrl: undefined});
  });

  it.each([401, 403])('maps a %i from WebDAV listing to a SourceAuthError', async status => {
    const {webdav, auth} = load();
    fetchMock.mockReturnValue(json(status, {}));
    const error = await webdav.listWebDav('https://dav.local', '', 'me', 'pw').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(auth.SourceAuthError);
    expect(error).toMatchObject({kind: 'webdav', status});
  });

  it('keeps one install id in the encrypted source store', () => {
    const {vault} = load();
    const first = vault.getInstallId();
    expect(first).toMatch(/^uuid-\d+$/);
    expect(vault.getInstallId()).toBe(first);
  });

  it('updates a source in place, keeping its id and position', () => {
    const {vault} = load();
    vault.saveSource({id: 'a', kind: 'webdav', name: 'A', server: 's', username: 'u', secret: 'p'});
    vault.saveSource({id: 'b', kind: 'jellyfin', name: 'B', server: 's', username: 'u', secret: 'p'});
    expect(vault.updateSource('a', {authState: 'signedOut'})).toMatchObject({id: 'a', authState: 'signedOut', secret: 'p'});
    expect(vault.listSources().map((item: {id: string}) => item.id)).toEqual(['a', 'b']);
    expect(vault.updateSource('missing', {name: 'x'})).toBeUndefined();

    // Saving a signed-in-again source replaces it where it was.
    vault.saveSource({id: 'a', kind: 'webdav', name: 'A2', server: 's', username: 'u', secret: 'new'});
    expect(vault.listSources()).toEqual([
      {id: 'a', kind: 'webdav', name: 'A2', server: 's', username: 'u', secret: 'new'},
      expect.objectContaining({id: 'b'}),
    ]);
  });
});
