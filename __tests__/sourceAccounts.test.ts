// Saving, signing in again and playing saved sources: per-install device ids,
// no reuse of the old shared id, and playback with the saved sign-in.
let mockUuidCount = 0;
jest.mock('expo-crypto', () => ({randomUUID: () => `install-${++mockUuidCount}`}));
jest.mock('../src/lib/sources/smb', () => ({listSmbShare: jest.fn(async () => [])}));

const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});

describe('saved source accounts', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  const load = () => ({
    accounts: require('../src/lib/sources/accounts'),
    vault: require('../src/lib/sources/vault'),
    auth: require('../src/lib/sources/authErrors'),
  });

  const form = (extra: Record<string, unknown> = {}) => ({
    id: '',
    kind: 'jellyfin',
    name: 'Home',
    server: 'https://jf.local',
    username: 'me',
    secret: 'pw',
    share: '',
    ...extra,
  });

  const deviceIdSent = (call = 0) => /DeviceId="([^"]+)"/.exec(fetchMock.mock.calls[call][1].headers.Authorization)?.[1];

  it('signs a new Jellyfin source in with a device id made for this install and source', async () => {
    const {accounts, vault} = load();
    fetchMock.mockReturnValue(json(200, {User: {Id: 'user-guid'}, AccessToken: 'tok'}));
    const saved = await accounts.completeSourceForm(form({id: 's1'}));
    const install = vault.getInstallId();
    expect(deviceIdSent()).toBe(`${install}-s1`);
    expect(saved).toEqual({
      id: 's1',
      kind: 'jellyfin',
      name: 'Home',
      server: 'https://jf.local',
      share: '',
      username: 'user-guid',
      secret: 'tok',
      loginName: 'me',
      deviceId: `${install}-s1`,
      authState: 'ok',
    });
  });

  it('names a source after its service and keeps the share only for SMB', async () => {
    const {accounts} = load();
    const webdav = await accounts.completeSourceForm(form({kind: 'webdav', name: ' ', share: 'Movies'}));
    expect(webdav).toMatchObject({name: 'WebDAV', share: '', username: 'me', secret: 'pw'});
    const smb = await accounts.completeSourceForm(form({kind: 'smb', name: '', server: ' 192.168.1.10 ', share: 'Movies'}));
    expect(smb).toMatchObject({name: 'SMB', server: '192.168.1.10', share: 'Movies'});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives a source saved before 5.5.0 a new device id when it signs in again', async () => {
    const {accounts} = load();
    const old = {id: 'old', kind: 'emby', name: 'Old', server: 'https://emby.local', username: 'user-guid', secret: 'dead', authState: 'signedOut'};
    fetchMock.mockReturnValue(json(200, {User: {Id: 'user-guid'}, AccessToken: 'fresh'}));
    const saved = await accounts.completeSourceForm({...accounts.formFromSource(old), username: 'me', secret: 'pw'}, old);
    expect(deviceIdSent()).not.toBe('droid-stream');
    expect(saved).toMatchObject({id: 'old', secret: 'fresh', loginName: 'me', deviceId: deviceIdSent(), authState: 'ok'});
  });

  it('never reuses a device id that this install did not make', () => {
    const {accounts, vault} = load();
    const install = vault.getInstallId();
    expect(accounts.mediaDeviceIdFor('s1', 'droid-stream')).toBe(`${install}-s1`);
    expect(accounts.mediaDeviceIdFor('s1', 'other-install-s1')).toBe(`${install}-s1`);
    expect(accounts.mediaDeviceIdFor('s1', undefined)).toBe(`${install}-s1`);
    expect(accounts.mediaDeviceIdFor('s1', `${install}-s1`)).toBe(`${install}-s1`);
  });

  it('prefills the sign-in again form without the password', () => {
    const {accounts} = load();
    const source = {id: 's1', kind: 'jellyfin', name: 'Home', server: 'https://jf.local', username: 'user-guid', secret: 'tok', loginName: 'me'};
    expect(accounts.formFromSource(source)).toEqual({id: 's1', kind: 'jellyfin', name: 'Home', server: 'https://jf.local', username: 'me', secret: '', share: ''});
    // Saved before 5.5.0: only the server's user id is known, never shown as a login.
    expect(accounts.formFromSource({...source, loginName: undefined}).username).toBe('');
    expect(accounts.formFromSource({...source, kind: 'webdav', username: 'dav-user', loginName: undefined}).username).toBe('dav-user');
  });

  it('keeps the current sign-in when the password is left empty and the login is unchanged', async () => {
    const {accounts} = load();
    const source = {id: 's1', kind: 'jellyfin', name: 'Home', server: 'https://jf.local', username: 'user-guid', secret: 'tok', loginName: 'me', deviceId: 'd', authState: 'ok'};
    const saved = await accounts.completeSourceForm({...accounts.formFromSource(source), name: 'Living room', server: 'https://jf.example.com'}, source);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saved).toMatchObject({id: 's1', name: 'Living room', server: 'https://jf.example.com', secret: 'tok', deviceId: 'd', loginName: 'me'});

    const dav = {id: 'w', kind: 'webdav', name: 'NAS', server: 'https://dav.local', username: 'me', secret: 'saved'};
    expect(await accounts.completeSourceForm({...accounts.formFromSource(dav), server: 'https://dav2.local'}, dav)).toMatchObject({secret: 'saved'});
    expect(await accounts.completeSourceForm({...accounts.formFromSource(dav), secret: 'new'}, dav)).toMatchObject({secret: 'new'});
  });

  it('signs in again when the login changes or the source was signed out', async () => {
    const {accounts} = load();
    const source = {id: 's1', kind: 'jellyfin', name: 'Home', server: 'https://jf.local', username: 'user-guid', secret: 'tok', loginName: 'me', authState: 'ok'};
    fetchMock.mockReturnValue(json(200, {User: {Id: 'other-guid'}, AccessToken: 'tok2'}));
    expect(await accounts.completeSourceForm({...accounts.formFromSource(source), username: 'kid'}, source)).toMatchObject({username: 'other-guid', loginName: 'kid'});
    // Signed out: even an empty password is sent, for users without one.
    await accounts.completeSourceForm(accounts.formFromSource(source), {...source, authState: 'signedOut'});
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({Username: 'me', Pw: ''});
  });

  it('leaves the saved source alone when signing in again fails', async () => {
    const {accounts, vault} = load();
    const source = {id: 's1', kind: 'jellyfin', name: 'Home', server: 'https://jf.local', username: 'user-guid', secret: 'tok', loginName: 'me', authState: 'signedOut'};
    vault.saveSource(source);
    fetchMock.mockReturnValue(json(401, {}));
    await expect(accounts.completeSourceForm({...accounts.formFromSource(source), secret: 'wrong'}, source)).rejects.toThrow('did not accept');
    expect(vault.listSources()).toEqual([source]);
  });

  it('signs in to Plex with the install id as client identifier, or keeps a pasted token', async () => {
    const {accounts, vault} = load();
    fetchMock.mockReturnValue(json(201, {user: {authToken: 'plex-token'}}));
    const saved = await accounts.completeSourceForm(form({kind: 'plex', server: 'https://plex.local'}));
    expect(fetchMock.mock.calls[0][1].headers['X-Plex-Client-Identifier']).toBe(vault.getInstallId());
    expect(saved).toMatchObject({kind: 'plex', username: 'me', secret: 'plex-token', deviceId: vault.getInstallId()});

    const pasted = await accounts.completeSourceForm(form({kind: 'plex', server: 'https://plex.local', username: '', secret: ' pasted\n'}));
    expect(pasted).toMatchObject({username: '', secret: 'pasted'});
    await expect(accounts.completeSourceForm(form({kind: 'plex', server: 'https://plex.local', username: '', secret: ''}))).rejects.toThrow('Paste a Plex token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes the saved device id when browsing Jellyfin', async () => {
    const {accounts} = load();
    fetchMock.mockReturnValue(json(200, {Items: []}));
    await accounts.listSourceRows({id: 's1', kind: 'jellyfin', name: 'Home', server: 'https://jf.local', username: 'u', secret: 't', deviceId: 'dev-9'});
    expect(deviceIdSent()).toBe('dev-9');
  });

  it('lets a WebDAV rejection reach the screen as a SourceAuthError', async () => {
    const {accounts, auth} = load();
    fetchMock.mockReturnValue(json(401, {}));
    await expect(
      accounts.listSourceRows({id: 'w', kind: 'webdav', name: 'NAS', server: 'https://dav.local', username: 'me', secret: 'pw'}),
    ).rejects.toBeInstanceOf(auth.SourceAuthError);
  });

  it('plays a WebDAV file with its Basic sign-in header', () => {
    const {accounts} = load();
    const navigation = {navigate: jest.fn()};
    accounts.playSource(navigation, {id: 'w', kind: 'webdav', name: 'NAS', server: 'https://dav.local', username: 'me', secret: 'pw'}, 'Clip', 'https://dav.local/clip.mkv');
    const [screen, params] = navigation.navigate.mock.calls[0];
    expect(screen).toBe('Player');
    expect(params.initialStream).toEqual({
      server: 'Source',
      link: 'https://dav.local/clip.mkv',
      type: 'mkv',
      headers: {Authorization: `Basic ${Buffer.from('me:pw').toString('base64')}`},
    });
    expect(params.episodeList).toEqual([{title: 'Clip', link: 'https://dav.local/clip.mkv'}]);
    expect(params.directUrl).toBe('https://dav.local/clip.mkv');
  });

  it('keeps media server tokens out of the episode link the player stores', () => {
    const {accounts} = load();
    const navigation = {navigate: jest.fn()};
    const source = {id: 'j', kind: 'jellyfin', name: 'Home', server: 'https://jf.local', username: 'u', secret: 'tok'};
    const url = 'https://jf.local/Videos/m1/stream?static=true&ApiKey=tok';
    accounts.playSource(navigation, source, 'Film', url);
    const params = navigation.navigate.mock.calls[0][1];
    expect(params.episodeList).toEqual([{title: 'Film', link: 'https://jf.local/Videos/m1/stream?static=true'}]);
    expect(params.initialStream).toEqual({server: 'Source', link: url, type: 'mkv'});
    expect(params.directUrl).toBe(url);

    expect(accounts.withoutToken('https://plex.local/library/parts/9/1/file.mkv?X-Plex-Token=tok')).toBe('https://plex.local/library/parts/9/1/file.mkv');
    expect(accounts.withoutToken('https://emby.local/Videos/1/stream?static=true&api_key=tok')).toBe('https://emby.local/Videos/1/stream?static=true');
    expect(accounts.withoutToken('https://jf.local/a')).toBe('https://jf.local/a');

    accounts.playSource(navigation, source, 'Film');
    expect(navigation.navigate).toHaveBeenCalledTimes(1);
  });

  it('tells the user what to do when a sign-in ends', () => {
    const {auth} = load();
    expect(auth.sourceSignedOutMessage({name: 'Home', kind: 'emby'})).toBe('Home: Emby ended this sign-in. Sign in again.');
    expect(auth.sourceSignedOutMessage({name: 'NAS', kind: 'webdav'})).toBe('NAS: WebDAV no longer accepts the saved password. Enter it again.');
    expect(new auth.SourceAuthError('plex', 401).message).toBe('Plex ended this sign-in (401). Sign in again.');
  });
});
