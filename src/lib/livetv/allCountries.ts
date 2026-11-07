/**
 * "All countries" in Live TV: iptv-org's free channels of every country in
 * one list, with the country as a filter.
 *
 * iptv-org publishes two combined playlists: index.m3u has each stream once
 * with its categories as the group, index.country.m3u has each stream once
 * per country that lists it, with the country as the group. Both are
 * downloaded to the cache folder, read back in pieces (pausing between
 * pieces so the screen stays responsive) and joined by stream address, so
 * each channel is kept once with its categories and its countries.
 *
 * Only what the grid, the filters, favourites and the guide need is kept
 * (no raw attributes). The joined list is cached as a compact file for 12
 * hours and held in memory once while Live TV shows it.
 */
import * as RNFS from '@dr.pogodin/react-native-fs';
import {toByteArray} from 'base64-js';
import {ALL_CATEGORIES_PLAYLIST_URL, ALL_COUNTRIES_PLAYLIST_URL, countryCodeOfName} from './countries';
import {detectLanguages} from './filters';
import {M3uParser, type LiveChannel} from './m3u';
import {PLAYLIST_MAX_AGE_MS, readLiveJson, writeLiveJson, type SavedChannel} from './store';
import {Utf8Stream} from './utf8';
import {WORLD_ALL_ID} from './world';

/** A channel of All countries, as the grid and the filters use it. */
export type AllChannel = SavedChannel & {countries: string[]};

export interface AllCountriesList {
  channels: AllChannel[];
  fetchedAt: number;
}

interface AllMeta {
  fetchedAt: number;
  count: number;
  /** Channels per country code, for the country list. */
  counts: Record<string, number>;
  version: number;
}

const VERSION = 1;
const META_KEY = 'worldAllMeta';
/** Bytes read per piece; a piece is parsed, then the screen gets a turn. */
const READ_CHUNK = 256 * 1024;
/** Rows turned back into channels per turn when the cache is read. */
const ROWS_PER_TURN = 2000;
/** A combined playlist larger than this is not read (it is about 3 MB today). */
const MAX_PLAYLIST_BYTES = 40 * 1024 * 1024;
export const ALL_COUNTRIES_ERROR = 'Could not load the channels of every country. Check your connection.';

const dir = () => `${RNFS.CachesDirectoryPath}/livetv-world`;
const cachePath = () => `${dir()}/all.json`;

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

let memory: AllCountriesList | undefined;
let loading: Promise<AllCountriesList> | undefined;

/** The list when it is already in memory. */
export const peekAllCountries = (): AllCountriesList | undefined => memory;

/** Drops the in-memory list (Live TV calls this when another list opens). */
export const releaseAllCountries = () => {
  memory = undefined;
};

/** Channels per country from the last time the list was built, as {code: count}. */
export const allCountryCounts = (): Record<string, number> => readLiveJson<AllMeta>(META_KEY)?.counts || {};

/** Reads a downloaded playlist in pieces through the M3U parser. */
export const streamPlaylistFile = async (path: string, onChannel: (channel: LiveChannel) => void): Promise<void> => {
  const size = Number((await RNFS.stat(path)).size) || 0;
  if (size > MAX_PLAYLIST_BYTES) throw new Error('This playlist is too large.');
  const parser = new M3uParser(onChannel, {uniqueIds: false});
  const utf8 = new Utf8Stream();
  for (let pos = 0; pos < size; pos += READ_CHUNK) {
    const bytes = toByteArray(await RNFS.read(path, Math.min(READ_CHUNK, size - pos), pos, 'base64'));
    parser.push(utf8.decode(bytes));
    await tick();
  }
  parser.push(utf8.decode(new Uint8Array(0), true));
  parser.end();
};

/** What is kept of a playlist channel. The stream address is unique in index.m3u, so it is the id. */
const compact = (channel: LiveChannel): AllChannel => {
  const languages = detectLanguages(channel);
  return {
    id: channel.url,
    name: channel.name,
    url: channel.url,
    ...(channel.logo ? {logo: channel.logo} : {}),
    ...(channel.group ? {group: channel.group} : {}),
    ...(channel.tvgId ? {tvgId: channel.tvgId} : {}),
    ...(channel.resolution ? {resolution: channel.resolution} : {}),
    ...(channel.headers ? {headers: channel.headers} : {}),
    ...(channel.drm ? {drm: true} : {}),
    ...(languages.length ? {languages} : {}),
    countries: [],
    sourceId: WORLD_ALL_ID,
  };
};

/**
 * Joins the two combined playlists: channels from the category list, each
 * with the countries the country list files it under. Countries are kept in
 * the order iptv-org lists them; "International" is INT.
 */
export const buildAllCountries = async (categoriesPath: string, countriesPath: string): Promise<AllChannel[]> => {
  const channels: AllChannel[] = [];
  const byUrl = new Map<string, AllChannel>();
  await streamPlaylistFile(categoriesPath, channel => {
    if (byUrl.has(channel.url)) return;
    const item = compact(channel);
    byUrl.set(channel.url, item);
    channels.push(item);
  });
  await streamPlaylistFile(countriesPath, channel => {
    const code = countryCodeOfName(channel.group);
    if (!code) return;
    let item = byUrl.get(channel.url);
    if (!item) {
      // Listed by country only: keep it, without categories.
      item = compact({...channel, group: undefined});
      byUrl.set(channel.url, item);
      channels.push(item);
    }
    if (!item.countries.includes(code)) item.countries.push(code);
  });
  return channels;
};

