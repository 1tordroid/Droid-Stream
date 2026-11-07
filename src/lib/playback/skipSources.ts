/**
 * Intro, recap and credits times for any show, gathered in this order:
 * the provider, the viewer's Jellyfin, Emby or Plex server, chapters named
 * Intro, Recap or Credits, AniSkip (anime), IntroDB (api.introdb.app, looked
 * up by IMDb id), then the viewer's own marks.
 */
import {findAnimeSkips} from '../aniskip';
import type {SkipInterval} from '../providers/types';
import {deviceHeader, LEGACY_DEVICE_ID} from '../sources/mediaServers';
import {plexItemForPart} from '../sources/plexParts';
import {listSources, type SavedSource} from '../sources/vault';
import {cacheStorage, mainStorage} from '../storage/StorageService';
import type {WatchMeta} from '../watchMeta';
import {
  cleanMarks,
  DEFAULT_SKIP_MODES,
  embyItemIdOf,
  fromIntervals,
  jellyfinItemIdOf,
  marksToSegments,
  mergeSegments,
  parseEmbyChapters,
  parseIntroDbSegments,
  parseJellyfinSegments,
  parsePlexMarkers,
  SEGMENT_KINDS,
  type SeasonMarks,
  type SegmentKind,
  type SkipMode,
  type SkipModes,
  type SkipSegment,
} from './skipSegmentModel';

// Settings

const MODE_KEY = (kind: SegmentKind) => `skip-mode:${kind}`;
const INTRODB_KEY = 'skip-introdb-enabled';

export const getSkipModes = (): SkipModes => {
  const modes = {...DEFAULT_SKIP_MODES};
  for (const kind of SEGMENT_KINDS) {
    const stored = mainStorage.getString(MODE_KEY(kind));
    if (stored === 'off' || stored === 'button' || stored === 'auto') modes[kind] = stored;
  }
  return modes;
};

export const setSkipMode = (kind: SegmentKind, mode: SkipMode): void => {
  mainStorage.setString(MODE_KEY(kind), mode);
};

export const isIntroDbEnabled = (): boolean => mainStorage.getBool(INTRODB_KEY, true);
export const setIntroDbEnabled = (value: boolean): void => {
  mainStorage.setBool(INTRODB_KEY, value);
};

// Cache of fetched times

/** Found times are kept for a week, empty answers for a day so new submissions show up. */
const FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedSegments {
  at: number;
  segments: SkipSegment[];
}

export const readCachedSegments = (key: string, now = Date.now()): SkipSegment[] | undefined => {
  const entry = cacheStorage.getObject<CachedSegments>(`skipseg:${key}`);
  if (!entry || typeof entry.at !== 'number' || !Array.isArray(entry.segments)) return undefined;
  const ttl = entry.segments.length > 0 ? FOUND_TTL_MS : EMPTY_TTL_MS;
  if (now - entry.at > ttl || entry.at > now) return undefined;
  return entry.segments;
};

export const writeCachedSegments = (key: string, segments: SkipSegment[], now = Date.now()): void => {
  cacheStorage.setObject<CachedSegments>(`skipseg:${key}`, {at: now, segments});
};

const cached = async (key: string, load: () => Promise<SkipSegment[]>): Promise<SkipSegment[]> => {
  const hit = readCachedSegments(key);
  if (hit) return hit;
  const segments = await load();
  writeCachedSegments(key, segments);
  return segments;
};

const getJson = async (url: string, headers: Record<string, string> = {}): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {signal: controller.signal, headers: {Accept: 'application/json', ...headers}});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

// Jellyfin

const rootOf = (server: string) => server.replace(/\/+$/, '').toLowerCase();

/** The saved Jellyfin source and item behind a stream address, if any. */
export const findJellyfinItem = (
  urls: (string | undefined)[],
  sources: SavedSource[] = listSources(),
): {source: SavedSource; itemId: string} | undefined => {
  const jellyfin = sources.filter(source => source.kind === 'jellyfin' && source.secret && source.authState !== 'signedOut');
  for (const url of urls) {
    const itemId = jellyfinItemIdOf(url);
    if (!itemId || !url) continue;
    const source = jellyfin.find(entry => url.toLowerCase().startsWith(rootOf(entry.server) + '/'));
    if (source) return {source, itemId};
  }
  return undefined;
};

