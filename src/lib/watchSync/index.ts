/**
 * Marks finished movies and episodes as watched on Trakt, Simkl, and AniList.
 * Each person connects their own account, through the app keys built into the
 * build or their own app. Tokens stay in encrypted storage.
 */
import {Buffer} from 'buffer';
import {MMKVLoader} from 'react-native-mmkv-storage';
import type {WatchMeta} from '../watchMeta';
import {builtInSimklApp, builtInTraktApp, type AppKeys} from './appKeys';
import {scopedStringStore} from '../profiles/scope';

const baseStorage = new MMKVLoader().withInstanceID('droid-stream-watch-sync').withEncryption().recoverOnKeyLoss().initialize();

/**
 * The encrypted watch-sync store, shared with the scrobble queue (keys under
 * "scrobble:"). Each profile has its own sign-ins: its keys sit under the
 * profile in the one store (scopedStringStore), so no new encrypted instance
 * and backup rule is needed.
 */
const storage = scopedStringStore(baseStorage);
export const watchSyncStorage = storage;
/** The whole store, every profile included. For deleting a profile's sign-ins. */
export const watchSyncBaseStorage = baseStorage;

export type SyncServiceId = 'trakt' | 'simkl' | 'anilist';

export interface SyncAccount {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  /** When the access token stops working (ms since epoch), when the service says. */
  expiresAt?: number;
  /** When the current Trakt access token was issued (ms since epoch). */
  issuedAt?: number;
  /** Simkl sign-in generation. 'v1' is the PIN flow, which cannot be renewed. */
  tokenType?: 'v1' | 'v2';
  username?: string;
  enabled: boolean;
  /** Why the service ended the sign-in. Shown on the card until the next sign-in. */
  signedOutReason?: string;
  /** The last failure that did not end the sign-in, for example a rejected Client ID. */
  lastSyncError?: string;
  /** Sign in with the Client ID typed here even when the build has app keys built in. */
  useOwnApp?: boolean;
  /** Which app issued the saved tokens. Renewal must use the same one. Unset means the user's own. */
  authApp?: 'builtin' | 'own';
  /** Trakt only: report what is playing (scrobble). On unless turned off. */
  scrobble?: boolean;
}

export type SyncSettings = Record<SyncServiceId, SyncAccount>;

export const SERVICE_NAMES: Record<SyncServiceId, string> = {trakt: 'Trakt', simkl: 'Simkl', anilist: 'AniList'};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const defaults = (): SyncSettings => ({trakt: {enabled: true}, simkl: {enabled: true}, anilist: {enabled: true}});

/**
 * When an AniList token stops working (ms since epoch), read from the `exp`
 * claim of its JWT payload. Undefined for anything that is not a JWT. The
 * token itself is never logged.
 */
export const anilistTokenExpiry = (token?: string): number | undefined => {
  const parts = token?.split('.') || [];
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const exp = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))?.exp;
    return typeof exp === 'number' && exp > 0 ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
};

/** Fills in what saves from before 5.5.0 lack. Never drops a working token. */
const migrate = (settings: SyncSettings): SyncSettings => {
  const {simkl, anilist} = settings;
  if (simkl.accessToken && !simkl.tokenType) simkl.tokenType = 'v1';
  if (anilist.accessToken && anilist.expiresAt === undefined) anilist.expiresAt = anilistTokenExpiry(anilist.accessToken);
  return settings;
};

export const readSyncSettings = (): SyncSettings => {
  try {
    const saved = JSON.parse(storage.getString('settings') || '{}');
    const base = defaults();
    return migrate({trakt: {...base.trakt, ...saved.trakt}, simkl: {...base.simkl, ...saved.simkl}, anilist: {...base.anilist, ...saved.anilist}});
  } catch {
    return defaults();
  }
};

export const writeSyncSettings = (settings: SyncSettings): void => {
  storage.setString('settings', JSON.stringify(settings));
};

export const updateAccount = (id: SyncServiceId, patch: Partial<SyncAccount>): SyncSettings => {
  const settings = readSyncSettings();
  const next = {...settings, [id]: {...settings[id], ...patch}};
  writeSyncSettings(next);
  return next;
};

