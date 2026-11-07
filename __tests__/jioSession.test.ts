// Sign in with Jio: SMS code sign-in, a renewing session with one renewal in
// flight, a single retry after a refused token, sign-out, and no secrets in logs.
const NUMBER = '9876543210';
const OTP = '482913';

const b64url = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (expSeconds: number, tag: string) => `${b64url({alg: 'HS256'})}.${b64url({exp: expSeconds, tag})}.sig${tag}`;

const res = (status: number, body?: unknown) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: {get: () => null},
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  });

const secrets = new Set<string>();
const logSpies: jest.SpyInstance[] = [];

describe('Jio session', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
    secrets.clear();
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      logSpies.push(jest.spyOn(console, method).mockImplementation(() => {}));
    }
  });

  afterEach(() => {
    // Nothing printed may carry the number, the code or a token.
    for (const spy of logSpies.splice(0)) {
      const printed = JSON.stringify(spy.mock.calls);
      for (const secret of secrets) expect(printed).not.toContain(secret);
      spy.mockRestore();
    }
  });

  const load = () => require('../src/lib/livetv/jio/session') as typeof import('../src/lib/livetv/jio/session');

  const signIn = async (session: ReturnType<typeof load>, access = jwt(Math.floor(Date.now() / 1000) + 7200, 'a1'), sso = jwt(Math.floor(Date.now() / 1000) + 86400, 's1')) => {
    secrets.add(access).add(sso).add('r1').add(NUMBER).add(OTP);
    fetchMock.mockImplementationOnce(() =>
      res(200, {authToken: access, refreshToken: 'r1', ssoToken: sso, sessionAttributes: {user: {subscriberId: 'crm-1', unique: 'uniq-1'}}}),
    );
    return session.verifyOtp(NUMBER, OTP);
  };

  it('sends the code to the base64 +91 number', async () => {
    const session = load();
    fetchMock.mockImplementationOnce(() => res(204));
    await session.sendOtp('+91 98765 43210');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://jiotvapi.media.jio.com/userservice/apis/v1/loginotp/send');
    expect(JSON.parse(init.body)).toEqual({number: Buffer.from('+919876543210').toString('base64')});
    expect(init.headers).toMatchObject({appname: 'RJIL_JioTV', os: 'android', devicetype: 'phone'});
  });

  it('explains a bad number, a non-Jio number and rate limiting', async () => {
    const session = load();
    await expect(session.sendOtp('12345')).rejects.toThrow(/10-digit Jio mobile number/);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockImplementationOnce(() => res(400, {message: 'Invalid subscriber'}));
    await expect(session.sendOtp(NUMBER)).rejects.toThrow(/only with a Jio mobile number/);
    fetchMock.mockImplementationOnce(() => res(429, {}));
    await expect(session.sendOtp(NUMBER)).rejects.toThrow(/Too many attempts/);
    fetchMock.mockImplementationOnce(() => res(400, {message: 'OTP request limit exceeded'}));
    await expect(session.sendOtp(NUMBER)).rejects.toThrow(/Too many attempts/);
  });

  it('rejects a wrong code without saving anything', async () => {
    const session = load();
    fetchMock.mockImplementationOnce(() => res(400, {message: 'Invalid OTP'}));
    await expect(session.verifyOtp(NUMBER, '000000')).rejects.toThrow(/code is wrong or has expired/);
    fetchMock.mockImplementationOnce(() => res(200, {status: 'failed'}));
    await expect(session.verifyOtp(NUMBER, '000000')).rejects.toThrow(/code is wrong/);
    expect(session.isJioSignedIn()).toBe(false);
  });

  it('saves the session jiotv_go keeps, with a persistent device id', async () => {
    const session = load();
    const saved = await signIn(session);
    expect(saved).toMatchObject({number: '+919876543210', refreshToken: 'r1', crm: 'crm-1', uniqueId: 'uniq-1'});
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({otp: OTP, deviceInfo: {consumptionDeviceName: 'SM-G930F', info: {type: 'android'}}});
    expect(body.deviceInfo.info.androidId).toMatch(/^[0-9a-f]{16}$/);
    expect(session.jioDeviceId()).toBe(body.deviceInfo.info.androidId);
    expect(session.jioSignedInNumber()).toBe('+919876543210');
  });

  it('renews an access token that is about to expire, once for parallel callers', async () => {
    const session = load();
    await signIn(session, jwt(Math.floor(Date.now() / 1000) + 10, 'old'));
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const fresh = jwt(Math.floor(Date.now() / 1000) + 7200, 'new');
    secrets.add(fresh);
    fetchMock.mockImplementation(async () => {
      await gate;
      return res(200, {authToken: fresh});
    });
    const both = Promise.all([session.getJioSession(), session.getJioSession()]);
    release();
    const [first, second] = await both;
    expect(first.accessToken).toBe(fresh);
    expect(second.accessToken).toBe(fresh);
    const renewals = fetchMock.mock.calls.filter(([url]) => String(url).includes('refreshtoken'));
    expect(renewals).toHaveLength(1);
    expect(JSON.parse(renewals[0][1].body)).toMatchObject({appName: 'RJIL_JioTV', refreshToken: 'r1'});
    expect(session.readJioSession()?.accessToken).toBe(fresh);
    // A fresh token is used as is.
    fetchMock.mockClear();
    await session.getJioSession();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renews both tokens and retries once after JioTV refuses a token', async () => {
    const session = load();
    await signIn(session);
    const {JioHttpError} = require('../src/lib/livetv/jio/api');
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('refreshtoken') ? res(200, {authToken: 'a2'}) : res(200, {ssoToken: 's2'}),
    );
    secrets.add('a2').add('s2');
    const seen: string[] = [];
    const result = await session.withJioSession(async creds => {
      seen.push(creds.accessToken);
      if (seen.length === 1) throw new JioHttpError(401);
      return creds.ssoToken;
    });
    expect(result).toBe('s2');
    expect(seen[1]).toBe('a2');
    expect(fetchMock.mock.calls.slice(1).map(([url]) => String(url).replace(/\?.*/, ''))).toEqual([
      'https://auth.media.jio.com/tokenservice/apis/v1/refreshtoken',
      'https://tv.media.jio.com/apis/v2.0/loginotp/refresh',
    ]);
    // A second refusal is not retried again.
    await expect(session.withJioSession(async () => { throw new JioHttpError(401); })).rejects.toMatchObject({status: 401});
  });

  it('signs out when JioTV rejects the renewal, but keeps the sign-in through a network error', async () => {
    const session = load();
    await signIn(session, jwt(Math.floor(Date.now() / 1000) - 5, 'expired'));
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    await expect(session.getJioSession()).rejects.toThrow(/Could not reach JioTV/);
    expect(session.isJioSignedIn()).toBe(true);
    fetchMock.mockImplementationOnce(() => res(401, {message: 'invalid refresh token'}));
    await expect(session.getJioSession()).rejects.toMatchObject({name: 'JioAuthError'});
    expect(session.isJioSignedIn()).toBe(false);
  });

  it('signs out locally and tells JioTV', async () => {
    const session = load();
    await signIn(session);
    fetchMock.mockImplementationOnce(() => res(200, {}));
    await session.signOutJio();
    expect(session.isJioSignedIn()).toBe(false);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain('/tokenservice/apis/v1/logout');
    expect(JSON.parse(init.body)).toMatchObject({refreshToken: 'r1'});
    await expect(session.getJioSession()).rejects.toMatchObject({name: 'JioAuthError'});
  });

  it('keeps the session in the encrypted store that sign-out wipes', () => {
    const {SECURE_STORE_IDS} = require('../src/lib/storage/secureStores');
    const {ENCRYPTED_INSTANCE_IDS} = require('../plugins/with-backup-rules');
    expect(load().JIO_STORE_ID).toBe('droid-stream-jiotv');
    expect(SECURE_STORE_IDS).toContain('droid-stream-jiotv');
    expect(ENCRYPTED_INSTANCE_IDS).toContain('droid-stream-jiotv');
  });
});
