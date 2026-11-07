/**
 * "Sign in with Jio": SMS code sign-in and a self-renewing session, adapted
 * from jiotv_go's login and token refresh (CC BY 4.0, jiotv-go project).
 *
 * The access token lasts about two hours and the SSO token about a day. Both
 * renew shortly before they expire and once more after JioTV rejects one, with
 * a single renewal in flight so a refresh token is never spent twice (the
 * pattern of src/lib/pikpak/session.ts). A rejected renewal ends the sign-in.
 *
 * The session lives in its own encrypted store, listed in SECURE_STORE_IDS and
 * the backup exclusions, so "clear sign-ins" erases it and Auto Backup skips it.
 * Nothing here logs the number, the code or a token.
 */
import {MMKVLoader} from 'react-native-mmkv-storage';
import {
  APP_NAME,
  JioAuthError,
  JioHttpError,
  URLS,
  UA_OKHTTP,
  VERSION_CODE,
  base64Ascii,
  jwtExpiry,
  readMessage,
  type JioCredentials,
} from './api';

export const JIO_STORE_ID = 'droid-stream-jiotv';

type Store = ReturnType<MMKVLoader['initialize']>;
let store: Store | undefined;
const storage = (): Store => {
  if (!store) {
    store = new MMKVLoader()
      .withInstanceID('droid-stream-jiotv')
      .withEncryption().recoverOnKeyLoss()
      .initialize();
  }
  return store;
};

const KEYS = {session: 'session', deviceId: 'device-id', channels: 'channels'};

/** Renew this long before a JWT says it expires (jiotv_go: 30 s). */
const JWT_LEAD_MS = 30 * 1000;
/** Tokens that are not JWTs: assume these lifetimes, renewing a little early. */
const ACCESS_TTL_MS = 2 * 60 * 60 * 1000 - 10 * 60 * 1000;
const SSO_TTL_MS = 24 * 60 * 60 * 1000 - 60 * 60 * 1000;

const SIGN_IN_AGAIN = 'Your Jio sign-in has ended. Sign in again with your Jio number.';

// ---- Stored data ----

export const readJioSession = (): JioCredentials | undefined => {
  try {
    const raw = storage().getString(KEYS.session);
    const value = raw ? (JSON.parse(raw) as JioCredentials) : undefined;
    return value?.accessToken && value.ssoToken ? value : undefined;
  } catch {
    return undefined;
  }
};

const writeSession = (value: JioCredentials) => storage().setString(KEYS.session, JSON.stringify(value));

const clearSession = () => {
  storage().removeItem(KEYS.session);
  storage().removeItem(KEYS.channels);
};

