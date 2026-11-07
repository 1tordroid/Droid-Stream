import {getCachedMatch, setCachedMatch} from '../cache';
import {normalizeTitle} from '../ids';
import type {NetlibItem, NetlibMatch} from '../types';
import {cinemetaById, matchCinemeta} from './cinemeta';
import {pickBest} from './score';
import {candidateToMatch, fetchTmdbById, RateLimitError, searchTmdb} from './tmdb';

/** Requests in flight at once. */
export const MATCH_CONCURRENCY = 4;
const MAX_RETRIES = 3;

const typeOf = (item: NetlibItem): 'movie' | 'series' => (item.kind === 'show' ? 'series' : 'movie');

/** What a lookup is cached under: the same title and year on any source is one lookup. */
export const matchCacheKey = (item: NetlibItem): string =>
  item.tmdbId
    ? `tmdb:${typeOf(item)}:${item.tmdbId}`
    : item.imdbId
      ? `imdb:${typeOf(item)}:${item.imdbId}`
      : `${typeOf(item)}:${normalizeTitle(item.title)}:${item.kind === 'show' ? '' : item.year || ''}`;

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });

/** Runs a request again after a 429, waiting longer each time. */
export const withBackoff = async <T>(run: () => Promise<T>, signal?: AbortSignal, sleep = wait): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof RateLimitError) || attempt >= MAX_RETRIES) throw error;
      await sleep(Math.max(error.retryAfterMs, 1000 * 2 ** attempt), signal);
    }
  }
};

/**
 * One title's match: its id tag first, then a TMDB search with the year when a
 * key is set, else Cinemeta. Undefined when nothing scores high enough.
 */
export const lookupMatch = async (item: NetlibItem, tmdbKey: string, signal?: AbortSignal): Promise<NetlibMatch | undefined> => {
  const type = typeOf(item);
  if (item.tmdbId && tmdbKey) {
    const found = await withBackoff(() => fetchTmdbById(type, item.tmdbId!, tmdbKey, signal), signal);
    if (found) return candidateToMatch(found);
  }
  if (item.imdbId) {
    const found = await cinemetaById(item.imdbId, type);
    if (found) return found;
  }
  if (tmdbKey) {
    const candidates = await withBackoff(() => searchTmdb(type, item.title, item.year, tmdbKey, signal), signal);
    const best = pickBest({title: item.title, year: item.year}, candidates);
    return best ? candidateToMatch(best) : undefined;
  }
  return matchCinemeta(item.title, type, item.year);
};

/**
 * Matches titles that have no match yet, four at a time, through the cache.
 * A title the user fixed by hand is never looked up again. Calls onMatch as
 * each answer comes in; network failures leave the title unmatched and
 * uncached so the next scan tries again.
 */
export const matchItems = async (
  items: NetlibItem[],
  options: {tmdbKey: string; signal?: AbortSignal; onMatch: (id: string, match: NetlibMatch | undefined) => void; now?: number},
): Promise<void> => {
  const queue = items.filter(item => !item.match?.manual && item.kind !== 'other');
  let next = 0;
  const worker = async () => {
    while (next < queue.length && !options.signal?.aborted) {
      const item = queue[next++];
      const key = matchCacheKey(item);
      const cached = getCachedMatch(key, options.now);
      if (cached !== undefined) {
        options.onMatch(item.id, cached || undefined);
        continue;
      }
      try {
        const match = await lookupMatch(item, options.tmdbKey, options.signal);
        setCachedMatch(key, match, options.now);
        options.onMatch(item.id, match);
      } catch {
        // Offline or the service failed: try again on the next scan.
      }
    }
  };
  await Promise.all(Array.from({length: Math.min(MATCH_CONCURRENCY, queue.length)}, worker));
};
