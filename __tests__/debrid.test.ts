jest.mock('../src/lib/sources/vault', () => ({readPikPakAccount: () => undefined}));
import {MMKVLoader} from 'react-native-mmkv-storage';
import {
  ALLDEBRID_BANNED,
  ALLDEBRID_BLOCKED,
  authProblemLabel,
  checkAllCaches,
  connectedServices,
  DebridAuthError,
  getService,
  isAuthFailure,
  KEY_REJECTED,
  pickVideo,
  TORBOX_PLAN_RESTRICTED,
  readDebridAuthStates,
  readDebridSettings,
  sendToDebrid,
  subscribeDebridAuth,
  writeDebridSettings,
} from '../src/lib/debrid';
import {DebridHttpError} from '../src/lib/debrid/http';
import {torbox} from '../src/lib/debrid/services';

const HASH = 'c'.repeat(40);
const json = (body: unknown) => ({ok: true, status: 200, text: async () => JSON.stringify(body)}) as any;
const reply = (body: unknown, status: number) => ({ok: status < 400, status, text: async () => JSON.stringify(body)}) as any;

afterEach(() => jest.restoreAllMocks());

it('picks the largest real video, skipping samples', () => {
  expect(pickVideo([
    {id: '1', name: 'sample.mkv', size: 900},
    {id: '2', name: 'movie.mkv', size: 500},
    {id: '3', name: 'info.nfo', size: 9999},
  ])?.id).toBe('2');
});

it('lists only services with a key, preferred first', () => {
  writeDebridSettings({...readDebridSettings(), keys: {torbox: 'a', realdebrid: 'b'}, preferred: 'realdebrid'});
  expect(connectedServices().map(service => service.id)).toEqual(['realdebrid', 'torbox']);
});

it('marks cached hashes from TorBox', async () => {
  writeDebridSettings({...readDebridSettings(), keys: {torbox: 'key'}, checkCache: true});
  jest.spyOn(global, 'fetch' as any).mockResolvedValue(json({success: true, data: [{hash: HASH, name: 'x'}]}));
  expect(await checkAllCaches([HASH, 'd'.repeat(40)])).toEqual({[HASH]: ['torbox']});
});

it('adds a magnet and waits until the service is ready', async () => {
  writeDebridSettings({...readDebridSettings(), keys: {torbox: 'key'}});
  const fetchMock = jest.spyOn(global, 'fetch' as any)
    .mockResolvedValueOnce(json({success: true, data: {torrent_id: 7}}))
    .mockResolvedValueOnce(json({success: true, data: {id: 7, name: 'Movie', progress: 1, download_finished: true, download_present: true, files: [{id: 0, short_name: 'Movie.mkv', size: 10}]}}))
    .mockResolvedValueOnce(json({success: true, data: 'https://cdn.torbox.test/file'}));
  const resolution = await sendToDebrid('torbox', `magnet:?xt=urn:btih:${HASH}`);
  expect(resolution.files[0].name).toBe('Movie.mkv');
  expect(await torbox.fileLink('key', resolution.transfer, resolution.files[0])).toBe('https://cdn.torbox.test/file');
  expect(String(fetchMock.mock.calls[2][0])).toContain('torrent_id=7&file_id=0');
});

