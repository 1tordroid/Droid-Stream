/**
 * Marks finished movies and episodes as watched on Trakt, Simkl, and AniList.
 * Each person connects their own account. Tokens stay in encrypted storage.
 */
import {MMKVLoader} from 'react-native-mmkv-storage';
import type {WatchMeta} from '../watchMeta';

const storage = new MMKVLoader().withInstanceID('droid-stream-watch-sync').withEncryption().initialize();

export type SyncServiceId = 'trakt' | 'simkl' | 'anilist';

export interface SyncAccount {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  username?: string;
  enabled: boolean;
}

export type SyncSettings = Record<SyncServiceId, SyncAccount>;

const defaults = (): SyncSettings => ({trakt: {enabled: true}, simkl: {enabled: true}, anilist: {enabled: true}});

export const readSyncSettings = (): SyncSettings => {
  try {
    const saved = JSON.parse(storage.getString('settings') || '{}');
    const base = defaults();
    return {trakt: {...base.trakt, ...saved.trakt}, simkl: {...base.simkl, ...saved.simkl}, anilist: {...base.anilist, ...saved.anilist}};
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

const request = async (url: string, init: RequestInit = {}): Promise<any> => {
  const response = await fetch(url, {...init, headers: {'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers as any)}});
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {raw: text};
  }
  if (!response.ok) {
    const error: Error & {status?: number} = new Error(data?.error_description || data?.error || data?.message || data?.errors?.[0]?.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
};

// ---------------------------------------------------------------- Trakt
const TRAKT = 'https://api.trakt.tv';
const traktHeaders = (account: SyncAccount) => ({
  'trakt-api-version': '2',
  'trakt-api-key': account.clientId || '',
  ...(account.accessToken ? {Authorization: `Bearer ${account.accessToken}`} : {}),
});

export interface DeviceCode {
  userCode: string;
  verificationUrl: string;
  deviceCode: string;
  intervalSeconds: number;
  expiresAt: number;
}

export const traktStartDevice = async (clientId: string): Promise<DeviceCode> => {
  const data = await request(`${TRAKT}/oauth/device/code`, {method: 'POST', body: JSON.stringify({client_id: clientId})});
  return {userCode: data.user_code, verificationUrl: data.verification_url, deviceCode: data.device_code, intervalSeconds: data.interval || 5, expiresAt: Date.now() + data.expires_in * 1000};
};

/** Returns true once the user approved the code; false while still pending. */
export const traktPollDevice = async (code: DeviceCode): Promise<boolean> => {
  const account = readSyncSettings().trakt;
  try {
    const data = await request(`${TRAKT}/oauth/device/token`, {
      method: 'POST',
      body: JSON.stringify({code: code.deviceCode, client_id: account.clientId, client_secret: account.clientSecret}),
    });
    const me = await request(`${TRAKT}/users/me`, {headers: traktHeaders({...account, accessToken: data.access_token})}).catch(() => ({}));
    updateAccount('trakt', {accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: (data.created_at + data.expires_in) * 1000, username: me.username});
    return true;
  } catch (error: any) {
    if (error.status === 400 || error.status === 429) return false; // pending or slow down
    throw error;
  }
};

const traktRefresh = async (): Promise<SyncAccount> => {
  const account = readSyncSettings().trakt;
  if (!account.refreshToken || !account.expiresAt || account.expiresAt - Date.now() > 86400000) return account;
  const data = await request(`${TRAKT}/oauth/token`, {
    method: 'POST',
    body: JSON.stringify({refresh_token: account.refreshToken, client_id: account.clientId, client_secret: account.clientSecret, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', grant_type: 'refresh_token'}),
  });
  return updateAccount('trakt', {accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: (data.created_at + data.expires_in) * 1000}).trakt;
};

const traktIds = async (account: SyncAccount, meta: WatchMeta): Promise<Record<string, unknown> | undefined> => {
  if (meta.imdbId) return {imdb: meta.imdbId};
  const type = meta.type === 'series' ? 'show' : 'movie';
  const hits = await request(`${TRAKT}/search/${type}?query=${encodeURIComponent(meta.title)}${meta.year ? `&years=${meta.year}` : ''}&limit=1`, {headers: traktHeaders(account)});
  return hits?.[0]?.[type]?.ids;
};

export const traktMarkWatched = async (meta: WatchMeta): Promise<void> => {
  const account = await traktRefresh();
  if (!account.accessToken) return;
  const ids = await traktIds(account, meta);
  if (!ids) throw new Error(`Trakt does not know "${meta.title}"`);
  const watched_at = new Date().toISOString();
  const body =
    meta.type === 'series' && meta.season !== undefined && meta.episode !== undefined
      ? {shows: [{ids, seasons: [{number: meta.season, episodes: [{number: meta.episode, watched_at}]}]}]}
      : {movies: [{ids, watched_at}]};
  await request(`${TRAKT}/sync/history`, {method: 'POST', headers: traktHeaders(account), body: JSON.stringify(body)});
};

// ---------------------------------------------------------------- Simkl
const SIMKL = 'https://api.simkl.com';

export const simklStartPin = async (clientId: string): Promise<DeviceCode> => {
  const data = await request(`${SIMKL}/oauth/pin?client_id=${encodeURIComponent(clientId)}&redirect=`);
  return {userCode: data.user_code, verificationUrl: data.verification_url || 'https://simkl.com/pin', deviceCode: data.user_code, intervalSeconds: data.interval || 5, expiresAt: Date.now() + (data.expires_in || 900) * 1000};
};

export const simklPollPin = async (code: DeviceCode): Promise<boolean> => {
  const account = readSyncSettings().simkl;
  const data = await request(`${SIMKL}/oauth/pin/${code.userCode}?client_id=${encodeURIComponent(account.clientId || '')}`);
  if (data.result !== 'OK' || !data.access_token) return false;
  updateAccount('simkl', {accessToken: data.access_token});
  return true;
};

export const simklMarkWatched = async (meta: WatchMeta): Promise<void> => {
  const account = readSyncSettings().simkl;
  if (!account.accessToken) return;
  const item: Record<string, unknown> = {title: meta.title, ...(meta.year ? {year: meta.year} : {}), ids: meta.imdbId ? {imdb: meta.imdbId} : {}};
  const body =
    meta.type === 'series' && meta.season !== undefined && meta.episode !== undefined
      ? {[meta.anime ? 'anime' : 'shows']: [{...item, seasons: [{number: meta.season, episodes: [{number: meta.episode}]}]}]}
      : {movies: [item]};
  await request(`${SIMKL}/sync/history`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${account.accessToken}`, 'simkl-api-key': account.clientId || ''},
    body: JSON.stringify(body),
  });
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

export const anilistMarkWatched = async (meta: WatchMeta): Promise<void> => {
  const account = readSyncSettings().anilist;
  if (!account.accessToken || meta.type !== 'series' || !meta.episode) return;
  const media = await anilistQuery(
    account.accessToken,
    'query ($search: String, $idMal: Int) { Media(search: $search, idMal: $idMal, type: ANIME) { id episodes mediaListEntry { progress } } }',
    meta.malId ? {idMal: meta.malId} : {search: meta.title},
  );
  const item = media?.data?.Media;
  if (!item?.id) return;
  if ((item.mediaListEntry?.progress || 0) >= meta.episode) return;
  const done = item.episodes && meta.episode >= item.episodes;
  await anilistQuery(
    account.accessToken,
    'mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) { SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) { id } }',
    {mediaId: item.id, progress: meta.episode, status: done ? 'COMPLETED' : 'CURRENT'},
  );
};

// ---------------------------------------------------------------- dispatcher
const syncedKey = (meta: WatchMeta) => `${meta.imdbId || meta.title.toLowerCase()}:${meta.season ?? ''}:${meta.episode ?? ''}`;

export const connectedSync = (settings = readSyncSettings()): SyncServiceId[] =>
  (Object.keys(settings) as SyncServiceId[]).filter(id => settings[id].enabled && settings[id].accessToken);

/** Called once an episode or movie counts as watched. Safe to call repeatedly. */
export const syncWatched = async (meta: WatchMeta | undefined): Promise<SyncServiceId[]> => {
  if (!meta?.title) return [];
  const settings = readSyncSettings();
  const services = connectedSync(settings);
  if (!services.length) return [];
  const key = syncedKey(meta);
  if (inFlight.has(key)) return [];
  inFlight.add(key);
  try {
    return await syncNow(meta, key, services);
  } finally {
    inFlight.delete(key);
  }
};

const inFlight = new Set<string>();

const syncNow = async (meta: WatchMeta, key: string, services: SyncServiceId[]): Promise<SyncServiceId[]> => {
  const done = new Set<string>(JSON.parse(storage.getString(`done:${key}`) || '[]'));
  const synced: SyncServiceId[] = [];
  await Promise.all(
    services
      .filter(id => !done.has(id))
      .map(async id => {
        try {
          if (id === 'trakt') await traktMarkWatched(meta);
          if (id === 'simkl') await simklMarkWatched(meta);
          if (id === 'anilist') await anilistMarkWatched(meta);
          done.add(id);
          synced.push(id);
        } catch {
          // Tried again the next time this title finishes.
        }
      }),
  );
  storage.setString(`done:${key}`, JSON.stringify(Array.from(done)));
  return synced;
};
