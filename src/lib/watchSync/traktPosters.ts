/**
 * Posters for the "Continue on Trakt" row. Trakt sends no images, so the
 * poster is looked up by IMDb id in Cinemeta, or by TMDB id with the
 * viewer's own TMDB key when Cinemeta has none. Found posters are cached.
 */
import {fetchMeta} from '../stremio';
import {settingsStorage} from '../storage';
import {cacheStorage} from '../storage/StorageService';
import type {TraktPlaybackItem} from './traktProgress';

const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedPoster {
  at: number;
  url?: string;
}

const keyOf = (item: Pick<TraktPlaybackItem, 'type' | 'imdbId' | 'tmdbId'>) =>
  item.imdbId ? `trakt-poster:${item.imdbId}` : item.tmdbId ? `trakt-poster:${item.type}:tmdb:${item.tmdbId}` : undefined;

/** The cached poster, '' when none was found lately, undefined when not looked up yet. */
export const cachedTraktPoster = (item: Pick<TraktPlaybackItem, 'type' | 'imdbId' | 'tmdbId'>, now = Date.now()): string | undefined => {
  const key = keyOf(item);
  const entry = key ? cacheStorage.getObject<CachedPoster>(key) : undefined;
  if (!entry || typeof entry.at !== 'number') return undefined;
  if (now - entry.at > (entry.url ? FOUND_TTL_MS : EMPTY_TTL_MS)) return undefined;
  return entry.url || '';
};

const fromTmdb = async (type: 'movie' | 'series', tmdbId: string): Promise<string | undefined> => {
  const key = settingsStorage.getTmdbApiKey();
  if (!key) return undefined;
  const response = await fetch(`https://api.themoviedb.org/3/${type === 'movie' ? 'movie' : 'tv'}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(key)}`, {
    headers: {Accept: 'application/json'},
  });
  if (!response.ok) return undefined;
  const path = (await response.json())?.poster_path;
  return typeof path === 'string' && path ? `https://image.tmdb.org/t/p/w342${path}` : undefined;
};

/** Looks up a poster for a Trakt row. Undefined when none was found. */
export const findTraktPoster = async (item: Pick<TraktPlaybackItem, 'type' | 'imdbId' | 'tmdbId'>): Promise<string | undefined> => {
  const cached = cachedTraktPoster(item);
  if (cached !== undefined) return cached || undefined;
  const key = keyOf(item);
  if (!key) return undefined;
  let url: string | undefined;
  try {
    if (item.imdbId) url = (await fetchMeta(item.type, item.imdbId))?.poster || undefined;
  } catch {
    // Try TMDB.
  }
  try {
    if (!url && item.tmdbId) url = await fromTmdb(item.type, item.tmdbId);
  } catch {
    // No poster; the card shows the title.
  }
  cacheStorage.setObject<CachedPoster>(key, {at: Date.now(), ...(url ? {url} : {})});
  return url;
};