/** The app keys this build carries for a service, if any. */
export const builtInApp = (id: SyncServiceId): AppKeys | undefined =>
  id === 'trakt' ? builtInTraktApp() : id === 'simkl' ? builtInSimklApp() : undefined;

/**
 * Whether requests for this account go through the built-in app. A saved
 * sign-in keeps the app that issued it; otherwise the built-in app is used
 * unless the user chose their own.
 */
export const usesBuiltInApp = (id: SyncServiceId, account: SyncAccount): boolean => {
  if (!builtInApp(id)) return false;
  if (account.accessToken || account.refreshToken) return account.authApp === 'builtin';
  return !account.useOwnApp;
};

/** The Client ID (and Trakt secret) to send for this account. */
export const appKeysFor = (id: SyncServiceId, account: SyncAccount): AppKeys =>
  (usesBuiltInApp(id, account) && builtInApp(id)) || {clientId: account.clientId || '', clientSecret: account.clientSecret};

/** A service answered with an HTTP error. Keeps the status and body so an ended sign-in can be told apart from other failures. */
export class WatchSyncHttpError extends Error {
  constructor(message: string, readonly status: number, readonly body: any, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'WatchSyncHttpError';
  }
}

/** The device code can no longer be approved (expired, denied, used or unknown). Polling stops. */
export class DeviceCodeStopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceCodeStopError';
  }
}

