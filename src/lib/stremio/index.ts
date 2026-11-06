/**
 * Client for the public Stremio add-on protocol (manifest, stream, subtitles,
 * meta, catalog). Users add the add-ons they want by URL, such as Torrentio,
 * Comet, MediaFusion, or OpenSubtitles v3. Original TypeScript.
 */
import {MMKVLoader} from 'react-native-mmkv-storage';

const storage = new MMKVLoader().withInstanceID('droid-stream-stremio').withEncryption().initialize();

export type StremioType = 'movie' | 'series' | 'anime' | 'tv' | 'channel' | string;

export interface StremioResource {
  name: string;
  types?: string[];
  idPrefixes?: string[];
}

export interface StremioManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  logo?: string;
  types: string[];
  idPrefixes?: string[];
  resources: (string | StremioResource)[];
  catalogs?: {type: string; id: string; name?: string; extra?: {name: string}[]}[];
  behaviorHints?: {configurable?: boolean; configurationRequired?: boolean; adult?: boolean; p2p?: boolean};
}

export interface InstalledAddon {
  /** Base URL without /manifest.json. The key: configured add-ons embed settings in it. */
  base: string;
  manifest: StremioManifest;
  enabled: boolean;
  addedAt: number;
}

export interface StremioStream {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  ytId?: string;
  sources?: string[];
  subtitles?: StremioSubtitle[];
  behaviorHints?: {
    bingeGroup?: string;
    filename?: string;
    videoSize?: number;
    videoHash?: string;
    notWebReady?: boolean;
    proxyHeaders?: {request?: Record<string, string>};
  };
}

export interface StremioSubtitle {
  id?: string;
  url: string;
  lang: string;
}

export interface StremioMeta {
  id: string;
  type: string;
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  releaseInfo?: string;
  year?: number;
  description?: string;
  imdbRating?: string;
  moviedb_id?: number;
  genres?: string[];
  videos?: {id: string; title?: string; name?: string; season?: number; episode?: number; released?: string; thumbnail?: string}[];
}

export const CINEMETA = 'https://v3-cinemeta.strem.io';

/** Accepts stremio://, https://…/manifest.json, or a base URL. */
export const normalizeAddonUrl = (input: string): string => {
  let url = input.trim();
  if (url.startsWith('stremio://')) url = `https://${url.slice('stremio://'.length)}`;
  if (!/^https?:\/\//i.test(url)) throw new Error('Paste an add-on URL that starts with https:// or stremio://');
  return url.replace(/\/manifest\.json(\?.*)?$/i, '').replace(/\/+$/, '');
};

const getJson = async <T>(url: string, timeoutMs = 15000): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {signal: controller.signal, headers: {Accept: 'application/json'}});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const fetchManifest = async (input: string): Promise<{base: string; manifest: StremioManifest}> => {
  const base = normalizeAddonUrl(input);
  const manifest = await getJson<StremioManifest>(`${base}/manifest.json`);
  if (!manifest?.id || !Array.isArray(manifest.resources)) throw new Error('That URL is not a Stremio add-on manifest');
  return {base, manifest};
};

// ---------------------------------------------------------------- storage
export const readAddons = (): InstalledAddon[] => {
  try {
    return JSON.parse(storage.getString('addons') || '[]');
  } catch {
    return [];
  }
};

export const writeAddons = (addons: InstalledAddon[]): void => {
  storage.setString('addons', JSON.stringify(addons));
};

export const installAddon = async (input: string): Promise<InstalledAddon> => {
  const {base, manifest} = await fetchManifest(input);
  if (manifest.behaviorHints?.configurationRequired) {
    throw new Error(`${manifest.name} needs to be configured first. Open its Configure page, then paste the URL it gives you.`);
  }
  const addon: InstalledAddon = {base, manifest, enabled: true, addedAt: Date.now()};
  writeAddons([addon, ...readAddons().filter(item => item.base !== base)]);
  return addon;
};

export const removeAddon = (base: string): void => writeAddons(readAddons().filter(item => item.base !== base));

export const setAddonEnabled = (base: string, enabled: boolean): void =>
  writeAddons(readAddons().map(item => (item.base === base ? {...item, enabled} : item)));

// ---------------------------------------------------------------- resources
export const supports = (manifest: StremioManifest, resource: string, type: string, id: string): boolean => {
  for (const entry of manifest.resources) {
    const name = typeof entry === 'string' ? entry : entry.name;
    if (name !== resource) continue;
    const types = (typeof entry === 'string' ? undefined : entry.types) || manifest.types || [];
    const prefixes = (typeof entry === 'string' ? undefined : entry.idPrefixes) || manifest.idPrefixes;
    if (types.length && !types.includes(type)) continue;
    if (prefixes?.length && !prefixes.some(prefix => id.startsWith(prefix))) continue;
    return true;
  }
  return false;
};

/** Stremio video id: "tt0111161" for a movie, "tt0903747:1:2" for an episode. */
export const videoId = (imdbId: string, season?: number, episode?: number): string =>
  season !== undefined && episode !== undefined ? `${imdbId}:${season}:${episode}` : imdbId;

export interface AddonStreams {
  addon: InstalledAddon;
  streams: StremioStream[];
  error?: string;
  ms: number;
}