/** Media segments from Jellyfin 10.10 or later. Older servers answer 404, which gives []. */
export const fetchJellyfinSegments = (source: SavedSource, itemId: string): Promise<SkipSegment[]> =>
  cached(`jf:${source.id}:${itemId}`, async () => {
    const root = source.server.replace(/\/+$/, '');
    const headers = deviceHeader(source.deviceId || LEGACY_DEVICE_ID, source.secret);
    const data = await getJson(`${root}/MediaSegments/${encodeURIComponent(itemId)}`, headers);
    return parseJellyfinSegments(data);
  });

// Emby and Plex

const signedIn = (kind: SavedSource['kind'], sources: SavedSource[]) =>
  sources.filter(source => source.kind === kind && source.secret && source.authState !== 'signedOut');

/** The saved Emby source and item behind a stream address, if any. */
export const findEmbyItem = (
  urls: (string | undefined)[],
  sources: SavedSource[] = listSources(),
): {source: SavedSource; itemId: string} | undefined => {
  const emby = signedIn('emby', sources);
  for (const url of urls) {
    const itemId = embyItemIdOf(url);
    if (!itemId || !url) continue;
    const source = emby.find(entry => url.toLowerCase().startsWith(rootOf(entry.server) + '/'));
    if (source) return {source, itemId};
  }
  return undefined;
};

/** Emby intro and credits markers (and chapters named Intro or Credits). */
export const fetchEmbySegments = (source: SavedSource, itemId: string): Promise<SkipSegment[]> =>
  cached(`emby:${source.id}:${itemId}`, async () => {
    const root = source.server.replace(/\/+$/, '');
    const headers = deviceHeader(source.deviceId || LEGACY_DEVICE_ID, source.secret);
    const url = `${root}/Users/${encodeURIComponent(source.username)}/Items/${encodeURIComponent(itemId)}?Fields=Chapters`;
    return parseEmbyChapters(await getJson(url, headers));
  });

/** The saved Plex source and item (ratingKey) behind a media part address, if the library saw it. */
export const findPlexItem = (
  urls: (string | undefined)[],
  sources: SavedSource[] = listSources(),
): {source: SavedSource; ratingKey: string} | undefined => {
  const plex = signedIn('plex', sources);
  for (const url of urls) {
    for (const source of plex) {
      const ratingKey = plexItemForPart(source.server, url);
      if (ratingKey) return {source, ratingKey};
    }
  }
  return undefined;
};

/** Plex intro and credits markers. */
export const fetchPlexSegments = (source: SavedSource, ratingKey: string): Promise<SkipSegment[]> =>
  cached(`plex:${source.id}:${ratingKey}`, async () => {
    const root = source.server.replace(/\/+$/, '');
    const url = `${root}/library/metadata/${encodeURIComponent(ratingKey)}?includeMarkers=1`;
    return parsePlexMarkers(await getJson(url, {'X-Plex-Token': source.secret}));
  });

/**
 * One key for the media server item behind what is playing, so the player
 * fetches again only when the item changes.
 */
export const mediaServerItemKey = (urls: (string | undefined)[], sources: SavedSource[] = listSources()): string | undefined => {
  const jellyfin = findJellyfinItem(urls, sources);
  if (jellyfin) return `jf:${jellyfin.source.id}:${jellyfin.itemId}`;
  const emby = findEmbyItem(urls, sources);
  if (emby) return `emby:${emby.source.id}:${emby.itemId}`;
  const plex = findPlexItem(urls, sources);
  return plex ? `plex:${plex.source.id}:${plex.ratingKey}` : undefined;
};

// AniSkip (anime) and IntroDB