const retryAfter = (response: Response): number | undefined => {
  const value = Number(response.headers?.get?.('Retry-After'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

/** The service ended the sign-in. Its tokens are cleared and the reason is saved on the account. */
export class WatchSyncSignedOutError extends Error {
  constructor(readonly service: SyncServiceId, message: string) {
    super(message);
    this.name = 'WatchSyncSignedOutError';
  }
}

/** A renewal runs one at a time, so a request that never answers must not hold every later sync. */
const REQUEST_TIMEOUT_MS = 20000;

const request = async (url: string, init: RequestInit = {}): Promise<any> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers as any)},
    });
    const text = await response.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {raw: text};
    }
    if (!response.ok) {
      const message = data?.error_description || data?.error || data?.message || data?.errors?.[0]?.message;
      throw new WatchSyncHttpError(typeof message === 'string' ? message : `HTTP ${response.status}`, response.status, data, retryAfter(response));
    }
    return data;
  } catch (error: any) {
    // A timeout is a passing failure: the sign-in is kept and tried again later.
    if (error?.name === 'AbortError') throw new Error('The service did not answer in time');
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const TRAKT_ENDED = 'Trakt ended your session. Sign in again to keep syncing.';
const TRAKT_RESIGN_IN = 'Sign in to Trakt again so Droid Stream can keep you signed in.';
const TRAKT_BAD_APP = 'Trakt rejected the app Client ID. Check the Client ID and Secret, then sign in again.';
const SIMKL_ENDED = 'Simkl ended your session. Sign in again.';
const ANILIST_ENDED = 'Your AniList sign-in expired. Sign in again.';
const ANILIST_REJECTED = 'AniList did not accept this token. Tap Sign in, then copy the new token AniList shows.';
const ENDED: Record<SyncServiceId, string> = {trakt: TRAKT_ENDED, simkl: SIMKL_ENDED, anilist: ANILIST_ENDED};

/** The one-time notice shown when a sync finds that a service signed the user out. */
export const signedOutNotice = (id: SyncServiceId): string => `${SERVICE_NAMES[id]} signed you out. Reconnect in Settings > Watch sync.`;

/**
 * Ends a sign-in the service rejected: clears the tokens and keeps the app
 * details, the username and the sync switch, so signing in again is one tap.
 * Returns the error for the caller to throw.
 */
export const signOutService = (id: SyncServiceId, reason: string): WatchSyncSignedOutError => {
  updateAccount(id, {accessToken: '', refreshToken: '', expiresAt: undefined, issuedAt: undefined, signedOutReason: reason, lastSyncError: undefined});
  return new WatchSyncSignedOutError(id, reason);
};

/**
 * Ends the sign-in only while the rejected token is still the saved one. A
 * sign-in made while the request ran is left alone, and the sync is simply
 * tried again later.
 */
const signOutIfCurrent = (id: SyncServiceId, rejectedToken: string | undefined, reason: string): Error =>
  readSyncSettings()[id].accessToken === rejectedToken ? signOutService(id, reason) : new Error(`The ${SERVICE_NAMES[id]} sign-in changed during the sync`);

/** Signs out on this phone. Trakt is also asked to revoke the token, best effort. */
export const disconnectService = (id: SyncServiceId): SyncSettings => {
  const account = readSyncSettings()[id];
  const keys = appKeysFor(id, account);
  const next = updateAccount(id, {
    accessToken: '',
    refreshToken: '',
    expiresAt: undefined,
    issuedAt: undefined,
    tokenType: undefined,
    authApp: undefined,
    username: '',
    signedOutReason: undefined,
    lastSyncError: undefined,
  });
  if (id === 'trakt' && account.accessToken && keys.clientId) {
    request(`${TRAKT}/oauth/revoke`, {
      method: 'POST',
      body: JSON.stringify({token: account.accessToken, client_id: keys.clientId, client_secret: keys.clientSecret}),
    }).catch(() => undefined);
  }
  return next;
};

/** One renewal per service at a time: a rotated refresh token must never be spent twice. */
const renewing = new Map<SyncServiceId, Promise<SyncAccount>>();
const singleFlight = (id: SyncServiceId, run: () => Promise<SyncAccount>): Promise<SyncAccount> => {
  let pending = renewing.get(id);
  if (!pending) {
    pending = run().finally(() => renewing.delete(id));
    renewing.set(id, pending);
  }
  return pending;
};

const anilistErrorText = (body: any): string =>
  [body?.message, ...(Array.isArray(body?.errors) ? body.errors.map((item: any) => item?.message) : [])].filter(Boolean).join(' ');

/** True when the service says the token itself is no longer accepted. */
const isAuthRejection = (id: SyncServiceId, error: unknown): boolean => {
  if (!(error instanceof WatchSyncHttpError)) return false;
  // Simkl answers user_token_required when no user token reached it, which is not an ended sign-in.
  if (id === 'simkl') return error.status === 401 && error.body?.error !== 'user_token_required';
  if (id === 'anilist') return error.status === 401 || (error.status === 400 && /invalid token/i.test(anilistErrorText(error.body)));
  return error.status === 401;
};

// ---------------------------------------------------------------- Trakt
const TRAKT = 'https://api.trakt.tv';
const traktHeaders = (account: SyncAccount) => ({
  'trakt-api-version': '2',
  'trakt-api-key': appKeysFor('trakt', account).clientId,
  ...(account.accessToken ? {Authorization: `Bearer ${account.accessToken}`} : {}),
});

export interface DeviceCode {
  userCode: string;
  verificationUrl: string;
  deviceCode: string;
  intervalSeconds: number;
  expiresAt: number;
  /** The app the code was issued to. The poll must use the same one. */
  app?: AppKeys & {builtIn: boolean};
}

/** The app a new sign-in uses right now: built in unless the user chose their own. */
export const signInApp = (id: 'trakt' | 'simkl'): AppKeys & {builtIn: boolean} => {
  const account = readSyncSettings()[id];
  const builtIn = !account.useOwnApp ? builtInApp(id) : undefined;
  return builtIn ? {...builtIn, builtIn: true} : {clientId: account.clientId || '', clientSecret: account.clientSecret, builtIn: false};
};

export const traktStartDevice = async (clientId: string, app?: AppKeys & {builtIn: boolean}): Promise<DeviceCode> => {
  const data = await request(`${TRAKT}/oauth/device/code`, {method: 'POST', body: JSON.stringify({client_id: clientId})});
  return {
    userCode: data.user_code,
    verificationUrl: data.verification_url,
    deviceCode: data.device_code,
    intervalSeconds: data.interval || 5,
    expiresAt: Date.now() + data.expires_in * 1000,
    ...(app ? {app} : {}),
  };
};

/** 'approved' once the user approved the code, 'pending' while waiting, 'slow' when the service asks to poll less often. */
export type PollResult = 'approved' | 'pending' | 'slow';

/** Trakt access tokens last 24 hours since March 2025. Older saves have no issue time, so assume that. */
const TRAKT_ASSUMED_LIFETIME_MS = DAY_MS;
const TRAKT_MIN_MARGIN_MS = 15 * 60 * 1000;

const TRAKT_POLL_STOPS: Record<number, string> = {
  404: 'Trakt did not recognise this code. Tap Sign in to get a new one.',
  409: 'This code was already used. Tap Sign in to get a new one.',
  410: 'The code expired. Tap Sign in to get a new one.',
  418: 'Sign-in was denied on Trakt. Tap Sign in to try again.',
};

/** Token fields from a Trakt token response. Lifetimes always come from expires_in. */
const traktTokens = (data: any, previousRefreshToken?: string): Partial<SyncAccount> => {
  const issuedAt = typeof data?.created_at === 'number' ? data.created_at * 1000 : Date.now();
  const lifetime = typeof data?.expires_in === 'number' ? data.expires_in * 1000 : TRAKT_ASSUMED_LIFETIME_MS;
  // The refresh token may rotate: always keep the newest one.
  return {accessToken: data.access_token, refreshToken: data.refresh_token || previousRefreshToken, issuedAt, expiresAt: issuedAt + lifetime};
};

export const traktPollDevice = async (code: DeviceCode): Promise<PollResult> => {
  const account = readSyncSettings().trakt;
  const app = code.app || {clientId: account.clientId || '', clientSecret: account.clientSecret, builtIn: false};
  let data: any;
  try {
    data = await request(`${TRAKT}/oauth/device/token`, {
      method: 'POST',
      body: JSON.stringify({code: code.deviceCode, client_id: app.clientId, client_secret: app.clientSecret}),
    });
  } catch (error) {
    if (error instanceof WatchSyncHttpError) {
      if (error.status === 400) return 'pending';
      if (error.status === 429) return 'slow';
      const stop = TRAKT_POLL_STOPS[error.status];
      if (stop) throw new DeviceCodeStopError(stop);
    }
    throw error;
  }
  const authApp = app.builtIn ? 'builtin' : 'own';
  const me = await request(`${TRAKT}/users/me`, {headers: traktHeaders({...account, accessToken: data.access_token, authApp})}).catch(() => ({}));
  updateAccount('trakt', {...traktTokens(data), authApp, username: me.username, signedOutReason: undefined, lastSyncError: undefined});
  return 'approved';
};

/** Renew when less than 20% of the token's life (and at least 15 minutes) is left. */
const traktRefreshDue = (account: SyncAccount, now = Date.now()): boolean => {
  if (!account.expiresAt) return false;
  const issuedAt = account.issuedAt ?? account.expiresAt - TRAKT_ASSUMED_LIFETIME_MS;
  return account.expiresAt - now < Math.max(TRAKT_MIN_MARGIN_MS, 0.2 * (account.expiresAt - issuedAt));
};

/** On the token endpoint, 401 (or 400 invalid_grant) means the refresh token is no longer valid. */
const isRejectedGrant = (error: WatchSyncHttpError): boolean =>
  error.status === 401 || (error.status === 400 && /invalid_grant|unauthorized/i.test(String(error.body?.error || '')));

const renewTrakt = (): Promise<SyncAccount> =>
  singleFlight('trakt', async () => {
    const account = readSyncSettings().trakt;
    if (!account.refreshToken) throw signOutService('trakt', TRAKT_RESIGN_IN);
    const keys = appKeysFor('trakt', account);
    // A disconnect or a new sign-in while the request ran wins over its result.
    const replaced = () => readSyncSettings().trakt.refreshToken !== account.refreshToken;
    let data: any;
    try {
      data = await request(`${TRAKT}/oauth/token`, {
        method: 'POST',
        body: JSON.stringify({refresh_token: account.refreshToken, client_id: keys.clientId, client_secret: keys.clientSecret, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', grant_type: 'refresh_token'}),
      });
    } catch (error) {
      if (error instanceof WatchSyncHttpError && !replaced()) {
        if (isRejectedGrant(error)) throw signOutService('trakt', TRAKT_ENDED);
        if (error.status === 403) updateAccount('trakt', {lastSyncError: TRAKT_BAD_APP});
      }
      // Network errors, 5xx and 429 keep the tokens; the next trigger tries again.
      throw error;
    }
    if (replaced()) return readSyncSettings().trakt;
    if (!data?.access_token) throw new Error('Trakt answered without a new token');
    return updateAccount('trakt', {...traktTokens(data, account.refreshToken), signedOutReason: undefined, lastSyncError: undefined}).trakt;
  });

/** The Trakt account with a live token, renewed first when it is close to expiry, or when forced. */
export const traktEnsureFresh = async ({force = false}: {force?: boolean} = {}): Promise<SyncAccount> => {
  const account = readSyncSettings().trakt;
  if (!account.accessToken || (!force && !traktRefreshDue(account))) return account;
  const stillValid = (account.expiresAt ?? 0) > Date.now();
  if (!account.refreshToken) {
    // Nothing to renew with: keep using the token until it lapses, then ask for one more sign-in.
    if (force || !stillValid) throw signOutService('trakt', TRAKT_RESIGN_IN);
    return account;
  }
  try {
    return await renewTrakt();
  } catch (error) {
    // A renewal that failed for a passing reason is fine while the current token still works.
    if (!force && stillValid && !(error instanceof WatchSyncSignedOutError)) return readSyncSettings().trakt;
    throw error;
  }
};

/** The account to run a request with: Trakt is renewed when due, an AniList token past its expiry ends the sign-in. */
const ensureFresh = async (id: SyncServiceId): Promise<SyncAccount> => {
  if (id === 'trakt') return traktEnsureFresh();
  const account = readSyncSettings()[id];
  if (id === 'anilist' && account.accessToken && account.expiresAt !== undefined && account.expiresAt <= Date.now()) {
    throw signOutService('anilist', ANILIST_ENDED);
  }
  return account;
};

/**
 * Runs a request with a live token. When Trakt rejects the token it is renewed
 * once and the request retried; Simkl V1 and AniList tokens cannot be renewed,
 * so a rejection ends the sign-in with a message.
 */
const authed = async <T>(id: SyncServiceId, run: (account: SyncAccount) => Promise<T>): Promise<T> => {
  const account = await ensureFresh(id);
  if (!account.accessToken) throw new Error(`${SERVICE_NAMES[id]} is not signed in`);
  try {
    return await run(account);
  } catch (error) {
    if (!isAuthRejection(id, error)) throw error;
    if (id !== 'trakt') throw signOutIfCurrent(id, account.accessToken, ENDED[id]);
  }
  // Another request may already have renewed the token this one used.
  const current = readSyncSettings().trakt;
  if (!current.accessToken) throw new Error('Trakt is not signed in');
  const retry = current.accessToken !== account.accessToken ? current : await traktEnsureFresh({force: true});
  try {
    return await run(retry);
  } catch (error) {
    if (isAuthRejection('trakt', error)) throw signOutIfCurrent('trakt', retry.accessToken, TRAKT_ENDED);
    throw error;
  }
};

const traktIds = async (account: SyncAccount, meta: WatchMeta): Promise<Record<string, unknown> | undefined> => {
  if (meta.imdbId) return {imdb: meta.imdbId};
  const type = meta.type === 'series' ? 'show' : 'movie';
  const hits = await request(`${TRAKT}/search/${type}?query=${encodeURIComponent(meta.title)}${meta.year ? `&years=${meta.year}` : ''}&limit=1`, {headers: traktHeaders(account)});
  return hits?.[0]?.[type]?.ids;
};

export const traktMarkWatched = async (meta: WatchMeta): Promise<void> => {
  const watched_at = new Date().toISOString();
  try {
    await authed('trakt', async account => {
      const ids = await traktIds(account, meta);
      if (!ids) throw new Error(`Trakt does not know "${meta.title}"`);
      const body =
        meta.type === 'series' && meta.season !== undefined && meta.episode !== undefined
          ? {shows: [{ids, seasons: [{number: meta.season, episodes: [{number: meta.episode, watched_at}]}]}]}
          : {movies: [{ids, watched_at}]};
      await request(`${TRAKT}/sync/history`, {method: 'POST', headers: traktHeaders(account), body: JSON.stringify(body)});
    });
  } catch (error) {
    // 403 is about the app's Client ID, not the sign-in: keep the tokens and say what to fix.
    if (error instanceof WatchSyncHttpError && error.status === 403) updateAccount('trakt', {lastSyncError: TRAKT_BAD_APP});
    throw error;
  }
};

// ---------------------------------------------------------------- Simkl
const SIMKL = 'https://api.simkl.com';

export const simklStartPin = async (clientId: string, app?: AppKeys & {builtIn: boolean}): Promise<DeviceCode> => {
  const data = await request(`${SIMKL}/oauth/pin?client_id=${encodeURIComponent(clientId)}&redirect=`);
  return {
    userCode: data.user_code,
    verificationUrl: data.verification_url || 'https://simkl.com/pin',
    deviceCode: data.user_code,
    intervalSeconds: data.interval || 5,
    expiresAt: Date.now() + (data.expires_in || 900) * 1000,
    ...(app ? {app} : {}),
  };
};

/** Simkl advertises V1 PIN tokens as lasting 157680000 s (about five years). There is no refresh grant. */
const SIMKL_V1_LIFETIME_S = 157680000;

// TODO(before April 2027): Simkl expects to retire AUTH V1, this PIN flow,
// around April 2027, which ends every V1 sign-in at once. Add the OAuth 2
// device flow (POST /oauth2/device, renewal through POST /oauth2/token) and
// store tokenType 'v2'. It needs a newly registered V2 Simkl app with its own
// Client ID, and every user signs in once more, since V1 tokens cannot be
// exchanged. See https://api.simkl.org/api-reference/auth-v2.md
export const simklPollPin = async (code: DeviceCode): Promise<PollResult> => {
  const account = readSyncSettings().simkl;
  const clientId = code.app?.clientId ?? account.clientId ?? '';
  const data = await request(`${SIMKL}/oauth/pin/${code.userCode}?client_id=${encodeURIComponent(clientId)}`);
  if (data.result !== 'OK' || !data.access_token) return 'pending';
  updateAccount('simkl', {
    accessToken: data.access_token,
    tokenType: 'v1',
    authApp: code.app?.builtIn ? 'builtin' : 'own',
    expiresAt: Date.now() + (Number(data.expires_in) || SIMKL_V1_LIFETIME_S) * 1000,
    signedOutReason: undefined,
    lastSyncError: undefined,
  });
  return 'approved';
};

export const simklMarkWatched = async (meta: WatchMeta): Promise<void> => {
  const item: Record<string, unknown> = {title: meta.title, ...(meta.year ? {year: meta.year} : {}), ids: meta.imdbId ? {imdb: meta.imdbId} : {}};
  const body =
    meta.type === 'series' && meta.season !== undefined && meta.episode !== undefined
      ? {[meta.anime ? 'anime' : 'shows']: [{...item, seasons: [{number: meta.season, episodes: [{number: meta.episode}]}]}]}
      : {movies: [item]};
  await authed('simkl', account =>
    request(`${SIMKL}/sync/history`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${account.accessToken}`, 'simkl-api-key': appKeysFor('simkl', account).clientId},
      body: JSON.stringify(body),
    }),
  );
};

// ---------------------------------------------------------------- AniList
const ANILIST = 'https://graphql.anilist.co';

/** AniList shows the token on its "pin" page after sign-in, so the user can paste it. */
export const anilistAuthorizeUrl = (clientId: string): string =>
  `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token`;

const anilistQuery = async (token: string, query: string, variables: Record<string, unknown>) =>
  request(ANILIST, {method: 'POST', headers: {Authorization: `Bearer ${token}`}, body: JSON.stringify({query, variables})});

export const anilistViewer = async (token: string): Promise<string> => {
  const data = await anilistQuery(token, 'query { Viewer { name } }', {});
  return data?.data?.Viewer?.name;
};

/**
 * Checks a pasted AniList token and saves it only once AniList accepts it, so
 * "Connected" always means verified. AniList tokens last one year and cannot
 * be renewed, so the expiry is kept to show on the card. Returns the username.
 */
export const anilistConnect = async (pasted: string): Promise<string> => {
  const token = pasted.trim();
  if (!token) throw new Error('Paste the token first');
  const expiresAt = anilistTokenExpiry(token);
  if (expiresAt !== undefined && expiresAt <= Date.now()) throw new Error('This AniList token has expired. Tap Sign in to get a new one.');
  let username: string | undefined;
  try {
    username = await anilistViewer(token);
  } catch (error) {
    if (isAuthRejection('anilist', error)) throw new Error(ANILIST_REJECTED);
    throw error;
  }
  if (!username) throw new Error(ANILIST_REJECTED);
  updateAccount('anilist', {accessToken: token, username, expiresAt, signedOutReason: undefined, lastSyncError: undefined});
  return username;
};

export const anilistMarkWatched = async (meta: WatchMeta): Promise<void> => {
  // AniList tracks anime episodes only; there is nothing to record for anything else.
  if (meta.type !== 'series' || !meta.episode) return;
  const episode = meta.episode;
  await authed('anilist', async account => {
    const token = account.accessToken || '';
    const media = await anilistQuery(
      token,
      'query ($search: String, $idMal: Int) { Media(search: $search, idMal: $idMal, type: ANIME) { id episodes mediaListEntry { progress } } }',
      meta.malId ? {idMal: meta.malId} : {search: meta.title},
    );
    const item = media?.data?.Media;
    if (!item?.id) return;
    if ((item.mediaListEntry?.progress || 0) >= episode) return;
    const done = item.episodes && episode >= item.episodes;
    await anilistQuery(
      token,
      'mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) { SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) { id } }',
      {mediaId: item.id, progress: episode, status: done ? 'COMPLETED' : 'CURRENT'},
    );
  });
};

// ---------------------------------------------------------------- sign-in upkeep
const FRESH_CHECK_INTERVAL_MS = 6 * HOUR_MS;
let lastFreshCheck: number | undefined;

/**
 * Keeps every saved sign-in alive while the app sits idle: renews Trakt before
 * its token lapses (which also keeps its refresh token in use), ends AniList
 * sign-ins past their expiry, and checks AniList tokens saved without a
 * username. Simkl V1 tokens cannot be renewed, so there is nothing to do for
 * them. Runs at most once every six hours; returns the services that signed out.
 */
export const ensureFreshAll = async (): Promise<SyncServiceId[]> => {
  const now = Date.now();
  if (lastFreshCheck !== undefined && now - lastFreshCheck < FRESH_CHECK_INTERVAL_MS) return [];
  lastFreshCheck = now;
  const settings = readSyncSettings();
  const signedOut: SyncServiceId[] = [];
  await Promise.all(
    (Object.keys(settings) as SyncServiceId[])
      .filter(id => settings[id].accessToken)
      .map(async id => {
        try {
          if (id === 'trakt') await traktEnsureFresh();
          if (id === 'anilist') {
            const account = await ensureFresh('anilist');
            if (!account.username) {
              const username = await authed('anilist', current => anilistViewer(current.accessToken || ''));
              if (username) updateAccount('anilist', {username});
            }
          }
        } catch (error) {
          if (error instanceof WatchSyncSignedOutError) signedOut.push(id);
          // Anything else is tried again at the next start or resume.
        }
      }),
  );
  return signedOut;
};

/** Signing in again is due within this window for services that cannot renew (AniList). */
export const SIGN_IN_REMINDER_MS = 14 * DAY_MS;

export interface AccountStatus {
  label: string;
  tone: 'connected' | 'warning' | 'signedOut' | 'none';
  detail?: string;
}

const formatDate = (ms: number): string => new Date(ms).toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'});

/** What the Watch sync card says about an account. */
export const describeAccount = (id: SyncServiceId, account: SyncAccount, now = Date.now()): AccountStatus => {
  if (!account.accessToken) return account.signedOutReason ? {label: account.signedOutReason, tone: 'signedOut'} : {label: 'Not connected', tone: 'none'};
  const label = `Connected${account.username ? ` as ${account.username}` : ''}`;
  if (account.lastSyncError) return {label, tone: 'warning', detail: account.lastSyncError};
  if (id === 'trakt') {
    return account.refreshToken
      ? {label, tone: 'connected', detail: 'Renews automatically'}
      : {label, tone: 'warning', detail: 'This sign-in cannot renew itself. Disconnect and sign in again to stay signed in.'};
  }
  if (id === 'anilist' && account.expiresAt) {
    const date = formatDate(account.expiresAt);
    if (account.expiresAt <= now) return {label, tone: 'warning', detail: `AniList ended this sign-in on ${date}. Disconnect and sign in again.`};
    return account.expiresAt - now < SIGN_IN_REMINDER_MS
      ? {label, tone: 'warning', detail: `AniList ends this sign-in on ${date}. Disconnect and sign in again to keep syncing.`}
      : {label, tone: 'connected', detail: `Signed in until ${date}`};
  }
  return {label, tone: 'connected'};
};

// ---------------------------------------------------------------- scrobble support
/** A POST to the Trakt API with a live token, renewed as needed. */
export const traktAuthedPost = (path: string, body: unknown): Promise<any> =>
  authed('trakt', account => request(`${TRAKT}${path}`, {method: 'POST', headers: traktHeaders(account), body: JSON.stringify(body)}));

/**
 * Titles a live scrobble session is reporting. While one is, the session's
 * own stop records the watch on Trakt, so the history POST is skipped and a
 * watch is never counted twice.
 */
const traktWatchedOwners = new Map<string, () => Promise<void>>();
export const claimTraktWatched = (meta: WatchMeta, finish: () => Promise<void>): (() => void) => {
  const key = syncedKey(meta);
  traktWatchedOwners.set(key, finish);
  return () => {
    if (traktWatchedOwners.get(key) === finish) traktWatchedOwners.delete(key);
  };
};

// ---------------------------------------------------------------- dispatcher
/** One title (and episode) for deduplication. */
export const syncedKey = (meta: WatchMeta) => `${meta.imdbId || meta.title.toLowerCase()}:${meta.season ?? ''}:${meta.episode ?? ''}`;

export const connectedSync = (settings = readSyncSettings()): SyncServiceId[] =>
  (Object.keys(settings) as SyncServiceId[]).filter(id => settings[id].enabled && settings[id].accessToken);

export interface SyncResult {
  /** Services that recorded the title. */
  synced: SyncServiceId[];
  /** Services that ended the sign-in during this sync. Tell the user once. */
  signedOut: SyncServiceId[];
}

const emptyResult = (): SyncResult => ({synced: [], signedOut: []});

/** Called once an episode or movie counts as watched. Safe to call repeatedly. */
export const syncWatched = async (meta: WatchMeta | undefined): Promise<SyncResult> => {
  if (!meta?.title) return emptyResult();
  const settings = readSyncSettings();
  const services = connectedSync(settings);
  if (!services.length) return emptyResult();
  const key = syncedKey(meta);
  if (inFlight.has(key)) return emptyResult();
  inFlight.add(key);
  try {
    return await syncNow(meta, key, services);
  } finally {
    inFlight.delete(key);
  }
};

const inFlight = new Set<string>();

const syncNow = async (meta: WatchMeta, key: string, services: SyncServiceId[]): Promise<SyncResult> => {
  const done = new Set<string>(JSON.parse(storage.getString(`done:${key}`) || '[]'));
  const result = emptyResult();
  await Promise.all(
    services
      .filter(id => !done.has(id))
      .map(async id => {
        try {
          const scrobbleOwner = id === 'trakt' ? traktWatchedOwners.get(key) : undefined;
          if (scrobbleOwner) await scrobbleOwner();
          else if (id === 'trakt') await traktMarkWatched(meta);
          if (id === 'simkl') await simklMarkWatched(meta);
          if (id === 'anilist') await anilistMarkWatched(meta);
          done.add(id);
          result.synced.push(id);
          if (readSyncSettings()[id].lastSyncError) updateAccount(id, {lastSyncError: undefined});
        } catch (error) {
          if (error instanceof WatchSyncSignedOutError) result.signedOut.push(id);
          // Anything else is tried again the next time this title finishes.
        }
      }),
  );
  storage.setString(`done:${key}`, JSON.stringify(Array.from(done)));
  return result;
};