export const fetchStreams = async (
  type: 'movie' | 'series',
  id: string,
  addons: InstalledAddon[] = readAddons().filter(addon => addon.enabled),
  onUpdate?: (result: AddonStreams) => void,
): Promise<AddonStreams[]> =>
  Promise.all(
    addons
      .filter(addon => supports(addon.manifest, 'stream', type, id))
      .map(async addon => {
        const started = Date.now();
        let result: AddonStreams;
        try {
          const data = await getJson<{streams?: StremioStream[]}>(`${addon.base}/stream/${type}/${encodeURIComponent(id)}.json`, 25000);
          result = {addon, streams: Array.isArray(data?.streams) ? data.streams : [], ms: Date.now() - started};
        } catch (error: any) {
          result = {addon, streams: [], error: error?.message || String(error), ms: Date.now() - started};
        }
        onUpdate?.(result);
        return result;
      }),
  );

/** Subtitles from add-ons such as OpenSubtitles v3, matched by video hash when known. */
export const fetchAddonSubtitles = async (
  type: 'movie' | 'series',
  id: string,
  hint: {videoHash?: string; videoSize?: number; filename?: string} = {},
): Promise<(StremioSubtitle & {addon: string})[]> => {
  const extra = [
    hint.videoHash ? `videoHash=${hint.videoHash}` : '',
    hint.videoSize ? `videoSize=${hint.videoSize}` : '',
    hint.filename ? `filename=${encodeURIComponent(hint.filename)}` : '',
  ].filter(Boolean).join('&');
  const addons = readAddons().filter(addon => addon.enabled && supports(addon.manifest, 'subtitles', type, id));
  const results = await Promise.all(
    addons.map(async addon => {
      try {
        const data = await getJson<{subtitles?: StremioSubtitle[]}>(`${addon.base}/subtitles/${type}/${encodeURIComponent(id)}${extra ? `/${extra}` : ''}.json`);
        return (data?.subtitles || []).map(sub => ({...sub, addon: addon.manifest.name}));
      } catch {
        return [];
      }
    }),
  );
  return results.flat();
};

// ---------------------------------------------------------------- Cinemeta
export const searchCinemeta = async (query: string, type: 'movie' | 'series'): Promise<StremioMeta[]> => {
  const data = await getJson<{metas?: StremioMeta[]}>(`${CINEMETA}/catalog/${type}/top/search=${encodeURIComponent(query)}.json`);
  return data?.metas || [];
};

/** Most popular titles, for everything or for one genre. */
export const fetchCatalog = async (type: 'movie' | 'series', genre?: string): Promise<StremioMeta[]> => {
  const path = genre ? `top/genre=${encodeURIComponent(genre)}` : 'top';
  const data = await getJson<{metas?: StremioMeta[]}>(`${CINEMETA}/catalog/${type}/${path}.json`);
  return (data?.metas || []).filter(meta => meta.poster);
};

export const fetchMeta = async (type: 'movie' | 'series', id: string): Promise<StremioMeta | undefined> => {
  const data = await getJson<{meta?: StremioMeta}>(`${CINEMETA}/meta/${type}/${encodeURIComponent(id)}.json`);
  return data?.meta;
};

const norm = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

const withoutArticle = (value: string) => value.replace(/^(the|a|an)\s+/, '');

/** Best Cinemeta match for a title and optional year. */
export const findImdb = async (title: string, type: 'movie' | 'series', year?: number): Promise<StremioMeta | undefined> => {
  const metas = await searchCinemeta(title, type);
  const want = norm(title);
  const scored = metas.map(meta => {
    const metaYear = Number(String(meta.releaseInfo || meta.year || '').slice(0, 4)) || undefined;
    const name = withoutArticle(norm(meta.name));
    let score = name === withoutArticle(want) ? 3 : name.startsWith(withoutArticle(want)) ? 1 : 0;
    // A matching year only helps a title whose name already matches.
    if (score && year && metaYear) score += metaYear === year ? 2 : Math.abs(metaYear - year) <= 1 ? 1 : -2;
    return {meta, score};
  });
  scored.sort((a, b) => b.score - a.score);
  // No match is better than the wrong title, because add-ons would answer for that title.
  return scored[0] && scored[0].score > 0 ? scored[0].meta : undefined;
};

/** Well-known public add-ons offered on the add-on screen. Each one is the user's choice. */
export const SUGGESTED_ADDONS = [
  {name: 'Torrentio', configure: 'https://torrentio.strem.fun/configure', manifest: 'https://torrentio.strem.fun/manifest.json', note: 'Torrent streams from many sites; add your debrid key on its Configure page'},
  {name: 'Comet', configure: 'https://comet.elfhosted.com/configure', manifest: '', note: 'Debrid-first streams; needs configuring'},
  {name: 'MediaFusion', configure: 'https://mediafusion.elfhosted.com/configure', manifest: '', note: 'Movies, series, sports; needs configuring'},
  {name: 'OpenSubtitles v3', configure: '', manifest: 'https://opensubtitles-v3.strem.io/manifest.json', note: 'Free subtitles, matched by file hash'},
  {name: 'Cinemeta', configure: '', manifest: 'https://v3-cinemeta.strem.io/manifest.json', note: 'Official titles, posters, and episode lists'},
];
