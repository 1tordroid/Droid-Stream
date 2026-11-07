// Plex sign-in with a plex.tv/link code: the PIN and its polling (pending,
// approved, expired, errors), the server list, and which address of a
// server is used (this network, then internet, then relay; it must answer).
import {
  checkPlexPin,
  chooseConnection,
  connectionRank,
  listPlexServers,
  orderedConnections,
  parsePlexServers,
  PLEX_LINK_URL,
  startPlexPin,
  type PlexServer,
} from '../src/lib/sources/plexLink';
import {EXPIRED_MESSAGE, MAX_TRANSIENT_ERRORS, startDevicePoll} from '../src/lib/watchSync/devicePoll';
import {DeviceCodeStopError} from '../src/lib/watchSync';

const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});

const CLIENT = 'install-a';
const NOW = 1_700_000_000_000;

describe('plex.tv PIN', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => jest.useRealTimers());

  it('asks for a short code with the app headers and counts the time left from now', async () => {
    fetchMock.mockReturnValueOnce(json(201, {id: 42, code: 'ab1c', expiresIn: 900, authToken: null}));
    const code = await startPlexPin(CLIENT, NOW);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://plex.tv/api/v2/pins?strong=false');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      'X-Plex-Client-Identifier': CLIENT,
      'X-Plex-Product': 'Droid Stream',
      'X-Plex-Version': '1.0',
    });
    expect(code).toEqual({userCode: 'AB1C', verificationUrl: PLEX_LINK_URL, deviceCode: '42', intervalSeconds: 2, expiresAt: NOW + 900_000});
  });

  it('says so when plex.tv gives no code', async () => {
    fetchMock.mockReturnValueOnce(json(503, {}));
    await expect(startPlexPin(CLIENT)).rejects.toThrow('plex.tv did not give a code (503). Try again.');
    fetchMock.mockReturnValueOnce(json(201, {id: 1}));
    await expect(startPlexPin(CLIENT)).rejects.toThrow('plex.tv did not give a code. Try again.');
  });

  it('reads pending, approved, slow down, expired and passing errors from one check', async () => {
    const code = {userCode: 'AB1C', verificationUrl: PLEX_LINK_URL, deviceCode: '42', intervalSeconds: 2, expiresAt: NOW + 900_000};
    fetchMock.mockReturnValueOnce(json(200, {id: 42, authToken: null}));
    await expect(checkPlexPin(code, CLIENT)).resolves.toEqual({result: 'pending'});
    expect(fetchMock.mock.calls[0][0]).toBe('https://plex.tv/api/v2/pins/42');
    expect(fetchMock.mock.calls[0][1].headers['X-Plex-Client-Identifier']).toBe(CLIENT);

    fetchMock.mockReturnValueOnce(json(200, {id: 42, authToken: 'acct-token'}));
    await expect(checkPlexPin(code, CLIENT)).resolves.toEqual({result: 'approved', token: 'acct-token'});

    fetchMock.mockReturnValueOnce(json(429, {}));
    await expect(checkPlexPin(code, CLIENT)).resolves.toEqual({result: 'slow'});

    fetchMock.mockReturnValueOnce(json(404, {}));
    const expired = checkPlexPin(code, CLIENT);
    await expect(expired).rejects.toBeInstanceOf(DeviceCodeStopError);
    await expect(expired).rejects.toThrow(EXPIRED_MESSAGE);

    fetchMock.mockReturnValueOnce(json(500, {}));
    const failed = checkPlexPin(code, CLIENT);
    await expect(failed).rejects.not.toBeInstanceOf(DeviceCodeStopError);
  });

  describe('polling', () => {
    const run = (expiresIn = 900) => {
      jest.useFakeTimers({now: NOW});
      const code = {userCode: 'AB1C', verificationUrl: PLEX_LINK_URL, deviceCode: '42', intervalSeconds: 2, expiresAt: NOW + expiresIn * 1000};
      const onApproved = jest.fn();
      const onStop = jest.fn();
      let token = '';
      const cancel = startDevicePoll(code, {
        poll: async next => {
          const answer = await checkPlexPin(next, CLIENT);
          if (answer.token) token = answer.token;
          return answer.result;
        },
        onApproved: () => onApproved(token),
        onStop,
      });
      return {onApproved, onStop, cancel};
    };

    it('waits while pending and hands over the token once approved', async () => {
      fetchMock
        .mockReturnValueOnce(json(200, {authToken: null}))
        .mockReturnValueOnce(json(200, {authToken: null}))
        .mockReturnValueOnce(json(200, {authToken: 'acct-token'}));
      const {onApproved, onStop} = run();
      await jest.advanceTimersByTimeAsync(1999);
      expect(fetchMock).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(4000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(onApproved).toHaveBeenCalledWith('acct-token');
      expect(onStop).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(10_000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('stops when the code runs out', async () => {
      fetchMock.mockImplementation(() => json(200, {authToken: null}));
      const {onApproved, onStop} = run(5);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(onStop).toHaveBeenCalledWith(EXPIRED_MESSAGE);
      expect(onApproved).not.toHaveBeenCalled();
      const calls = fetchMock.mock.calls.length;
      await jest.advanceTimersByTimeAsync(10_000);
      expect(fetchMock.mock.calls.length).toBe(calls);
    });

    it('stops at once when plex.tv no longer knows the PIN', async () => {
      fetchMock.mockReturnValueOnce(json(404, {}));
      const {onStop} = run();
      await jest.advanceTimersByTimeAsync(2000);
      expect(onStop).toHaveBeenCalledWith(EXPIRED_MESSAGE);
    });

    it('rides out a few network errors in a row, then gives up', async () => {
      fetchMock.mockImplementationOnce(() => Promise.reject(new Error('Network request failed'))).mockReturnValueOnce(json(200, {authToken: 'acct-token'}));
      const first = run();
      await jest.advanceTimersByTimeAsync(2000 + 2000);
      expect(first.onApproved).toHaveBeenCalledWith('acct-token');

      fetchMock.mockReset();
      fetchMock.mockImplementation(() => Promise.reject(new Error('Network request failed')));
      const second = run();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(second.onStop).toHaveBeenCalledWith('Network request failed');
      expect(fetchMock).toHaveBeenCalledTimes(MAX_TRANSIENT_ERRORS + 1);
    });

    it('sends nothing after Cancel', async () => {
      fetchMock.mockImplementation(() => json(200, {authToken: 'late'}));
      const {onApproved, cancel} = run();
      cancel();
      await jest.advanceTimersByTimeAsync(10_000);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onApproved).not.toHaveBeenCalled();
    });
  });
});

describe('Plex servers', () => {
  const resources = [
    {
      name: 'Basement',
      provides: 'server',
      clientIdentifier: 'srv-1',
      owned: false,
      accessToken: 'shared-token',
      httpsRequired: false,
      connections: [
        {protocol: 'https', address: '1.2.3.4', port: 32400, uri: 'https://1-2-3-4.abc.plex.direct:32400', local: false, relay: false},
        {protocol: 'https', address: '10.0.0.5', port: 32400, uri: 'https://10-0-0-5.abc.plex.direct:32400', local: true, relay: false},
        {protocol: 'https', uri: 'https://relay.plex.direct:8443', local: false, relay: true},
        {protocol: 'http', address: '10.0.0.5', port: 32400, uri: 'http://10.0.0.5:32400/', local: true, relay: false},
      ],
    },
    {name: 'Living room TV', provides: 'player', clientIdentifier: 'tv', connections: [{uri: 'http://10.0.0.9:32500', local: true}]},
    {name: 'Home', provides: 'server,player', clientIdentifier: 'srv-2', owned: true, connections: [{protocol: 'http', uri: 'http://192.168.1.2:32400', local: 1}]},
  ];

  it('keeps servers only, owned first, each with its own token', async () => {
    const fetchMock = jest.fn(() => json(200, resources));
    (globalThis as any).fetch = fetchMock;
    const servers = await listPlexServers('acct-token', CLIENT);
    const [url, init] = (fetchMock.mock.calls[0] as unknown) as [string, {headers: Record<string, string>}];
    expect(url).toBe('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1');
    expect(init.headers['X-Plex-Token']).toBe('acct-token');
    expect(servers.map(server => [server.name, server.owned, server.accessToken])).toEqual([
      ['Home', true, 'acct-token'],
      ['Basement', false, 'shared-token'],
    ]);
    expect(servers[1].connections[3].uri).toBe('http://10.0.0.5:32400');
  });

  it('says so when plex.tv refuses the token', async () => {
    (globalThis as any).fetch = jest.fn(() => json(401, {}));
    await expect(listPlexServers('bad', CLIENT)).rejects.toThrow('plex.tv did not accept this sign-in. Try again.');
  });

  const basement = (): PlexServer => parsePlexServers(resources, 'acct-token').find(server => server.id === 'srv-1')!;

  it('orders addresses: this network, then internet, then relay; secure first', () => {
    expect(orderedConnections(basement()).map(connection => connection.uri)).toEqual([
      'https://10-0-0-5.abc.plex.direct:32400',
      'http://10.0.0.5:32400',
      'https://1-2-3-4.abc.plex.direct:32400',
      'https://relay.plex.direct:8443',
    ]);
    expect(connectionRank({uri: 'x', protocol: 'https', local: true, relay: false, ipv6: true})).toBeGreaterThan(
      connectionRank({uri: 'y', protocol: 'https', local: true, relay: false, ipv6: false}),
    );
  });

  it('drops plain http when the server requires secure connections', () => {
    const server = {...basement(), httpsRequired: true};
    expect(orderedConnections(server).some(connection => connection.protocol === 'http')).toBe(false);
  });

  it('uses the best address that answers', async () => {
    const answers: Record<string, boolean> = {
      'https://10-0-0-5.abc.plex.direct:32400': false,
      'http://10.0.0.5:32400': false,
      'https://1-2-3-4.abc.plex.direct:32400': true,
      'https://relay.plex.direct:8443': true,
    };
    const probe = jest.fn(async (uri: string, token: string) => {
      expect(token).toBe('shared-token');
      return answers[uri];
    });
    expect((await chooseConnection(basement(), probe))?.uri).toBe('https://1-2-3-4.abc.plex.direct:32400');
    // All are tried at once.
    expect(probe).toHaveBeenCalledTimes(4);

    answers['https://1-2-3-4.abc.plex.direct:32400'] = false;
    expect((await chooseConnection(basement(), probe))?.uri).toBe('https://relay.plex.direct:8443');

    expect(await chooseConnection(basement(), async () => false)).toBeUndefined();
    // A probe that throws counts as no answer.
    expect(await chooseConnection(basement(), () => Promise.reject(new Error('boom')))).toBeUndefined();
  });

  it('does not wait for worse addresses once a better one answered', async () => {
    let releaseRelay!: (value: boolean) => void;
    const probe = (uri: string) =>
      uri.includes('relay') ? new Promise<boolean>(resolve => (releaseRelay = resolve)) : Promise.resolve(uri === 'https://10-0-0-5.abc.plex.direct:32400');
    await expect(chooseConnection(basement(), probe)).resolves.toMatchObject({uri: 'https://10-0-0-5.abc.plex.direct:32400', local: true});
    releaseRelay(true);
  });

  it('checks an address with /identity and a time limit', async () => {
    const {probePlexConnection} = require('../src/lib/sources/plexLink');
    (globalThis as any).fetch = jest.fn(() => json(200, {}));
    await expect(probePlexConnection('https://a.plex.direct:32400', 'tok')).resolves.toBe(true);
    expect((globalThis as any).fetch.mock.calls[0][0]).toBe('https://a.plex.direct:32400/identity');
    (globalThis as any).fetch = jest.fn(() => json(401, {}));
    await expect(probePlexConnection('https://a.plex.direct:32400', 'tok')).resolves.toBe(false);
    (globalThis as any).fetch = jest.fn(() => Promise.reject(new Error('timeout')));
    await expect(probePlexConnection('https://a.plex.direct:32400', 'tok')).resolves.toBe(false);
  });
});
