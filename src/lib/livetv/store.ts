import {MMKVLoader} from 'react-native-mmkv-storage';
import {parseM3U, type LiveChannel, type ParsedPlaylist} from './m3u';
import {DEFAULT_FILTERS, detectLanguages, parseResolution, sanitizeFilters, type ChannelFilters} from './filters';
import {profileKey} from '../profiles/scope';
import {catchupAttrsOf} from './catchup';

const storage = new MMKVLoader().withInstanceID('droid-stream-livetv').initialize();

export const IPTV_ORG_INDIA_URL = 'https://iptv-org.github.io/iptv/countries/in.m3u';
export const JIOTV_DEFAULT_PORT = 5001;
/** A cached playlist older than this loads again in the background. */
export const PLAYLIST_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const RECENT_LIMIT = 20;

export type LiveSourceKind = 'iptv-org' | 'jiotv' | 'playlist';

export interface LiveSource {
  id: string;
  kind: LiveSourceKind;
  name: string;
  url: string;
}

export interface UserPlaylist {
  id: string;
  name: string;
  url: string;
}

/** What the grid needs to replay a channel from Favourites or Recent. */
export type SavedChannel = Pick<LiveChannel, 'id' | 'name' | 'url' | 'logo' | 'group' | 'tvgId' | 'tvgName' | 'headers' | 'drm' | 'resolution'> & {
  sourceId: string;
  /** Kept so filters still work on Favourites and Recent. */
  languages?: string[];
  /** Only the catch-up attributes, so the guide can replay from Favourites and Recent. */
  attrs?: Record<string, string>;
};

const KEYS = {
  playlists: 'playlists',
  jiotv: 'jiotvServer',
  // Per profile; playlists, the Jio server and caches are shared.
  get favourites() {
    return profileKey('favourites');
  },
  get recent() {
    return profileKey('recent');
  },
  /** Filter choices for every source, as {sourceId: ChannelFilters}. */
  get filters() {
    return profileKey('liveFilters');
  },
  cache: (sourceId: string) => `cache:${sourceId}`,
  epg: (sourceId: string) => `epgUrl:${sourceId}`,
};

const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = storage.getString(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key: string, value: unknown) => storage.setString(key, JSON.stringify(value));

/** Small JSON values for the guide (cache metadata, Jio guide days). */
export const readLiveJson = <T>(key: string): T | undefined => readJson<T | undefined>(key, undefined);
export const writeLiveJson = (key: string, value: unknown) => writeJson(key, value);
export const removeLiveJson = (key: string) => storage.removeItem(key);

// ---- JioTV Go server ----

/** Turns "192.168.1.5", "192.168.1.5:5001/" or "http://host" into "http://host:port". */
export const normalizeServer = (input: string): string => {
  let value = input.trim().replace(/\/+$/, '');
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  const match = /^(https?:\/\/)([^/]+)(.*)$/i.exec(value);
  if (!match) return value;
  const [, scheme, host, rest] = match;
  // Add the default port when none is given (IPv6 hosts are in brackets).
  const hasPort = /\]:\d+$|^[^[\]]*:\d+$/.test(host);
  const withPort = hasPort || scheme.toLowerCase() === 'https://' ? host : `${host}:${JIOTV_DEFAULT_PORT}`;
  return `${scheme.toLowerCase()}${withPort}${rest}`;
};

export type JioQuality = 'auto' | 'low' | 'medium' | 'high';
export interface JioServerSettings {
  address: string;
  quality: JioQuality;
}

export const getJioServer = (): JioServerSettings | undefined => {
  const value = readJson<JioServerSettings | null>(KEYS.jiotv, null);
  return value?.address ? value : undefined;
};
export const setJioServer = (address: string, quality: JioQuality = 'auto'): JioServerSettings | undefined => {
  const normalized = normalizeServer(address);
  if (!normalized) {
    storage.removeItem(KEYS.jiotv);
    storage.removeItem(KEYS.cache('jiotv'));
    return undefined;
  }
  const value = {address: normalized, quality};
  writeJson(KEYS.jiotv, value);
  storage.removeItem(KEYS.cache('jiotv'));
  return value;
};