/** 16 hex characters, kept across sign-ins like jiotv_go's deviceId. */
export const jioDeviceId = (): string => {
  let id = storage().getString(KEYS.deviceId);
  if (!id) {
    id = Array.from({length: 16}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    storage().setString(KEYS.deviceId, id);
  }
  return id;
};

/** For the channel cache in channels.ts: same encrypted store, cleared with the session. */
export const jioCache = {
  read: (): string | undefined => storage().getString(KEYS.channels) || undefined,
  write: (value: string) => storage().setString(KEYS.channels, value),
};

export const isJioSignedIn = (): boolean => Boolean(readJioSession());
/** The signed-in number (+91...), for the "Signed in as" line. */
export const jioSignedInNumber = (): string | undefined => readJioSession()?.number;

// ---- Phone number ----

/** "98765 43210", "+91 98765-43210" or "098765..." -> "+919876543210"; undefined when it is no Indian mobile number. */
export const normalizeJioNumber = (input: string): string | undefined => {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : undefined;
};

const NOT_A_NUMBER = 'Enter your 10-digit Jio mobile number.';
const NOT_JIO = 'This number could not get a JioTV code. Sign-in works only with a Jio mobile number.';
const RATE_LIMITED = 'Too many attempts. Wait a few minutes, then try again.';
const WRONG_OTP = 'That code is wrong or has expired. Check the SMS, or send a new code.';
const OFFLINE = 'Could not reach JioTV. Check your connection and try again.';

const authHeaders = {appname: APP_NAME, os: 'android', devicetype: 'phone', 'Content-Type': 'application/json', 'User-Agent': UA_OKHTTP};

const post = async (url: string, body: unknown, headers: Record<string, string>): Promise<Response> => {
  try {
    return await fetch(url, {method: 'POST', headers, body: JSON.stringify(body)});
  } catch {
    throw new Error(OFFLINE);
  }
};

const isRateLimit = (status: number, message: string) => status === 429 || /too many|limit|exceeded|attempts/i.test(message);

// ---- Sign-in ----

/** Asks Jio to text a sign-in code to the number. */
export const sendOtp = async (input: string): Promise<void> => {
  const number = normalizeJioNumber(input);
  if (!number) throw new Error(NOT_A_NUMBER);
  const response = await post(URLS.sendOtp, {number: base64Ascii(number)}, authHeaders);
  if (response.status === 204 || response.ok) return;
  const message = await readMessage(response);
  if (isRateLimit(response.status, message)) throw new JioHttpError(response.status, message, RATE_LIMITED);
  if (response.status >= 500) throw new JioHttpError(response.status, message, 'JioTV could not send a code right now. Try again in a little while.');
  throw new JioHttpError(response.status, message, NOT_JIO);
};

interface LoginAnswer {
  authToken?: string;
  refreshToken?: string;
  ssoToken?: string;
  sessionAttributes?: {user?: {subscriberId?: string; unique?: string}};
}

/** Checks the texted code and saves the session. */
export const verifyOtp = async (input: string, otp: string): Promise<JioCredentials> => {
  const number = normalizeJioNumber(input);
  if (!number) throw new Error(NOT_A_NUMBER);
  const code = otp.replace(/\D/g, '');
  if (code.length < 4) throw new Error('Enter the code from the SMS.');
  const response = await post(
    URLS.verifyOtp,
    {
      number: base64Ascii(number),
      otp: code,
      deviceInfo: {
        consumptionDeviceName: 'SM-G930F',
        info: {type: 'android', platform: {name: 'SM-G930F'}, androidId: jioDeviceId()},
      },
    },
    authHeaders,
  );
  if (!response.ok) {
    const message = await readMessage(response);
    if (isRateLimit(response.status, message)) throw new JioHttpError(response.status, message, RATE_LIMITED);
    if (response.status >= 500) throw new JioHttpError(response.status, message, 'JioTV could not check the code right now. Try again in a little while.');
    throw new JioHttpError(response.status, message, WRONG_OTP);
  }
  let answer: LoginAnswer;
  try {
    answer = (await response.json()) as LoginAnswer;
  } catch {
    throw new Error(WRONG_OTP);
  }
  if (!answer?.authToken || !answer.ssoToken) throw new Error(WRONG_OTP);
  const now = Date.now();
  const session: JioCredentials = {
    number,
    accessToken: answer.authToken,
    refreshToken: answer.refreshToken || '',
    ssoToken: answer.ssoToken,
    crm: answer.sessionAttributes?.user?.subscriberId || '',
    uniqueId: answer.sessionAttributes?.user?.unique || '',
    accessRefreshedAt: now,
    ssoRefreshedAt: now,
  };
  writeSession(session);
  return session;
};

// ---- Renewal ----

const expiresAt = (token: string, refreshedAt: number, ttl: number): number => {
  const exp = jwtExpiry(token);
  return exp !== undefined ? exp - JWT_LEAD_MS : refreshedAt + ttl;
};
export const accessExpiring = (s: JioCredentials, now = Date.now()) => expiresAt(s.accessToken, s.accessRefreshedAt, ACCESS_TTL_MS) <= now;
export const ssoExpiring = (s: JioCredentials, now = Date.now()) => expiresAt(s.ssoToken, s.ssoRefreshedAt, SSO_TTL_MS) <= now;

/** JioTV refused the refresh itself (not a network or server hiccup). */
const rejected = (status: number) => status === 400 || status === 401 || status === 403 || status === 419;

const renewAccess = async (s: JioCredentials): Promise<string> => {
  if (!s.refreshToken) throw new JioAuthError(SIGN_IN_AGAIN);
  const response = await post(
    URLS.refreshAccess,
    {appName: APP_NAME, deviceId: jioDeviceId(), refreshToken: s.refreshToken},
    {devicetype: 'phone', versionCode: VERSION_CODE, os: 'android', 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': UA_OKHTTP, accessToken: s.accessToken},
  );
  if (!response.ok) {
    if (rejected(response.status)) throw new JioAuthError(SIGN_IN_AGAIN);
    throw new JioHttpError(response.status, '', 'JioTV could not renew your sign-in right now. Try again in a little while.');
  }
  const body = (await response.json().catch(() => ({}))) as {authToken?: string};
  if (!body?.authToken) throw new JioAuthError(SIGN_IN_AGAIN);
  return body.authToken;
};

const renewSso = async (s: JioCredentials): Promise<string> => {
  let response: Response;
  try {
    response = await fetch(URLS.refreshSso, {
      method: 'GET',
      headers: {devicetype: 'phone', versionCode: VERSION_CODE, os: 'android', 'User-Agent': UA_OKHTTP, ssoToken: s.ssoToken, uniqueid: s.uniqueId, deviceid: jioDeviceId()},
    });
  } catch {
    throw new Error(OFFLINE);
  }
  if (!response.ok) {
    if (rejected(response.status)) throw new JioAuthError(SIGN_IN_AGAIN);
    throw new JioHttpError(response.status, '', 'JioTV could not renew your sign-in right now. Try again in a little while.');
  }
  const body = (await response.json().catch(() => ({}))) as {ssoToken?: string};
  if (!body?.ssoToken) throw new JioAuthError(SIGN_IN_AGAIN);
  return body.ssoToken;
};

let renewing: Promise<JioCredentials> | undefined;

/** One renewal at a time. `force` renews both tokens (after a rejection). */
const renew = (force: boolean): Promise<JioCredentials> => {
  if (!renewing) {
    renewing = (async () => {
      const current = readJioSession();
      if (!current) throw new JioAuthError();
      try {
        const next = {...current};
        const now = Date.now();
        if (force || accessExpiring(current, now)) {
          next.accessToken = await renewAccess(current);
          next.accessRefreshedAt = Date.now();
        }
        if (current.uniqueId && (force || ssoExpiring(current, now))) {
          next.ssoToken = await renewSso(current);
          next.ssoRefreshedAt = Date.now();
        }
        // Signed out meanwhile: do not bring the session back.
        if (readJioSession()) writeSession(next);
        return next;
      } catch (error) {
        if (error instanceof JioAuthError) clearSession();
        throw error;
      }
    })().finally(() => {
      renewing = undefined;
    });
  }
  return renewing;
};

/** The current session, renewed first when a token is about to expire (or when forced). */
export const getJioSession = async ({force = false}: {force?: boolean} = {}): Promise<JioCredentials> => {
  const session = readJioSession();
  if (!session) throw new JioAuthError();
  if (force || accessExpiring(session) || (session.uniqueId && ssoExpiring(session))) return renew(force);
  return session;
};

/** JioTV's answer to an expired or refused token. */
export const isJioTokenRejection = (error: unknown): boolean =>
  error instanceof JioHttpError && (error.status === 401 || error.status === 419);

/** Runs a JioTV request with a live session, renewing and retrying once when a token is refused. */
export const withJioSession = async <T>(request: (session: JioCredentials) => Promise<T>): Promise<T> => {
  try {
    return await request(await getJioSession());
  } catch (error) {
    if (!isJioTokenRejection(error)) throw error;
    return request(await getJioSession({force: true}));
  }
};

// ---- Sign-out ----

/** Ends the sign-in on this phone, and tells JioTV when it can (best effort). */
export const signOutJio = async (): Promise<void> => {
  const session = readJioSession();
  clearSession();
  if (!session?.refreshToken) return;
  try {
    await fetch(URLS.logout, {
      method: 'POST',
      headers: {
        'Accept-Encoding': 'gzip',
        devicetype: 'phone',
        versioncode: VERSION_CODE,
        os: 'android',
        'Content-Type': 'application/json; charset=utf-8',
        accessToken: session.accessToken,
        uniqueid: session.uniqueId,
      },
      body: JSON.stringify({appName: APP_NAME, deviceId: jioDeviceId(), refreshToken: session.refreshToken}),
    });
  } catch {
    // Signed out locally either way.
  }
};