// ---- Cache: one row per channel, as an array, to keep the file small ----

type Row = [name: string, url: string, logo: string, group: string, tvgId: string, resolution: string, countries: string, languages: string, headers: string, drm: 0 | 1];

const toRow = (channel: AllChannel): Row => [
  channel.name,
  channel.url,
  channel.logo || '',
  channel.group || '',
  channel.tvgId || '',
  channel.resolution || '',
  channel.countries.join(','),
  (channel.languages || []).join(','),
  channel.headers ? JSON.stringify(channel.headers) : '',
  channel.drm ? 1 : 0,
];

const fromRow = (row: Row): AllChannel => {
  const [name, url, logo, group, tvgId, resolution, countries, languages, headers, drm] = row;
  return {
    id: url,
    name,
    url,
    ...(logo ? {logo} : {}),
    ...(group ? {group} : {}),
    ...(tvgId ? {tvgId} : {}),
    ...(resolution ? {resolution} : {}),
    ...(headers ? {headers: JSON.parse(headers) as Record<string, string>} : {}),
    ...(drm ? {drm: true} : {}),
    ...(languages ? {languages: languages.split(',')} : {}),
    countries: countries ? countries.split(',') : [],
    sourceId: WORLD_ALL_ID,
  };
};

/** Channels per country. */
export const countChannelsByCountry = (channels: {countries: string[]}[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const channel of channels) for (const code of channel.countries) counts[code] = (counts[code] || 0) + 1;
  return counts;
};

const writeCache = async (channels: AllChannel[], fetchedAt: number) => {
  await RNFS.writeFile(cachePath(), JSON.stringify(channels.map(toRow)), 'utf8');
  writeLiveJson(META_KEY, {fetchedAt, count: channels.length, counts: countChannelsByCountry(channels), version: VERSION} satisfies AllMeta);
};

const readCache = async (): Promise<AllCountriesList | undefined> => {
  const meta = readLiveJson<AllMeta>(META_KEY);
  if (!meta || meta.version !== VERSION) return undefined;
  try {
    if (!(await RNFS.exists(cachePath()))) return undefined;
    const rows = JSON.parse(await RNFS.readFile(cachePath(), 'utf8')) as Row[];
    if (!Array.isArray(rows)) return undefined;
    const channels: AllChannel[] = [];
    for (let i = 0; i < rows.length; i += ROWS_PER_TURN) {
      for (const row of rows.slice(i, i + ROWS_PER_TURN)) channels.push(fromRow(row));
      await tick();
    }
    return {channels, fetchedAt: meta.fetchedAt};
  } catch {
    return undefined;
  }
};

const download = async (url: string, toFile: string) => {
  const part = `${toFile}.part`;
  let status = 0;
  try {
    status = (
      await RNFS.downloadFile({
        fromUrl: url,
        toFile: part,
        headers: {Accept: 'audio/x-mpegurl, application/vnd.apple.mpegurl, */*'},
        connectionTimeout: 20_000,
        readTimeout: 60_000,
      }).promise
    ).statusCode;
  } catch {
    throw new Error(ALL_COUNTRIES_ERROR);
  }
  if (status >= 400) {
    await RNFS.unlink(part).catch(() => undefined);
    throw new Error(`The playlist server answered ${status}.`);
  }
  await RNFS.unlink(toFile).catch(() => undefined);
  await RNFS.moveFile(part, toFile);
};

const fetchAndBuild = async (): Promise<AllCountriesList> => {
  await RNFS.mkdir(dir()).catch(() => undefined);
  const categories = `${dir()}/index.m3u`;
  const countries = `${dir()}/index.country.m3u`;
  await download(ALL_CATEGORIES_PLAYLIST_URL, categories);
  await download(ALL_COUNTRIES_PLAYLIST_URL, countries);
  try {
    const channels = await buildAllCountries(categories, countries);
    if (!channels.length) throw new Error('No channels found in this playlist.');
    const fetchedAt = Date.now();
    await writeCache(channels, fetchedAt).catch(() => undefined);
    return {channels, fetchedAt};
  } finally {
    // The joined list is cached; the raw playlists are not needed again.
    await RNFS.unlink(categories).catch(() => undefined);
    await RNFS.unlink(countries).catch(() => undefined);
  }
};

/**
 * Every country's channels: from memory, else the cache when it is under
 * 12 hours old, else downloaded and built again. When the download fails,
 * an older cache is used.
 */
export const loadAllCountries = ({force = false}: {force?: boolean} = {}): Promise<AllCountriesList> => {
  if (memory && !force && Date.now() - memory.fetchedAt < PLAYLIST_MAX_AGE_MS) return Promise.resolve(memory);
  if (loading) return loading;
  loading = (async () => {
    const cached = memory || (await readCache());
    if (cached && !force && Date.now() - cached.fetchedAt < PLAYLIST_MAX_AGE_MS) return cached;
    try {
      return await fetchAndBuild();
    } catch (err) {
      if (cached) return cached;
      throw err;
    }
  })()
    .then(list => {
      memory = list;
      return list;
    })
    .finally(() => {
      loading = undefined;
    });
  return loading;
};

/** Tests only. */
export const resetAllCountriesForTests = () => {
  memory = undefined;
  loading = undefined;
};