/** jiotv_go serves its playlist at /playlist.m3u (q = low|medium|high). */
export const jioPlaylistUrl = (settings: JioServerSettings): string =>
  `${settings.address}/playlist.m3u${settings.quality !== 'auto' ? `?q=${settings.quality}` : ''}`;
/** jiotv_go serves a gzipped XMLTV guide here once EPG is turned on in its config. */
export const jioEpgUrl = (settings: JioServerSettings): string => `${settings.address}/epg.xml.gz`;

// ---- Guide address ----

/** The EPG address typed in for a source; it wins over the playlist's own url-tvg. */
export const getEpgOverride = (sourceId: string): string | undefined => storage.getString(KEYS.epg(sourceId)) || undefined;
export const setEpgOverride = (sourceId: string, url: string) => {
  const clean = url.trim();
  if (!clean) {
    storage.removeItem(KEYS.epg(sourceId));
    return;
  }
  if (!isPlaylistUrl(clean)) throw new Error('Enter an http or https guide address.');
  storage.setString(KEYS.epg(sourceId), clean);
};

// ---- User playlists ----

export const listPlaylists = (): UserPlaylist[] => readJson<UserPlaylist[]>(KEYS.playlists, []);

export const isPlaylistUrl = (url: string): boolean => /^https?:\/\/\S+$/i.test(url.trim());