describe('key state', () => {
  const MAGNET = `magnet:?xt=urn:btih:${HASH}`;
  const setKeys = (keys: Record<string, string>) => writeDebridSettings({...readDebridSettings(), keys});
  const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (caught: any) => caught);
  /** Answers the next requests in order (an Error is a network failure); any further request fails. */
  const respond = (...answers: unknown[]) => {
    const mock = jest.spyOn(global, 'fetch' as any).mockRejectedValue(new Error('Unexpected request'));
    answers.forEach(answer => mock.mockImplementationOnce(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer))));
    return mock;
  };

  beforeEach(() => setKeys({}));

  it('marks a TorBox key rejected after a 401 and keeps the key', async () => {
    setKeys({torbox: 'old-key'});
    respond(reply({success: false, error: 'BAD_TOKEN', detail: 'Invalid token'}, 401));
    await expect(getService('torbox').account('old-key')).rejects.toThrow('TorBox rejected the key - paste a new key in Torrents → Debrid and cloud');
    expect(readDebridAuthStates().torbox).toBe('rejected');
    expect(authProblemLabel(readDebridAuthStates().torbox)).toBe(KEY_REJECTED);
    expect(KEY_REJECTED).toBe('Key rejected - paste a new key');
    expect(readDebridSettings().keys.torbox).toBe('old-key');
  });

  it('marks a TorBox key rejected after a 403 from any call, not only Check account', async () => {
    setKeys({torbox: 'key'});
    respond(reply({success: false, detail: 'Forbidden'}, 403));
    const error = await failure(getService('torbox').addMagnet('key', MAGNET));
    expect(error).toBeInstanceOf(DebridAuthError);
    expect(error).toMatchObject({service: 'torbox', state: 'rejected'});
    expect(readDebridAuthStates().torbox).toBe('rejected');
  });

  it('marks a Real-Debrid token rejected on a 401 but not on a 403 for the account', async () => {
    setKeys({realdebrid: 'rd-key'});
    respond(reply({error: 'permission_denied', error_code: 9}, 403), reply({error: 'bad_token', error_code: 8}, 401));
    // A locked or non-premium account keeps Real-Debrid's own message; a new key would not help.
    const denied = await failure(getService('realdebrid').addMagnet('rd-key', MAGNET));
    expect(denied).toBeInstanceOf(DebridHttpError);
    expect(denied.message).toBe('permission_denied');
    expect(readDebridAuthStates().realdebrid).toBeUndefined();
    await expect(getService('realdebrid').account('rd-key')).rejects.toThrow('Real-Debrid rejected the key');
    expect(readDebridAuthStates().realdebrid).toBe('rejected');
  });

  it('marks an Offcloud key rejected on a 401 or 403 and back to ok after a call that works', async () => {
    setKeys({offcloud: 'oc-key'});
    respond(reply({error: 'Unauthorized'}, 401), json({email: 'me@example.com', isPremium: true}), reply({error: 'Forbidden'}, 403));
    await expect(getService('offcloud').account('oc-key')).rejects.toThrow('Offcloud rejected the key');
    expect(readDebridAuthStates().offcloud).toBe('rejected');
    expect((await getService('offcloud').account('oc-key')).username).toBe('me@example.com');
    expect(readDebridAuthStates().offcloud).toBe('ok');
    await expect(getService('offcloud').account('oc-key')).rejects.toThrow('Offcloud rejected the key');
    expect(readDebridAuthStates().offcloud).toBe('rejected');
  });

  it('marks an AllDebrid key rejected on AUTH_BAD_APIKEY and keeps the code', async () => {
    setKeys({alldebrid: 'ad-key'});
    respond(json({status: 'error', error: {code: 'AUTH_BAD_APIKEY', message: 'The auth apikey is invalid'}}));
    const error = await failure(getService('alldebrid').account('ad-key'));
    expect(error).toBeInstanceOf(DebridAuthError);
    expect(error.code).toBe('AUTH_BAD_APIKEY');
    expect(readDebridAuthStates().alldebrid).toBe('rejected');
  });

  it('asks to confirm the AllDebrid email when AllDebrid blocks a new location', async () => {
    setKeys({alldebrid: 'ad-key'});
    respond(json({status: 'error', error: {code: 'AUTH_BLOCKED', message: 'You are logging from a new location, device or app'}}));
    const error = await failure(getService('alldebrid').account('ad-key'));
    expect(error).toMatchObject({service: 'alldebrid', state: 'blocked', code: 'AUTH_BLOCKED'});
    expect(error.message).toBe('AllDebrid blocked this new location - confirm the email AllDebrid sent');
    expect(readDebridAuthStates().alldebrid).toBe('blocked');
    expect(authProblemLabel('blocked')).toBe(ALLDEBRID_BLOCKED);
  });

  it('reads AllDebrid refusals sent with an HTTP error and leaves its other errors alone', async () => {
    setKeys({alldebrid: 'ad-key'});
    respond(
      json({status: 'error', error: {code: 'GENERIC', message: 'An error occured'}}),
      reply({status: 'error', error: {code: 'AUTH_MISSING_APIKEY', message: 'The auth apikey was not sent'}}, 401),
      reply({status: 'error', error: {code: 'AUTH_USER_BANNED', message: 'This account is banned'}}, 401),
    );
    const generic = await failure(getService('alldebrid').addMagnet('ad-key', MAGNET));
    expect(generic).not.toBeInstanceOf(DebridAuthError);
    expect(generic.code).toBe('GENERIC');
    // A key that never arrived is not a refused key.
    await expect(getService('alldebrid').account('ad-key')).rejects.toThrow('The auth apikey was not sent');
    expect(readDebridAuthStates().alldebrid).toBeUndefined();
    // A banned account is not fixed by a new key, so it does not ask for one.
    const banned = await failure(getService('alldebrid').account('ad-key'));
    expect(banned).toMatchObject({service: 'alldebrid', state: 'banned', code: 'AUTH_USER_BANNED'});
    expect(banned.message).toBe(ALLDEBRID_BANNED);
    expect(banned.message).not.toContain('paste a new key');
    expect(readDebridAuthStates().alldebrid).toBe('banned');
    expect(authProblemLabel('banned')).toBe('AllDebrid banned this account - contact AllDebrid support');
  });

  it('says an AllDebrid account is banned also when the ban comes with HTTP 200', async () => {
    setKeys({alldebrid: 'ad-key'});
    respond(json({status: 'error', error: {code: 'AUTH_USER_BANNED', message: 'This account is banned'}}));
    const error = await failure(getService('alldebrid').account('ad-key'));
    expect(error).toBeInstanceOf(DebridAuthError);
    expect(error.state).toBe('banned');
    expect(authProblemLabel(readDebridAuthStates().alldebrid)).toBe(ALLDEBRID_BANNED);
  });

  it('tells a TorBox plan without the feature apart from a refused key', async () => {
    setKeys({torbox: 'tb-key'});
    const restricted = reply({success: false, error: 'PLAN_RESTRICTED_FEATURE', detail: 'This feature is not available on your plan.'}, 403);
    respond(reply({success: false, error: 'BAD_TOKEN'}, 403), restricted, restricted);
    await expect(getService('torbox').account('tb-key')).rejects.toThrow('rejected the key');
    expect(readDebridAuthStates().torbox).toBe('rejected');

    const error = await failure(getService('torbox').addMagnet('tb-key', MAGNET));
    expect(error).not.toBeInstanceOf(DebridAuthError);
    expect(error.message).toBe(TORBOX_PLAN_RESTRICTED);
    expect(error.message).not.toContain('rejected');
    expect(error.code).toBe('PLAN_RESTRICTED_FEATURE');
    // TorBox knew the key, so the earlier refusal no longer stands.
    expect(readDebridAuthStates().torbox).toBe('ok');
    expect(authProblemLabel(readDebridAuthStates().torbox)).toBeUndefined();

    await expect(getService('torbox').list!('tb-key')).rejects.toThrow(TORBOX_PLAN_RESTRICTED);
    expect(isAuthFailure('torbox', new DebridHttpError('x', 403, {success: false, error: 'PLAN_RESTRICTED_FEATURE'}))).toBeUndefined();
    expect(isAuthFailure('torbox', new DebridHttpError('x', 403, {success: false, error: 'BAD_TOKEN'}))).toBe('rejected');
  });

  it('marks a Premiumize key rejected on authentication_failed sent with HTTP 200', async () => {
    setKeys({premiumize: 'pm-key'});
    const refused = json({status: 'error', message: 'Not logged in.', code: 'authentication_failed'});
    const fetchMock = respond(json({status: 'error', message: 'Transfer not found'}), refused, refused);
    await expect(getService('premiumize').status('pm-key', '9')).rejects.toThrow('Transfer not found');
    expect(readDebridAuthStates().premiumize).toBeUndefined();
    await expect(getService('premiumize').account('pm-key')).rejects.toThrow('Premiumize rejected the key');
    expect(readDebridAuthStates().premiumize).toBe('rejected');
    // A refused key stops Add at the cache try instead of also creating a transfer.
    await expect(getService('premiumize').addMagnet('pm-key', MAGNET)).rejects.toBeInstanceOf(DebridAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('marks a Debrid-Link key rejected on badToken, sent as success:false or as a 401', async () => {
    setKeys({debridlink: 'dl-key'});
    respond(
      json({success: false, error: 'maxTorrent'}),
      json({success: false, error: 'badToken'}),
      json({success: true, value: {pseudo: 'me', accountType: 1}}),
      reply({}, 401),
    );
    await expect(getService('debridlink').addMagnet('dl-key', MAGNET)).rejects.toThrow('maxTorrent');
    expect(readDebridAuthStates().debridlink).toBeUndefined();
    const error = await failure(getService('debridlink').account('dl-key'));
    expect(error).toMatchObject({service: 'debridlink', state: 'rejected', code: 'badToken'});
    expect(error.message).toBe('Debrid-Link rejected the key - paste a new key in Torrents → Debrid and cloud');
    expect(readDebridAuthStates().debridlink).toBe('rejected');
    await getService('debridlink').account('dl-key');
    expect(readDebridAuthStates().debridlink).toBe('ok');
    await expect(getService('debridlink').account('dl-key')).rejects.toThrow('Debrid-Link rejected the key');
    expect(readDebridAuthStates().debridlink).toBe('rejected');
  });

  it('sends the AllDebrid and Premiumize keys in the Authorization header, not in the URL', async () => {
    const fetchMock = respond(
      json({status: 'success', data: {user: {username: 'me', isPremium: true}}}),
      json({status: 'success', customer_id: 42, premium_until: 0}),
      json({status: 'success', content: []}),
      json({status: 'success', id: 'transfer-1'}),
    );
    await getService('alldebrid').account('ad-key');
    await getService('premiumize').account('pm-key');
    expect(await getService('premiumize').addMagnet('pm-key', MAGNET)).toEqual({id: 'transfer-1'});
    const calls = fetchMock.mock.calls as [string, RequestInit & {headers: Record<string, string>}][];
    expect(calls.map(([url]) => url)).toEqual([
      'https://api.alldebrid.com/v4/user?agent=droidstream',
      'https://www.premiumize.me/api/account/info',
      'https://www.premiumize.me/api/transfer/directdl',
      'https://www.premiumize.me/api/transfer/create',
    ]);
    expect(calls[0][1].headers.Authorization).toBe('Bearer ad-key');
    expect(calls[1][1].headers.Authorization).toBe('Bearer pm-key');
    // Form posts keep their content type next to the key.
    calls.slice(2).forEach(([, init]) => expect(init.headers).toMatchObject({Authorization: 'Bearer pm-key', 'Content-Type': 'application/x-www-form-urlencoded'}));
  });

  it('tells a refusal apart from other errors', () => {
    expect(isAuthFailure('torbox', new DebridHttpError('Bad gateway', 502, {}))).toBeUndefined();
    expect(isAuthFailure('offcloud', new TypeError('Network request failed'))).toBeUndefined();
    expect(isAuthFailure('premiumize', new DebridHttpError('Unauthorized', 401, {}))).toBeUndefined();
    expect(isAuthFailure('realdebrid', new DebridHttpError('bad_token', 403, {error: 'bad_token', error_code: 8}))).toBe('rejected');
    expect(isAuthFailure('pikpak', new DebridHttpError('Unauthorized', 401, {}))).toBeUndefined();
    // A refusal from one service never marks another.
    expect(isAuthFailure('torbox', new DebridAuthError('x', 'alldebrid', 'blocked'))).toBeUndefined();
  });

  it('leaves the state alone on a timeout or a server error', async () => {
    setKeys({torbox: 'key'});
    respond(reply({success: false, error: 'BAD_TOKEN'}, 401), reply({detail: 'Bad gateway'}, 502), Object.assign(new Error('Aborted'), {name: 'AbortError'}));
    await expect(getService('torbox').account('key')).rejects.toThrow('rejected the key');
    await expect(getService('torbox').account('key')).rejects.toThrow('Bad gateway');
    await expect(getService('torbox').account('key')).rejects.toThrow('The service did not answer in time');
    expect(readDebridAuthStates().torbox).toBe('rejected');
  });

  it('starts over when the key changes and ignores a late answer for the old key', async () => {
    setKeys({torbox: 'old-key'});
    let answer!: (value: unknown) => void;
    respond(reply({success: false, error: 'BAD_TOKEN'}, 401))
      .mockImplementationOnce(() => new Promise(resolve => (answer = resolve)))
      .mockResolvedValueOnce(reply({success: false, error: 'BAD_TOKEN'}, 401));
    await expect(getService('torbox').account('old-key')).rejects.toThrow('rejected the key');
    const listener = jest.fn();
    const unsubscribe = subscribeDebridAuth(listener);
    const late = failure(getService('torbox').account('old-key'));
    setKeys({torbox: 'new-key'});
    expect(readDebridAuthStates().torbox).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
    answer(reply({success: false, error: 'BAD_TOKEN'}, 401));
    expect(await late).toBeInstanceOf(DebridAuthError);
    expect(readDebridAuthStates().torbox).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    // Changing another setting keeps what is known about the key.
    await expect(getService('torbox').account('new-key')).rejects.toThrow('rejected the key');
    const before = readDebridSettings();
    writeDebridSettings({...before, cachedOnly: !before.cachedOnly});
    expect(readDebridAuthStates().torbox).toBe('rejected');
    writeDebridSettings(before);
  });

  it('keeps the state beside the keys in the encrypted debrid store, without the key', async () => {
    setKeys({torbox: 'tb-key'});
    respond(reply({success: false, error: 'BAD_TOKEN'}, 403));
    await expect(getService('torbox').account('tb-key')).rejects.toThrow('rejected the key');
    const store = new MMKVLoader().withInstanceID('droid-stream-debrid').withEncryption().initialize();
    expect(JSON.parse(store.getString('auth-state') || '{}')).toEqual({torbox: 'rejected'});
    expect(store.getString('auth-state')).not.toContain('tb-key');
  });

  it('leaves the state alone on a network error', async () => {
    setKeys({torbox: 'key'});
    const network = new TypeError('Network request failed');
    respond(json({success: true, data: {email: 'me@example.com', plan: 2}}), network, reply({success: false, error: 'BAD_TOKEN'}, 401), network);
    await getService('torbox').account('key');
    expect(readDebridAuthStates().torbox).toBe('ok');
    await expect(getService('torbox').account('key')).rejects.toBe(network);
    expect(readDebridAuthStates().torbox).toBe('ok');
    await expect(getService('torbox').account('key')).rejects.toThrow('rejected the key');
    await expect(getService('torbox').account('key')).rejects.toBe(network);
    expect(readDebridAuthStates().torbox).toBe('rejected');
  });
});
