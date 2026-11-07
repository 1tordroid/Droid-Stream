/**
 * Title ratings from sources the app may use: OMDb (IMDb, Rotten Tomatoes
 * critics and Metacritic), Cinemeta's IMDb rating, and TMDB's user score.
 * Nothing here reads the IMDb, Rotten Tomatoes or Metacritic websites.
 * Pure functions, so merging and fallbacks can be tested.
 */
import type {OMDBTitle} from '../../types/omdb';

export type RatingId = 'imdb' | 'rt' | 'rtAudience' | 'metacritic' | 'tmdb';

export const RATING_IDS: RatingId[] = ['imdb', 'rt', 'rtAudience', 'metacritic', 'tmdb'];

/** What one source returned. Scores: IMDb and TMDB out of 10, the rest out of 100. */
export interface SourceRatings {
  imdb?: number;
  imdbVotes?: number;
  rt?: number;
  rtAudience?: number;
  metacritic?: number;
  tmdb?: number;
  tmdbVotes?: number;
}

export interface TitleRatings extends SourceRatings {
  /** Where the IMDb rating came from. */
  imdbFrom?: 'omdb' | 'cinemeta';
}

const present = (value?: string | null): string | undefined => {
  const text = value?.trim();
  return text && text.toUpperCase() !== 'N/A' ? text : undefined;
};

/** "7.8", "7.8/10" -> 7.8. Out-of-range values are dropped. */
export const parseTenScale = (value?: string | number | null): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 && value <= 10 ? Math.round(value * 10) / 10 : undefined;
  const text = present(value);
  if (!text) return undefined;
  const number = Number(text.replace(/\s*\/\s*10$/, ''));
  return Number.isFinite(number) && number > 0 && number <= 10 ? Math.round(number * 10) / 10 : undefined;
};

/** "91%", "74/100", "74" -> 91, 74, 74. */
export const parseHundredScale = (value?: string | number | null): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : undefined;
  const text = present(value);
  if (!text) return undefined;
  const number = Number(text.replace(/%$/, '').replace(/\s*\/\s*100$/, ''));
  return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number) : undefined;
};

/** "1,234,567" -> 1234567. */
export const parseVotes = (value?: string | number | null): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
  const text = present(value);
  if (!text) return undefined;
  const number = Number(text.replace(/[,\s]/g, ''));
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

/** IMDb, Rotten Tomatoes and Metacritic from an OMDb title. */
export const parseOmdb = (data?: OMDBTitle | null): SourceRatings => {
  if (!data) return {};
  const fromList = (source: string) => data.Ratings?.find(item => item.Source === source)?.Value;
  const result: SourceRatings = {
    imdb: parseTenScale(data.imdbRating) ?? parseTenScale(fromList('Internet Movie Database')),
    imdbVotes: parseVotes(data.imdbVotes),
    rt: parseHundredScale(fromList('Rotten Tomatoes')) ?? parseHundredScale(data.tomatoMeter),
    rtAudience: parseHundredScale(data.tomatoUserMeter),
    metacritic: parseHundredScale(data.Metascore) ?? parseHundredScale(fromList('Metacritic')),
  };
  return compact(result);
};

/** TMDB's user score from a details or find result. */
export const parseTmdb = (data?: {vote_average?: number; vote_count?: number} | null): SourceRatings => {
  if (!data || !data.vote_count) return {};
  return compact({tmdb: parseTenScale(data.vote_average), tmdbVotes: parseVotes(data.vote_count)});
};

const compact = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

/**
 * One set of ratings. OMDb wins for IMDb (it has the vote count); Cinemeta's
 * IMDb rating fills in when OMDb has none. TMDB is kept for the fallback.
 */
export const mergeRatings = (sources: {omdb?: SourceRatings; cinemeta?: number; tmdb?: SourceRatings}): TitleRatings => {
  const {omdb = {}, cinemeta, tmdb = {}} = sources;
  const result: TitleRatings = {...tmdb, ...omdb};
  if (omdb.imdb !== undefined) result.imdbFrom = 'omdb';
  else if (cinemeta !== undefined) {
    result.imdb = cinemeta;
    result.imdbFrom = 'cinemeta';
    delete result.imdbVotes;
  }
  return compact(result);
};

/** Which badges to show. */
export type RatingPrefs = Record<RatingId, boolean>;

export const DEFAULT_RATING_PREFS: RatingPrefs = {imdb: true, rt: true, rtAudience: true, metacritic: true, tmdb: true};

export interface RatingBadge {
  id: RatingId;
  label: string;
  value: string;
  /** Votes or a short note, such as "1.2M votes". */
  detail?: string;
  /** Out of 100, for colouring. */
  percent: number;
  /** Spoken by screen readers. */
  accessibilityLabel: string;
}

/** 1234 -> "1.2K", 1234567 -> "1.2M". */
export const formatVotes = (votes?: number): string | undefined => {
  if (!votes) return undefined;
  if (votes >= 1e6) return `${(votes / 1e6).toFixed(votes >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (votes >= 1e3) return `${(votes / 1e3).toFixed(votes >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(votes);
};

/**
 * Badges in a fixed order: IMDb, Rotten Tomatoes, audience, Metacritic.
 * TMDB is the fallback: it shows only when no IMDb badge does.
 */
export const ratingBadges = (ratings: TitleRatings | undefined, prefs: RatingPrefs = DEFAULT_RATING_PREFS): RatingBadge[] => {
  if (!ratings) return [];
  const badges: RatingBadge[] = [];
  if (prefs.imdb && ratings.imdb !== undefined) {
    const votes = formatVotes(ratings.imdbVotes);
    badges.push({
      id: 'imdb', label: 'IMDb', value: ratings.imdb.toFixed(1), detail: votes, percent: ratings.imdb * 10,
      accessibilityLabel: `IMDb ${ratings.imdb.toFixed(1)} out of 10${votes ? `, ${votes} votes` : ''}`,
    });
  }
  if (prefs.rt && ratings.rt !== undefined) {
    badges.push({id: 'rt', label: 'Rotten Tomatoes', value: `${ratings.rt}%`, percent: ratings.rt, accessibilityLabel: `Rotten Tomatoes critics ${ratings.rt} percent`});
  }
  if (prefs.rtAudience && ratings.rtAudience !== undefined) {
    badges.push({id: 'rtAudience', label: 'Audience', value: `${ratings.rtAudience}%`, percent: ratings.rtAudience, accessibilityLabel: `Rotten Tomatoes audience ${ratings.rtAudience} percent`});
  }
  if (prefs.metacritic && ratings.metacritic !== undefined) {
    badges.push({id: 'metacritic', label: 'Metacritic', value: String(ratings.metacritic), percent: ratings.metacritic, accessibilityLabel: `Metacritic ${ratings.metacritic} out of 100`});
  }
  if (prefs.tmdb && ratings.tmdb !== undefined && !badges.some(badge => badge.id === 'imdb')) {
    const votes = formatVotes(ratings.tmdbVotes);
    badges.push({
      id: 'tmdb', label: 'TMDB', value: ratings.tmdb.toFixed(1), detail: votes, percent: ratings.tmdb * 10,
      accessibilityLabel: `TMDB ${ratings.tmdb.toFixed(1)} out of 10${votes ? `, ${votes} votes` : ''}`,
    });
  }
  return badges;
};
