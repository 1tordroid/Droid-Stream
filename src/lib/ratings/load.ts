/**
 * Loads a title's ratings and keeps each source's answer for 7 days.
 * A source that failed (OMDb's daily limit, no network) is tried again after
 * 12 hours, or right away once a new OMDb key is saved.
 */
import {cacheStorage} from '../storage/StorageService';
import type {IStorageService} from '../storage/StorageService';
import {fetchOmdbTitle} from '../services/omdb';
import {fetchMeta} from '../stremio';
import {getTmdbApiKey} from '../hooks/useTmdbStory';
import type {OMDBTitle} from '../../types/omdb';
import {mergeRatings, parseOmdb, parseTenScale, parseTmdb, type SourceRatings, type TitleRatings} from './ratings';

export const RATINGS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RATINGS_RETRY_MS = 12 * 60 * 60 * 1000;

export interface SourceEntry {
  at: number;
  ok: boolean;
  data?: SourceRatings;
}

export interface RatingsCacheEntry {
  omdb?: SourceEntry;
  cinemeta?: SourceEntry;
  tmdb?: SourceEntry;
}

export interface RatingsTitle {
  imdbId?: string;
  tmdbId?: number | string;
  /** "movie", "series", "tv"… */
  type?: string;
  /** Cinemeta's IMDb rating when the page already has it. */
  cinemetaRating?: string;
}

export interface RatingFetchers {
  omdb: (imdbId: string, signal?: AbortSignal) => Promise<OMDBTitle>;
  cinemeta: (type: 'movie' | 'series', imdbId: string) => Promise<string | undefined>;
  /** undefined when TMDB cannot be asked (no key). */
  tmdb: (title: {imdbId?: string; tmdbId?: number | string; mediaType: 'movie' | 'tv'}, signal?: AbortSignal) => Promise<{vote_average?: number; vote_count?: number} | null | undefined>;
}

export interface LoadOptions {
  store?: Pick<IStorageService, 'getString' | 'setString'>;
  now?: number;
  signal?: AbortSignal;
  fetchers?: RatingFetchers;
  /** 'fallback': ask TMDB only when there is no IMDb rating. */
  tmdb?: 'never' | 'fallback' | 'always';
  /** OMDb lookups that failed before this time are tried again. */
  retryFailedSince?: number;
}

const isImdbId = (id?: string): id is string => Boolean(id && /^tt\d+$/.test(id));

export const mediaTypeOf = (type?: string): 'movie' | 'tv' =>
  /^(series|tv|show|anime)$/i.test(type || '') ? 'tv' : 'movie';

/** One cache entry per title: by IMDb id, or by TMDB id when that is all there is. */
export const ratingsCacheKey = (title: RatingsTitle): string | undefined =>
  isImdbId(title.imdbId)
    ? `ratings.v1.${title.imdbId}`
    : title.tmdbId
      ? `ratings.v1.tmdb.${mediaTypeOf(title.type)}.${title.tmdbId}`
      : undefined;

export const isFresh = (entry: SourceEntry | undefined, now: number, retryFailedSince = 0): entry is SourceEntry => {
  if (!entry || entry.at > now) return false;
  if (!entry.ok && entry.at < retryFailedSince) return false;
  return now - entry.at < (entry.ok ? RATINGS_TTL_MS : RATINGS_RETRY_MS);
};

