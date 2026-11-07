/**
 * Catalogs from installed Stremio add-ons, for rows on Home. Reads the
 * catalogs each manifest lists (with the genre and other filters it offers),
 * builds catalog URLs, and loads a row with a small cache.
 */
import {hasAdultWords, isAdultSource, isKidsSafe} from '../profiles/kids';
import type {IStorageService} from '../storage/StorageService';
import type {InstalledAddon, StremioCatalog, StremioMeta} from '../stremio';

export type CatalogType = 'movie' | 'series';

export interface CatalogFilter {
  /** Extra name, such as "genre" or "year". */
  name: string;
  options: string[];
  /** The add-on needs a value for this filter. */
  required: boolean;
}

export interface AddonCatalog {
  addonBase: string;
  addonName: string;
  /** The add-on is adult-flagged or adult-named. */
  adult: boolean;
  type: CatalogType;
  id: string;
  name: string;
  filters: CatalogFilter[];
}

/** Extras that are not filters: search needs typed text, skip is paging. */
const NOT_FILTERS = new Set(['search', 'skip']);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim()))] : [];

/**
 * The filters a catalog offers, or undefined when it cannot be a row: a
 * search-only catalog, or one that needs a value it gives no choices for.
 */
export const catalogFilters = (catalog: StremioCatalog): CatalogFilter[] | undefined => {
  const byName = new Map<string, CatalogFilter>();
  const add = (name: string, options: string[], required: boolean) => {
    const existing = byName.get(name);
    if (existing) {
      existing.required ||= required;
      existing.options = [...new Set([...existing.options, ...options])];
    } else {
      byName.set(name, {name, options, required});
    }
  };
  for (const extra of Array.isArray(catalog.extra) ? catalog.extra : []) {
    if (extra && typeof extra.name === 'string') add(extra.name, strings(extra.options), extra.isRequired === true);
  }
  // The older manifest form.
  const required = strings(catalog.extraRequired);
  for (const name of strings(catalog.extraSupported)) add(name, [], required.includes(name));
  for (const name of required) add(name, [], true);
  const genres = strings(catalog.genres);
  if (genres.length) add('genre', genres, required.includes('genre'));

  const filters: CatalogFilter[] = [];
  for (const filter of byName.values()) {
    if (NOT_FILTERS.has(filter.name)) {
      if (filter.required && filter.name === 'search') return undefined;
      continue;
    }
    if (!filter.options.length) {
      if (filter.required) return undefined;
      continue;
    }
    filters.push(filter);
  }
  return filters;
};

export const isAdultAddon = (addon: InstalledAddon): boolean =>
  isAdultSource({name: addon.manifest?.name, adult: addon.manifest?.behaviorHints?.adult});

/** Movie and series catalogs of one add-on that can be rows. */
export const parseManifestCatalogs = (addon: InstalledAddon): AddonCatalog[] => {
  const manifest = addon.manifest;
  if (!manifest || !Array.isArray(manifest.catalogs)) return [];
  const adult = isAdultAddon(addon);
  const seen = new Set<string>();
  const result: AddonCatalog[] = [];
  for (const catalog of manifest.catalogs) {
    if (!catalog || typeof catalog.id !== 'string' || !catalog.id) continue;
    if (catalog.type !== 'movie' && catalog.type !== 'series') continue;
    const key = `${catalog.type}/${catalog.id}`;
    if (seen.has(key)) continue;
    const filters = catalogFilters(catalog);
    if (!filters) continue;
    seen.add(key);
    result.push({
      addonBase: addon.base,
      addonName: manifest.name || manifest.id,
      adult,
      type: catalog.type,
      id: catalog.id,
      name: catalog.name?.trim() || catalog.id,
      filters,
    });
  }
  return result;
};

/** Every catalog the enabled add-ons offer. A kids profile skips adult add-ons. */
export const listAddonCatalogs = (addons: InstalledAddon[], {kids = false}: {kids?: boolean} = {}): AddonCatalog[] =>
  addons.filter(addon => addon.enabled && !(kids && isAdultAddon(addon))).flatMap(parseManifestCatalogs);

/** Whether the filter values chosen are allowed: every required one set, values from the list. */
export const validExtra = (catalog: Pick<AddonCatalog, 'filters'>, extra: Record<string, string> = {}): boolean =>
  catalog.filters.every(filter => (extra[filter.name] ? filter.options.includes(extra[filter.name]) : !filter.required)) &&
  Object.keys(extra).every(name => catalog.filters.some(filter => filter.name === name));

/** "/catalog/movie/top/genre=Action.json" */
export const catalogPath = (type: string, id: string, extra: Record<string, string> = {}): string => {
  const parts = Object.entries(extra)
    .filter(([, value]) => value)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  return `/catalog/${encodeURIComponent(type)}/${encodeURIComponent(id)}${parts.length ? `/${parts.join('&')}` : ''}.json`;
};

