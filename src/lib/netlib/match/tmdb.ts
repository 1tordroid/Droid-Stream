import type {NetlibMatch} from '../types';
import type {MatchCandidate} from './score';

const API = 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p';

/** TMDB answered 429; wait this long before asking again. */
export class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super('TMDB rate limit');
    this.name = 'RateLimitError';
  }
}

export interface TmdbCandidate extends MatchCandidate {
  id: number;
  type: 'movie' | 'series';
  poster?: string;
  background?: string;
  overview?: string;
  rating?: string;
}

const get = async (path: string, params: Record<string, string | number | undefined>, key: string, signal?: AbortSignal) => {
  const query = Object.entries({...params, api_key: key})
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`)
    .join('&');
  const response = await fetch(`${API}${path}?${query}`, {signal, headers: {Accept: 'application/json'}});
  if (response.status === 429) {
    const seconds = Number(response.headers?.get?.('Retry-After'));
    throw new RateLimitError(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2000);
  }
  if (!response.ok) throw new Error(`TMDB answered ${response.status}`);
  return response.json();
};

const yearOf = (date?: string) => Number(String(date || '').slice(0, 4)) || undefined;

const toCandidate = (raw: any, type: 'movie' | 'series'): TmdbCandidate => ({
  id: raw.id,
  type,
  title: raw.title || raw.name || '',
  originalTitle: raw.original_title || raw.original_name,
  year: yearOf(raw.release_date || raw.first_air_date),
  popularity: raw.popularity,
  poster: raw.poster_path ? `${IMAGE}/w342${raw.poster_path}` : undefined,
  background: raw.backdrop_path ? `${IMAGE}/w1280${raw.backdrop_path}` : undefined,
  overview: raw.overview || undefined,
  rating: typeof raw.vote_average === 'number' && raw.vote_count > 0 ? raw.vote_average.toFixed(1) : undefined,
});

/**
 * /search/movie with primary_release_year, or /search/tv with
 * first_air_date_year. Without results for the year, asks once more without it.
 */
export const searchTmdb = async (
  type: 'movie' | 'series',
  title: string,
  year: number | undefined,
  key: string,
  signal?: AbortSignal,
): Promise<TmdbCandidate[]> => {
  const path = type === 'movie' ? '/search/movie' : '/search/tv';
  const yearParam = type === 'movie' ? 'primary_release_year' : 'first_air_date_year';
  const ask = async (withYear: boolean) =>
    ((await get(path, {query: title, include_adult: 'false', ...(withYear && year ? {[yearParam]: year} : {})}, key, signal))?.results || []).map(
      (raw: any) => toCandidate(raw, type),
    ) as TmdbCandidate[];
  const results = await ask(true);
  return results.length || !year ? results : ask(false);
};

/** A title by its TMDB id, for an id tag in a file or folder name. */
export const fetchTmdbById = async (type: 'movie' | 'series', id: number, key: string, signal?: AbortSignal): Promise<TmdbCandidate | undefined> => {
  const raw = await get(`/${type === 'movie' ? 'movie' : 'tv'}/${id}`, {}, key, signal);
  return raw?.id ? toCandidate(raw, type) : undefined;
};

export const candidateToMatch = (candidate: TmdbCandidate): NetlibMatch => ({
  type: candidate.type,
  title: candidate.title,
  ...(candidate.year ? {year: candidate.year} : {}),
  tmdbId: candidate.id,
  ...(candidate.poster ? {poster: candidate.poster} : {}),
  ...(candidate.background ? {background: candidate.background} : {}),
  ...(candidate.overview ? {overview: candidate.overview} : {}),
  ...(candidate.rating ? {rating: candidate.rating} : {}),
});