export const addPlaylist = (name: string, url: string): UserPlaylist => {
  const clean = url.trim();
  if (!isPlaylistUrl(clean)) throw new Error('Enter an http or https playlist address.');
  const playlists = listPlaylists();
  const existing = playlists.find(item => item.url === clean);
  if (existing) return existing;
  const playlist = {id: `pl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim() || hostOf(clean), url: clean};
  writeJson(KEYS.playlists, [...playlists, playlist]);
  return playlist;
};

export const removePlaylist = (id: string) => {
  writeJson(KEYS.playlists, listPlaylists().filter(item => item.id !== id));
  storage.removeItem(KEYS.cache(id));
  storage.removeItem(KEYS.epg(id));
  setChannelFilters(id, DEFAULT_FILTERS);
};

const hostOf = (url: string) => /^https?:\/\/([^/:?#]+)/i.exec(url)?.[1] || 'Playlist';

// ---- Sources ----

export const listSources = (): LiveSource[] => {
  const sources: LiveSource[] = [{id: 'iptv-org', kind: 'iptv-org', name: 'Free Indian channels', url: IPTV_ORG_INDIA_URL}];
  const jio = getJioServer();
  if (jio) sources.push({id: 'jiotv', kind: 'jiotv', name: 'JioTV Go server', url: jioPlaylistUrl(jio)});
  for (const playlist of listPlaylists()) sources.push({id: playlist.id, kind: 'playlist', name: playlist.name, url: playlist.url});
  return sources;
};

// ---- Playlist cache ----

interface CachedPlaylist {
  url: string;
  fetchedAt: number;
  playlist: ParsedPlaylist;
}

export const readCachedPlaylist = (source: LiveSource): CachedPlaylist | undefined => {
  const cached = readJson<CachedPlaylist | null>(KEYS.cache(source.id), null);
  return cached && cached.url === source.url ? cached : undefined;
};

export const isStale = (cached: CachedPlaylist | undefined, now = Date.now()) =>
  !cached || now - cached.fetchedAt > PLAYLIST_MAX_AGE_MS;

/** Loads a source's playlist, from the cache when it is fresh enough. */
export const loadPlaylist = async (
  source: LiveSource,
  {force = false, fetcher = fetch}: {force?: boolean; fetcher?: typeof fetch} = {},
): Promise<CachedPlaylist> => {
  const cached = readCachedPlaylist(source);
  if (cached && !force && !isStale(cached)) return cached;
  let response: Response;
  try {
    response = await fetcher(source.url, {headers: {Accept: 'audio/x-mpegurl, application/vnd.apple.mpegurl, */*'}});
  } catch {
    if (cached) return cached;
    throw new Error(
      source.kind === 'jiotv'
        ? `Could not reach ${source.url.replace(/\/playlist\.m3u.*$/, '')}. Check that jiotv_go is running and on the same network.`
        : 'Could not load the playlist. Check your connection.',
    );
  }
  if (!response.ok) {
    if (cached) return cached;
    throw new Error(`The playlist server answered ${response.status}.`);
  }
  const playlist = parseM3U(await response.text());
  if (!playlist.channels.length) {
    if (cached) return cached;
    throw new Error('No channels found in this playlist.');
  }
  const entry = {url: source.url, fetchedAt: Date.now(), playlist};
  writeJson(KEYS.cache(source.id), entry);
  return entry;
};

// ---- Favourites and recent ----

const toSaved = (channel: LiveChannel | SavedChannel, sourceId: string): SavedChannel => {
  const resolution = channel.resolution || parseResolution(channel.name, 'attrs' in channel ? channel.attrs : undefined, channel.tvgId);
  const languages = detectLanguages(channel);
  const attrs = catchupAttrsOf(channel.attrs);
  return {
    id: channel.id,
    name: channel.name,
    url: channel.url,
    logo: channel.logo,
    group: channel.group,
    tvgId: channel.tvgId,
    ...(channel.tvgName ? {tvgName: channel.tvgName} : {}),
    headers: channel.headers,
    ...(channel.drm ? {drm: true} : {}),
    ...(resolution ? {resolution} : {}),
    ...(languages.length ? {languages} : {}),
    ...(attrs ? {attrs} : {}),
    sourceId,
  };
};

export const listFavourites = (): SavedChannel[] => readJson<SavedChannel[]>(KEYS.favourites, []);
export const isFavourite = (sourceId: string, channelId: string) =>
  listFavourites().some(item => item.sourceId === sourceId && item.id === channelId);
/** Adds or removes a favourite. Returns whether it is now a favourite. */
export const toggleFavourite = (channel: LiveChannel | SavedChannel, sourceId: string): boolean => {
  const list = listFavourites();
  const exists = list.some(item => item.sourceId === sourceId && item.id === channel.id);
  writeJson(
    KEYS.favourites,
    exists ? list.filter(item => !(item.sourceId === sourceId && item.id === channel.id)) : [...list, toSaved(channel, sourceId)],
  );
  return !exists;
};

export const listRecent = (): SavedChannel[] => readJson<SavedChannel[]>(KEYS.recent, []);
export const pushRecent = (channel: LiveChannel | SavedChannel, sourceId: string) => {
  const rest = listRecent().filter(item => !(item.sourceId === sourceId && item.id === channel.id));
  writeJson(KEYS.recent, [toSaved(channel, sourceId), ...rest].slice(0, RECENT_LIMIT));
};
export const clearRecent = () => storage.removeItem(KEYS.recent);

// ---- Filters (per profile and per source) ----

const readAllFilters = (): Record<string, unknown> => {
  const all = readJson<Record<string, unknown> | null>(KEYS.filters, null);
  return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
};

/** The quality, language and group choices saved for a source (Favourites and Recent count as sources). */
export const getChannelFilters = (sourceId: string): ChannelFilters => sanitizeFilters(readAllFilters()[sourceId]);

export const setChannelFilters = (sourceId: string, filters: ChannelFilters) => {
  const all = readAllFilters();
  const clean = sanitizeFilters(filters);
  const isDefault =
    clean.resolution === DEFAULT_FILTERS.resolution &&
    !clean.languages.length &&
    !clean.group &&
    clean.qualityBadge === DEFAULT_FILTERS.qualityBadge;
  if (isDefault) {
    if (!(sourceId in all)) return;
    delete all[sourceId];
  } else {
    all[sourceId] = clean;
  }
  if (Object.keys(all).length) writeJson(KEYS.filters, all);
  else storage.removeItem(KEYS.filters);
};
