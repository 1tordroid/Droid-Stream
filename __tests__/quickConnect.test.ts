// Jellyfin Quick Connect: checking it is on, asking for a code (POST, or
// GET on Jellyfin 10.8), polling it (pending, approved, expired, turned
// off, passing errors) and trading the approval for a token.
import {
  checkQuickConnect,
  finishQuickConnect,
  QUICK_CONNECT_LIFETIME_MS,
  QUICK_CONNECT_OFF_MESSAGE,
  quickConnectEnabled,
  startQuickConnect,
} from '../src/lib/sources/quickConnect';
import {EXPIRED_MESSAGE, MAX_TRANSIENT_ERRORS, startDevicePoll} from '../src/lib/watchSync/devicePoll';
import {DeviceCodeStopError} from '../src/lib/watchSync';

const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});

const SERVER = 'https://jf.local/';
const DEVICE = 'install-a-17';
const NOW = 1_700_000_000_000;

describe('Jellyfin Quick Connect', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => jest.useRealTimers());

  it('knows when Quick Connect is on', async () => {
    fetchMock.mockReturnValueOnce(json(200, true));
    await expect(quickConnectEnabled(SERVER, DEVICE)).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://jf.local/QuickConnect/Enabled');
    fetchMock.mockReturnValueOnce(json(200, false));
    await expect(quickConnectEnabled(SERVER, DEVICE)).resolves.toBe(false);
    fetchMock.mockReturnValueOnce(json(404, {}));
    await expect(quickConnectEnabled(SERVER, DEVICE)).resolves.toBe(false);
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    await expect(quickConnectEnabled(SERVER, DEVICE)).resolves.toBe(false);
  });

  it('asks for a code with this device id and gives it 10 minutes', async () => {
    fetchMock.mockReturnValueOnce(json(200, {Secret: 'sec-1', Code: '123456', Authenticated: false}));
    const code = await startQuickConnect(SERVER, DEVICE, NOW);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://jf.local/QuickConnect/Initiate');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toContain(`DeviceId="${DEVICE}"`);
    expect(init.headers.Authorization).not.toContain('Token=');
    expect(code).toEqual({userCode: '123456', verificationUrl: '', deviceCode: 'sec-1', intervalSeconds: 3, expiresAt: NOW + QUICK_CONNECT_LIFETIME_MS});
  });

  it('falls back to GET on Jellyfin 10.8 and says when Quick Connect is off', async () => {
    fetchMock.mockReturnValueOnce(json(405, {})).mockReturnValueOnce(json(200, {Secret: 's', Code: 654321}));
    await expect(startQuickConnect(SERVER, DEVICE)).resolves.toMatchObject({userCode: '654321', deviceCode: 's'});
    expect(fetchMock.mock.calls[1][1].method).toBeUndefined();

    fetchMock.mockReturnValueOnce(json(401, {}));
    await expect(startQuickConnect(SERVER, DEVICE)).rejects.toThrow(QUICK_CONNECT_OFF_MESSAGE);
    fetchMock.mockReturnValueOnce(json(200, {Code: '1'}));
    await expect(startQuickConnect(SERVER, DEVICE)).rejects.toThrow('Jellyfin did not give a code.');
  });

  it('reads one check: pending, approved, expired, off, passing error', async () => {
    const code = {userCode: '123456', verificationUrl: '', deviceCode: 'a b', intervalSeconds: 3, expiresAt: NOW + 600_000};
    fetchMock.mockReturnValueOnce(json(200, {Authenticated: false}));
    await expect(checkQuickConnect(SERVER, code, DEVICE)).resolves.toBe('pending');
    expect(fetchMock.mock.calls[0][0]).toBe('https://jf.local/QuickConnect/Connect?secret=a%20b');
    fetchMock.mockReturnValueOnce(json(200, {Authenticated: true}));
    await expect(checkQuickConnect(SERVER, code, DEVICE)).resolves.toBe('approved');
    fetchMock.mockReturnValueOnce(json(404, {}));
    await expect(checkQuickConnect(SERVER, code, DEVICE)).rejects.toThrow(EXPIRED_MESSAGE);
    fetchMock.mockReturnValueOnce(json(401, {}));
    const off = checkQuickConnect(SERVER, code, DEVICE);
    await expect(off).rejects.toBeInstanceOf(DeviceCodeStopError);
    await expect(off).rejects.toThrow(QUICK_CONNECT_OFF_MESSAGE);
    fetchMock.mockReturnValueOnce(json(502, {}));
    await expect(checkQuickConnect(SERVER, code, DEVICE)).rejects.not.toBeInstanceOf(DeviceCodeStopError);
  });

  it('trades the approved request for a token for this device', async () => {
    const code = {userCode: '123456', verificationUrl: '', deviceCode: 'sec-1', intervalSeconds: 3, expiresAt: NOW + 600_000};
    fetchMock.mockReturnValueOnce(json(200, {User: {Id: 'user-guid', Name: 'Ana'}, AccessToken: 'jf-token'}));
    await expect(finishQuickConnect(SERVER, code, DEVICE)).resolves.toEqual({userId: 'user-guid', token: 'jf-token', userName: 'Ana'});
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://jf.local/Users/AuthenticateWithQuickConnect');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({Secret: 'sec-1'});
    expect(init.headers.Authorization).toContain(`DeviceId="${DEVICE}"`);

    fetchMock.mockReturnValueOnce(json(400, {}));
    await expect(finishQuickConnect(SERVER, code, DEVICE)).rejects.toThrow('Jellyfin sign-in failed (400). Try again.');
    fetchMock.mockReturnValueOnce(json(200, {AccessToken: 'x'}));
    await expect(finishQuickConnect(SERVER, code, DEVICE)).rejects.toThrow('Jellyfin did not return a sign-in.');
  });

  describe('polling', () => {
    const run = () => {
      jest.useFakeTimers({now: NOW});
      const code = {userCode: '123456', verificationUrl: '', deviceCode: 'sec-1', intervalSeconds: 3, expiresAt: NOW + QUICK_CONNECT_LIFETIME_MS};
      const onApproved = jest.fn();
      const onStop = jest.fn();
      startDevicePoll(code, {poll: next => checkQuickConnect(SERVER, next, DEVICE), onApproved, onStop});
      return {onApproved, onStop};
    };

    it('polls every 3 seconds until approved', async () => {
      fetchMock.mockReturnValueOnce(json(200, {Authenticated: false})).mockReturnValueOnce(json(200, {Authenticated: true}));
      const {onApproved, onStop} = run();
      await jest.advanceTimersByTimeAsync(3000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onApproved).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(3000);
      expect(onApproved).toHaveBeenCalledTimes(1);
      expect(onStop).not.toHaveBeenCalled();
    });

    it('stops after 10 minutes without approval', async () => {
      fetchMock.mockImplementation(() => json(200, {Authenticated: false}));
      const {onApproved, onStop} = run();
      await jest.advanceTimersByTimeAsync(QUICK_CONNECT_LIFETIME_MS + 3000);
      expect(onStop).toHaveBeenCalledWith(EXPIRED_MESSAGE);
      expect(onApproved).not.toHaveBeenCalled();
    });

    it('stops when the server forgets the request or Quick Connect is turned off', async () => {
      fetchMock.mockReturnValueOnce(json(404, {}));
      const first = run();
      await jest.advanceTimersByTimeAsync(3000);
      expect(first.onStop).toHaveBeenCalledWith(EXPIRED_MESSAGE);

      fetchMock.mockReturnValueOnce(json(401, {}));
      const second = run();
      await jest.advanceTimersByTimeAsync(3000);
      expect(second.onStop).toHaveBeenCalledWith(QUICK_CONNECT_OFF_MESSAGE);
    });

    it('gives up after several server errors in a row', async () => {
      fetchMock.mockImplementation(() => json(500, {}));
      const {onStop} = run();
      await jest.advanceTimersByTimeAsync(120_000);
      expect(onStop).toHaveBeenCalledWith('Jellyfin did not answer (500).');
      expect(fetchMock).toHaveBeenCalledTimes(MAX_TRANSIENT_ERRORS + 1);
    });
  });
});
