// Tordroid Plus portal client: sign-in with a JWT kept in the encrypted
// store, renewal on 401, family downloads, media streams, quota and WebDAV.
// Fixtures follow the portal's Flask API answers.
const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body)});

const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({email: 'kid@family.test', exp})).toString('base64url')}.s`;

const TASK_ROW = {
  id: 7,
  created_at: '2026-10-01T10:00:00+00:00',
  action: 'add',
  data: {
    url: 'magnet:?xt=urn:btih:aaa',
    task: {upload_type: 'UPLOAD_TYPE_URL', task: {id: 'VT1', name: 'raw name', file_id: 'F1', phase: 'PHASE_TYPE_COMPLETE', progress: 100, file_size: '900'}},
    whatslink: {name: 'Big Buck Bunny', size: 1000, count: 2, screenshots: ['https://w/1.jpg']},
  },
};

describe('Tordroid Plus client', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  const load = () => ({
    client: require('../src/lib/tordroidPlus/client'),
    vault: require('../src/lib/sources/vault'),
  });

  const signedIn = (vault: any, extra: Record<string, unknown> = {}) =>
    vault.saveTordroidPlusAccount({server: 'https://plus.example', email: 'kid@family.test', password: 'pw', token: 'old', ...extra});

  it('finds the API under /api and reads the token expiry', () => {
    const {client} = load();
    expect(client.normalizeServer(' plus.tordroid.com/ ')).toBe('https://plus.tordroid.com');
    expect(client.normalizeServer('')).toBe('https://plus.tordroid.com');
    expect(client.apiBase('https://plus.tordroid.com')).toBe('https://plus.tordroid.com/api');
    expect(client.apiBase('http://192.168.1.5:5000/api/')).toBe('http://192.168.1.5:5000/api');
    expect(client.tokenExpiry(jwt(2000000000))).toBe(2000000000 * 1000);
    expect(client.tokenExpiry('not-a-jwt')).toBeUndefined();
  });

  it('signs in and keeps the token, password and expiry in the encrypted store', async () => {
    const {client, vault} = load();
    const token = jwt(Math.floor(Date.now() / 1000) + 86400);
    fetchMock.mockImplementation(() => json(200, {message: 'Login successful', user: {email: 'kid@family.test', is_admin: false}, token}));
    await client.signInToTordroidPlus('plus.example', 'kid@family.test', 'pw');
    expect(fetchMock).toHaveBeenCalledWith('https://plus.example/api/login', expect.objectContaining({method: 'POST', body: JSON.stringify({email: 'kid@family.test', password: 'pw'})}));
    expect(vault.readTordroidPlusAccount()).toMatchObject({server: 'https://plus.example', email: 'kid@family.test', password: 'pw', token});
    expect(vault.readTordroidPlusAccount().expiresAt).toBeGreaterThan(Date.now());
    expect(client.isTordroidPlusSignedIn()).toBe(true);
  });

  it('shows the portal message for a wrong password', async () => {
    const {client, vault} = load();
    fetchMock.mockImplementation(() => json(401, {error: 'Authentication failed', message: 'Invalid email or password'}));
    await expect(client.signInToTordroidPlus('plus.example', 'kid@family.test', 'bad')).rejects.toThrow('Invalid email or password');
    expect(vault.readTordroidPlusAccount()).toBeUndefined();
  });

  it('signs in again with the saved password after a 401 and retries once', async () => {
    const {client, vault} = load();
    signedIn(vault);
    const fresh = jwt(Math.floor(Date.now() / 1000) + 86400);
    fetchMock.mockImplementation((url: string, init: any) => {
      if (url.endsWith('/login')) return json(200, {token: fresh, user: {email: 'kid@family.test'}});
      return init.headers.Authorization === `Bearer ${fresh}` ? json(200, {data: [TASK_ROW], count: 1, page: 1, limit: 50}) : json(401, {error: 'Authentication required'});
    });
    const page = await client.listTordroidPlusTasks();
    expect(page.tasks).toHaveLength(1);
    expect(vault.readTordroidPlusAccount().token).toBe(fresh);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'https://plus.example/api/tasks?page=1&limit=50',
      'https://plus.example/api/login',
      'https://plus.example/api/tasks?page=1&limit=50',
    ]);
  });

  it('asks for a new sign-in when the saved password is refused', async () => {
    const {client, vault} = load();
    signedIn(vault);
    fetchMock.mockImplementation((url: string) => (url.endsWith('/login') ? json(401, {message: 'Invalid email or password'}) : json(401, {})));
    await expect(client.listTordroidPlusTasks()).rejects.toBeInstanceOf(client.TordroidPlusAuthError);
    expect(vault.readTordroidPlusAccount()).toMatchObject({email: 'kid@family.test', signedOut: true, token: '', password: ''});
    expect(client.isTordroidPlusSignedIn()).toBe(false);
  });

  it('renews a token that is about to end before calling', async () => {
    const {client, vault} = load();
    signedIn(vault, {expiresAt: Date.now() + 10_000});
    const fresh = jwt(Math.floor(Date.now() / 1000) + 86400);
    fetchMock.mockImplementation((url: string) => (url.endsWith('/login') ? json(200, {token: fresh}) : json(200, {storage: {quota: {limit: '100', usage: '40'}}, transfer: {}})));
    const quota = await client.tordroidPlusQuota();
    expect(quota.storage).toMatchObject({used: 40, limit: 100});
    expect(fetchMock.mock.calls[0][0]).toBe('https://plus.example/api/login');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${fresh}`);
  });

  it('reads family downloads with progress', () => {
    const {client} = load();
    expect(client.parseTordroidPlusTask(TASK_ROW)).toEqual({
      id: 7,
      createdAt: Date.parse('2026-10-01T10:00:00+00:00'),
      name: 'Big Buck Bunny',
      url: 'magnet:?xt=urn:btih:aaa',
      fileId: 'F1',
      phase: 'PHASE_TYPE_COMPLETE',
      progress: 100,
      state: 'done',
      size: 1000,
      screenshots: ['https://w/1.jpg'],
    });
    const running = client.parseTordroidPlusTask({id: 8, created_at: '', data: {url: 'm', task: {task: {name: 'Show', phase: 'PHASE_TYPE_RUNNING', progress: 42}}}});
    expect(running).toMatchObject({name: 'Show', state: 'running', progress: 42});
    expect(running.fileId).toBeUndefined();
    expect(client.parseTordroidPlusTask({id: 9, data: {task: {task: {phase: 'PHASE_TYPE_ERROR', message: 'Bad link'}}}})).toMatchObject({state: 'failed', message: 'Bad link', name: 'Download'});
  });

  it('reads media: a folder of videos, or a file with transcodes first', async () => {
    const {client, vault} = load();
    signedIn(vault);
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/media/FOLDER')
        ? json(200, {type: 'folder', id: 'FOLDER', name: 'Show', videos: [{id: 'v1', name: 'e1.mkv', path: 'Season 1/', size: 5, mime_type: 'video/x-matroska', thumbnail: 'https://t'}]})
        : json(200, {
            type: 'file',
            id: 'v1',
            name: 'e1.mkv',
            path: '',
            size: 5,
            is_video: true,
            streams: [
              {label: '1080P', url: 'https://vod/1080.m3u8', width: 1920, height: 1080, is_origin: false},
              {label: 'Original file', url: 'https://dl/e1.mkv', is_origin: true},
            ],
          }),
    );
    expect(await client.tordroidPlusMedia('FOLDER')).toEqual({type: 'folder', id: 'FOLDER', name: 'Show', videos: [{id: 'v1', name: 'e1.mkv', path: 'Season 1/', size: 5, thumbnail: 'https://t'}]});
    const file = await client.tordroidPlusMedia('v1');
    expect(file.streams).toEqual([
      {label: '1080P', url: 'https://vod/1080.m3u8', height: 1080, original: false, type: 'm3u8'},
      {label: 'Original', url: 'https://dl/e1.mkv', original: true, type: 'mp4'},
    ]);
  });

  it('adds magnets, makes share links and picks the longest WebDAV login', async () => {
    const {client, vault} = load();
    signedIn(vault);
    fetchMock.mockImplementation((url: string, init: any) => {
      if (url.endsWith('/add')) return JSON.parse(init.body).url === 'magnet:?xt=urn:btih:dup' ? json(200, {message: 'Task already exists', task: TASK_ROW}) : json(200, {message: 'Task added successfully', task: {}});
      if (url.endsWith('/share')) return json(200, {share_url: 'https://mypikpak.com/s/x', pass_code: ''});
      return json(200, {
        available: true,
        clients: [
          {username: 'a', password: 'p1', serverUrl: 'https://dav.mypikpak.com/', expiresAt: '2026-11-08T00:00:00Z'},
          {username: 'b', password: 'p2', serverUrl: 'https://dav.mypikpak.com', expiresAt: '2026-11-09T00:00:00Z'},
        ],
      });
    });
    expect(await client.addToTordroidPlus(' magnet:?xt=urn:btih:new ')).toBe('Added to the family downloads');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({url: 'magnet:?xt=urn:btih:new'});
    expect(await client.addToTordroidPlus('magnet:?xt=urn:btih:dup')).toBe('Already in the family downloads');
    expect(await client.shareTordroidPlusFile('F1')).toEqual({url: 'https://mypikpak.com/s/x'});
    expect(await client.tordroidPlusWebDav()).toEqual({server: 'https://dav.mypikpak.com', username: 'b', password: 'p2', expiresAt: Date.parse('2026-11-09T00:00:00Z')});
    expect(client.parseTordroidPlusWebDav({available: false, clients: []})).toBeUndefined();
  });

  it('shows the size-limit message from /add', async () => {
    const {client, vault} = load();
    signedIn(vault);
    fetchMock.mockImplementation(() => json(400, {error: 'File size exceeds the 50 GB limit'}));
    await expect(client.addToTordroidPlus('magnet:?xt=urn:btih:huge')).rejects.toThrow('File size exceeds the 50 GB limit');
  });
});