export const readRatingsCache = (store: Pick<IStorageService, 'getString'>, key: string): RatingsCacheEntry => {
  try {
    const parsed = JSON.parse(store.getString(key) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const isAbort = (error: unknown, signal?: AbortSignal) =>
  signal?.aborted || (error as {name?: string})?.name === 'AbortError';

const TMDB_API_URL = 'https://api.themoviedb.org/3';

export const defaultRatingFetchers = (omdbKey?: string): RatingFetchers => ({
  omdb: (imdbId, signal) => fetchOmdbTitle(imdbId, omdbKey, signal),
  cinemeta: async (type, imdbId) => (await fetchMeta(type, imdbId))?.imdbRating,
  tmdb: async ({imdbId, tmdbId, mediaType}, signal) => {
    const apiKey = getTmdbApiKey();
    if (!apiKey) return undefined;
    const key = encodeURIComponent(apiKey);
    if (tmdbId) {
      const response = await fetch(`${TMDB_API_URL}/${mediaType}/${encodeURIComponent(String(tmdbId))}?api_key=${key}`, {signal});
      if (!response.ok) throw new Error(`TMDB ${response.status}`);
      return response.json();
    }
    if (!isImdbId(imdbId)) return undefined;
    const response = await fetch(`${TMDB_API_URL}/find/${imdbId}?api_key=${key}&external_source=imdb_id`, {signal});
    if (!response.ok) throw new Error(`TMDB ${response.status}`);
    const found = await response.json();
    const list = mediaType === 'tv' ? [found?.tv_results, found?.movie_results] : [found?.movie_results, found?.tv_results];
    return list.find(items => Array.isArray(items) && items.length)?.[0] ?? null;
  },
});

/**
 * Ratings for one title: OMDb first, Cinemeta when OMDb has no IMDb rating,
 * TMDB as the last fallback. Each source is cached on its own.
 */
export const loadTitleRatings = async (title: RatingsTitle, options: LoadOptions = {}): Promise<TitleRatings> => {
  const {store = cacheStorage, now = Date.now(), signal, fetchers = defaultRatingFetchers(), tmdb = 'fallback', retryFailedSince = 0} = options;
  const key = ratingsCacheKey(title);
  if (!key) return mergeRatings({cinemeta: parseTenScale(title.cinemetaRating)});
  const cached = readRatingsCache(store, key);
  const next: RatingsCacheEntry = {...cached};
  let changed = false;

  const run = async (source: keyof RatingsCacheEntry, load: () => Promise<SourceRatings | null>) => {
    try {
      const data = await load();
      if (data === null) return;
      next[source] = {at: now, ok: true, data};
      changed = true;
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      // Keep the last good answer until the retry time; it beats nothing.
      next[source] = cached[source]?.ok ? {...cached[source]!, at: now - RATINGS_TTL_MS + RATINGS_RETRY_MS} : {at: now, ok: false};
      changed = true;
    }
  };

  const imdbId = isImdbId(title.imdbId) ? title.imdbId : undefined;
  if (imdbId && !isFresh(cached.omdb, now, retryFailedSince)) {
    await run('omdb', async () => parseOmdb(await fetchers.omdb(imdbId, signal)));
  }

  const hint = parseTenScale(title.cinemetaRating);
  if (imdbId && hint === undefined && next.omdb?.data?.imdb === undefined && !isFresh(cached.cinemeta, now)) {
    const type = mediaTypeOf(title.type) === 'tv' ? 'series' : 'movie';
    await run('cinemeta', async () => {
      const imdb = parseTenScale(await fetchers.cinemeta(type, imdbId));
      return imdb === undefined ? {} : {imdb};
    });
  }
  const cinemeta = hint ?? next.cinemeta?.data?.imdb;

  const hasImdb = next.omdb?.data?.imdb !== undefined || cinemeta !== undefined;
  const wantTmdb = tmdb === 'always' || (tmdb === 'fallback' && !hasImdb);
  if (wantTmdb && (title.tmdbId || imdbId) && !isFresh(cached.tmdb, now)) {
    await run('tmdb', async () => {
      const data = await fetchers.tmdb({imdbId, tmdbId: title.tmdbId, mediaType: mediaTypeOf(title.type)}, signal);
      // No TMDB key: nothing to cache, so a key added later is used at once.
      return data === undefined ? null : parseTmdb(data);
    });
  }

  if (changed) {
    try {
      store.setString(key, JSON.stringify(next));
    } catch {}
  }
  return mergeRatings({omdb: next.omdb?.data, cinemeta, tmdb: wantTmdb ? next.tmdb?.data : undefined});
};