/** AniSkip keeps its own cache, and its switch in Watch sync still applies. */
const fetchAniSkip = async (meta: WatchMeta): Promise<SkipSegment[]> =>
  fromIntervals(await findAnimeSkips({title: meta.title, episode: meta.episode, malId: meta.malId}), 'aniskip');

const IMDB_ID = /^tt\d{5,10}$/;

const fetchIntroDb = (meta: WatchMeta): Promise<SkipSegment[]> =>
  cached(`idb:${meta.imdbId}:${meta.season}:${meta.episode}`, async () => {
    const query = `imdb_id=${encodeURIComponent(meta.imdbId!)}&season=${meta.season}&episode=${meta.episode}`;
    return parseIntroDbSegments(await getJson(`https://api.introdb.app/segments?${query}`));
  });

export interface FetchedSegments {
  jellyfin: SkipSegment[];
  emby: SkipSegment[];
  plex: SkipSegment[];
  aniskip: SkipSegment[];
  introdb: SkipSegment[];
}

export const NO_FETCHED_SEGMENTS: FetchedSegments = {jellyfin: [], emby: [], plex: [], aniskip: [], introdb: []};

/** Every online source that applies to what is playing. A source that fails gives []. */
export const fetchSegments = async (input: {
  streamUrls: (string | undefined)[];
  meta?: WatchMeta;
}): Promise<FetchedSegments> => {
  const {meta} = input;
  const series = meta?.type === 'series' && Boolean(meta.episode);
  const sources = listSources();
  const jellyfinItem = findJellyfinItem(input.streamUrls, sources);
  const embyItem = jellyfinItem ? undefined : findEmbyItem(input.streamUrls, sources);
  const plexItem = jellyfinItem || embyItem ? undefined : findPlexItem(input.streamUrls, sources);
  const [jellyfin, emby, plex, aniskip, introdb] = await Promise.all([
    jellyfinItem ? fetchJellyfinSegments(jellyfinItem.source, jellyfinItem.itemId).catch(() => []) : [],
    embyItem ? fetchEmbySegments(embyItem.source, embyItem.itemId).catch(() => []) : [],
    plexItem ? fetchPlexSegments(plexItem.source, plexItem.ratingKey).catch(() => []) : [],
    series && meta ? fetchAniSkip(meta).catch(() => []) : [],
    series && meta && meta.season !== undefined && meta.imdbId && IMDB_ID.test(meta.imdbId) && isIntroDbEnabled()
      ? fetchIntroDb(meta).catch(() => [])
      : [],
  ]);
  return {jellyfin, emby, plex, aniskip, introdb};
};

// The viewer's marks, per show and season

const marksKey = (showKey: string, season?: number) =>
  `skip-marks:${showKey.trim().toLowerCase()}:${season ?? 'none'}`;

export const readSeasonMarks = (showKey: string, season?: number): SeasonMarks =>
  cleanMarks(mainStorage.getObject<SeasonMarks>(marksKey(showKey, season)));

export const writeSeasonMarks = (showKey: string, season: number | undefined, marks: SeasonMarks): void => {
  mainStorage.setObject(marksKey(showKey, season), marks);
};

export const clearSeasonMarks = (showKey: string, season?: number): void => {
  mainStorage.delete(marksKey(showKey, season));
};

/** All sources merged, highest priority first. */
export const gatherSegments = (input: {
  provider: (SkipInterval | null | undefined)[];
  fetched: FetchedSegments;
  /** Chapters named for what they hold (chaptersToSegments). */
  chapters?: SkipSegment[];
  marks: SeasonMarks;
  /** Older per-show marks, below the season marks. */
  legacy?: (SkipInterval | null | undefined)[];
  durationSeconds?: number;
}): SkipSegment[] =>
  mergeSegments(
    [
      fromIntervals(input.provider, 'provider'),
      input.fetched.jellyfin,
      input.fetched.emby || [],
      input.fetched.plex || [],
      input.chapters || [],
      input.fetched.aniskip,
      input.fetched.introdb,
      marksToSegments(input.marks, input.durationSeconds || 0),
      fromIntervals(input.legacy, 'user'),
    ],
    input.durationSeconds || 0,
  );