/** What a row keeps of each title: enough to draw a poster and open it. */
export interface RowItem {
  id: string;
  type: CatalogType;
  name: string;
  poster: string;
  year?: number;
  imdbId?: string;
  tmdbId?: string;
  /** Hidden on a kids profile. */
  adult?: boolean;
}

/** Titles kept per row. Low-memory devices keep fewer. */
export const ROW_ITEM_LIMIT = 20;
export const LOW_MEMORY_ROW_ITEM_LIMIT = 12;

type CatalogMeta = StremioMeta & {imdb_id?: string; certification?: string; adult?: boolean};

export const toRowItem = (meta: CatalogMeta, fallbackType: CatalogType): RowItem | undefined => {
  if (!meta || typeof meta.id !== 'string' || typeof meta.name !== 'string' || !meta.poster) return undefined;
  const type: CatalogType = meta.type === 'movie' || meta.type === 'series' ? meta.type : fallbackType;
  const imdbId = /^tt\d+$/.test(meta.id) ? meta.id : meta.imdb_id && /^tt\d+$/.test(meta.imdb_id) ? meta.imdb_id : undefined;
  const tmdbMatch = /^tmdb:(\d+)$/.exec(meta.id);
  const tmdbId = tmdbMatch?.[1] ?? (meta.moviedb_id ? String(meta.moviedb_id) : undefined);
  const year = Number(String(meta.releaseInfo || meta.year || '').slice(0, 4)) || undefined;
  const adult =
    !isKidsSafe({adult: meta.adult, certification: meta.certification, genres: meta.genres}) || hasAdultWords(meta.name);
  return {
    id: meta.id,
    type,
    name: meta.name,
    poster: meta.poster,
    ...(year ? {year} : {}),
    ...(imdbId ? {imdbId} : {}),
    ...(tmdbId ? {tmdbId} : {}),
    ...(adult ? {adult} : {}),
  };
};

/** Catalog answer to row items: with posters, no repeats, at most [limit]. */
export const toRowItems = (metas: unknown, type: CatalogType, limit = ROW_ITEM_LIMIT): RowItem[] => {
  if (!Array.isArray(metas)) return [];
  const seen = new Set<string>();
  const items: RowItem[] = [];
  for (const meta of metas) {
    if (items.length >= limit) break;
    const item = toRowItem(meta, type);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
};

/** A kids profile hides adult titles. */
export const itemsForProfile = (items: RowItem[], kids: boolean): RowItem[] =>
  kids ? items.filter(item => !item.adult) : items;

export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

/** Short stable cache key; configured add-on URLs can be long and hold settings. */
export const catalogCacheKey = (base: string, type: string, id: string, extra: Record<string, string> = {}): string => {
  const text = `${base}${catalogPath(type, id, extra)}`;
  let hash = 5381;
  for (let index = 0; index < text.length; index++) hash = (hash * 33 + text.charCodeAt(index)) % 2147483647;
  return `addonRow.v1.${hash.toString(36)}.${text.length.toString(36)}`;
};

interface CachedRow {
  at: number;
  items: RowItem[];
}

export interface LoadRowOptions {
  store: Pick<IStorageService, 'getString' | 'setString'>;
  now?: number;
  limit?: number;
  signal?: AbortSignal;
  fetchJson?: (url: string, signal?: AbortSignal) => Promise<unknown>;
}

const defaultFetchJson = async (url: string, signal?: AbortSignal): Promise<unknown> => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  const timer = setTimeout(abort, 20000);
  try {
    const response = await fetch(url, {signal: controller.signal, headers: {Accept: 'application/json'}});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
};

/**
 * A row's titles: from the cache when under 6 hours old, else from the
 * add-on. When the add-on fails, older cached titles are used if there are any.
 */
export const loadCatalogRow = async (
  row: {addonBase: string; type: CatalogType; catalogId: string; extra?: Record<string, string>},
  {store, now = Date.now(), limit = ROW_ITEM_LIMIT, signal, fetchJson = defaultFetchJson}: LoadRowOptions,
): Promise<RowItem[]> => {
  const key = catalogCacheKey(row.addonBase, row.type, row.catalogId, row.extra);
  let cached: CachedRow | undefined;
  try {
    const parsed = JSON.parse(store.getString(key) || 'null');
    if (parsed && typeof parsed.at === 'number' && Array.isArray(parsed.items)) cached = parsed;
  } catch {}
  if (cached && cached.at <= now && now - cached.at < CATALOG_TTL_MS) return cached.items.slice(0, limit);
  try {
    const data = (await fetchJson(`${row.addonBase}${catalogPath(row.type, row.catalogId, row.extra)}`, signal)) as {metas?: unknown};
    const items = toRowItems(data?.metas, row.type, limit);
    try {
      store.setString(key, JSON.stringify({at: now, items}));
    } catch {}
    return items;
  } catch (error) {
    if (cached && !signal?.aborted) return cached.items.slice(0, limit);
    throw error;
  }
};
