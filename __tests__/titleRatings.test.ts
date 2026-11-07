import {
  formatVotes,
  mergeRatings,
  parseHundredScale,
  parseOmdb,
  parseTenScale,
  parseTmdb,
  ratingBadges,
  DEFAULT_RATING_PREFS,
} from '../src/lib/ratings/ratings';
import {
  isFresh,
  loadTitleRatings,
  ratingsCacheKey,
  RATINGS_RETRY_MS,
  RATINGS_TTL_MS,
  type RatingFetchers,
} from '../src/lib/ratings/load';
import type {OMDBTitle} from '../src/types/omdb';
import {withCinemetaHint} from '../src/lib/ratings/useTitleRatings';
import useRatingSettings, {readRatingSettings} from '../src/lib/ratings/settings';

const OMDB: OMDBTitle = {
  Response: 'True',
  imdbRating: '8.8',
  imdbVotes: '2,512,345',
  Metascore: '74',
  Ratings: [
    {Source: 'Internet Movie Database', Value: '8.8/10'},
    {Source: 'Rotten Tomatoes', Value: '87%'},
    {Source: 'Metacritic', Value: '74/100'},
  ],
};

const memoryStore = () => {
  const values = new Map<string, string>();
  return {
    values,
    getString: (key: string) => values.get(key),
    setString: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

const fetchers = (overrides: Partial<RatingFetchers> = {}): RatingFetchers & {[K in keyof RatingFetchers]: jest.Mock} => ({
  omdb: jest.fn(async () => OMDB),
  cinemeta: jest.fn(async () => '8.7'),
  tmdb: jest.fn(async () => ({vote_average: 8.364, vote_count: 35000})),
  ...overrides,
}) as any;

describe('rating parsing', () => {
  it('reads the scales and drops N/A', () => {
    expect(parseTenScale('7.8/10')).toBe(7.8);
    expect(parseTenScale('N/A')).toBeUndefined();
    expect(parseTenScale('11')).toBeUndefined();
    expect(parseTenScale(8.364)).toBe(8.4);
    expect(parseHundredScale('91%')).toBe(91);
    expect(parseHundredScale('74/100')).toBe(74);
    expect(parseHundredScale('N/A')).toBeUndefined();
  });

  it('reads IMDb, Rotten Tomatoes and Metacritic from OMDb', () => {
    expect(parseOmdb(OMDB)).toEqual({imdb: 8.8, imdbVotes: 2512345, rt: 87, metacritic: 74});
  });

  it('falls back to the Ratings list when the top-level fields are missing', () => {
    expect(parseOmdb({Response: 'True', imdbRating: 'N/A', Metascore: 'N/A', Ratings: OMDB.Ratings})).toEqual({imdb: 8.8, rt: 87, metacritic: 74});
  });

  it('keeps the audience score only when OMDb has it', () => {
    expect(parseOmdb({...OMDB, tomatoUserMeter: '93'}).rtAudience).toBe(93);
    expect(parseOmdb({...OMDB, tomatoUserMeter: 'N/A'}).rtAudience).toBeUndefined();
  });

  it('ignores a TMDB score with no votes', () => {
    expect(parseTmdb({vote_average: 0, vote_count: 0})).toEqual({});
    expect(parseTmdb({vote_average: 7.25, vote_count: 120})).toEqual({tmdb: 7.3, tmdbVotes: 120});
  });
});

describe('rating merging', () => {
  it('prefers OMDb for IMDb and keeps its votes', () => {
    const merged = mergeRatings({omdb: parseOmdb(OMDB), cinemeta: 8.7});
    expect(merged).toMatchObject({imdb: 8.8, imdbVotes: 2512345, imdbFrom: 'omdb'});
  });

  it('uses Cinemeta when OMDb has no IMDb score', () => {
    expect(mergeRatings({omdb: {rt: 50}, cinemeta: 6.1})).toEqual({imdb: 6.1, imdbFrom: 'cinemeta', rt: 50});
  });

  it('shows TMDB only when no IMDb badge shows', () => {
    const withImdb = ratingBadges(mergeRatings({omdb: parseOmdb(OMDB), tmdb: {tmdb: 8.4}}));
    expect(withImdb.map(badge => badge.id)).toEqual(['imdb', 'rt', 'metacritic']);
    const tmdbOnly = ratingBadges(mergeRatings({tmdb: {tmdb: 8.4, tmdbVotes: 35000}}));
    expect(tmdbOnly).toEqual([expect.objectContaining({id: 'tmdb', value: '8.4', detail: '35K'})]);
    const imdbHidden = ratingBadges(mergeRatings({omdb: parseOmdb(OMDB), tmdb: {tmdb: 8.4}}), {...DEFAULT_RATING_PREFS, imdb: false});
    expect(imdbHidden.map(badge => badge.id)).toEqual(['rt', 'metacritic', 'tmdb']);
  });

  it('follows the chosen ratings', () => {
    const badges = ratingBadges(mergeRatings({omdb: parseOmdb(OMDB)}), {...DEFAULT_RATING_PREFS, rt: false, metacritic: false});
    expect(badges.map(badge => badge.id)).toEqual(['imdb']);
    expect(badges[0]).toMatchObject({value: '8.8', detail: '2.5M'});
  });

  it('formats vote counts', () => {
    expect(formatVotes(999)).toBe('999');
    expect(formatVotes(1234)).toBe('1.2K');
    expect(formatVotes(56789)).toBe('57K');
    expect(formatVotes(1000000)).toBe('1M');
    expect(formatVotes(undefined)).toBeUndefined();
  });
});

describe('rating cache and fallbacks', () => {
  const title = {imdbId: 'tt0111161', type: 'movie'};
  const NOW = 1_800_000_000_000;

  it('keys by IMDb id, else by TMDB id', () => {
    expect(ratingsCacheKey(title)).toBe('ratings.v1.tt0111161');
    expect(ratingsCacheKey({tmdbId: 1399, type: 'series'})).toBe('ratings.v1.tmdb.tv.1399');
    expect(ratingsCacheKey({imdbId: 'bad'})).toBeUndefined();
  });

  it('caches a good answer for 7 days and a failure for 12 hours', () => {
    expect(isFresh({at: NOW, ok: true}, NOW + RATINGS_TTL_MS - 1)).toBe(true);
    expect(isFresh({at: NOW, ok: true}, NOW + RATINGS_TTL_MS)).toBe(false);
    expect(isFresh({at: NOW, ok: false}, NOW + RATINGS_RETRY_MS - 1)).toBe(true);
    expect(isFresh({at: NOW, ok: false}, NOW + RATINGS_RETRY_MS)).toBe(false);
    // A new OMDb key retries failures at once.
    expect(isFresh({at: NOW, ok: false}, NOW + 1, NOW + 1)).toBe(false);
  });

  it('asks OMDb once, then answers from the cache', async () => {
    const store = memoryStore();
    const sources = fetchers();
    const first = await loadTitleRatings(title, {store, now: NOW, fetchers: sources});
    expect(first).toMatchObject({imdb: 8.8, rt: 87, metacritic: 74});
    const second = await loadTitleRatings(title, {store, now: NOW + RATINGS_TTL_MS - 1000, fetchers: sources});
    expect(second).toEqual(first);
    expect(sources.omdb).toHaveBeenCalledTimes(1);
    expect(sources.cinemeta).not.toHaveBeenCalled();
    expect(sources.tmdb).not.toHaveBeenCalled();
  });

  it('asks again after 7 days', async () => {
    const store = memoryStore();
    const sources = fetchers();
    await loadTitleRatings(title, {store, now: NOW, fetchers: sources});
    await loadTitleRatings(title, {store, now: NOW + RATINGS_TTL_MS + 1, fetchers: sources});
    expect(sources.omdb).toHaveBeenCalledTimes(2);
  });

  it('falls back to Cinemeta when OMDb fails, and retries OMDb after 12 hours', async () => {
    const store = memoryStore();
    const sources = fetchers({omdb: jest.fn(async () => { throw new Error('Request limit reached!'); })});
    const result = await loadTitleRatings(title, {store, now: NOW, fetchers: sources});
    expect(result).toEqual({imdb: 8.7, imdbFrom: 'cinemeta'});
    await loadTitleRatings(title, {store, now: NOW + 1000, fetchers: sources});
    expect(sources.omdb).toHaveBeenCalledTimes(1);
    expect(sources.cinemeta).toHaveBeenCalledTimes(1);
    await loadTitleRatings(title, {store, now: NOW + RATINGS_RETRY_MS + 1, fetchers: sources});
    expect(sources.omdb).toHaveBeenCalledTimes(2);
  });

  it('uses the Cinemeta rating the page already has without asking Cinemeta', async () => {
    const sources = fetchers({omdb: jest.fn(async () => { throw new Error('offline'); })});
    const result = await loadTitleRatings({...title, cinemetaRating: '9.3'}, {store: memoryStore(), now: NOW, fetchers: sources});
    expect(result.imdb).toBe(9.3);
    expect(sources.cinemeta).not.toHaveBeenCalled();
  });

  it('falls back to TMDB when there is no IMDb score at all', async () => {
    const sources = fetchers({
      omdb: jest.fn(async () => { throw new Error('offline'); }),
      cinemeta: jest.fn(async () => undefined),
    });
    const result = await loadTitleRatings(title, {store: memoryStore(), now: NOW, fetchers: sources});
    expect(result).toEqual({tmdb: 8.4, tmdbVotes: 35000});
  });

  it('asks only TMDB for a title with a TMDB id and no IMDb id', async () => {
    const sources = fetchers();
    const result = await loadTitleRatings({tmdbId: 1399, type: 'series'}, {store: memoryStore(), now: NOW, fetchers: sources});
    expect(result.tmdb).toBe(8.4);
    expect(sources.omdb).not.toHaveBeenCalled();
    expect(sources.tmdb).toHaveBeenCalledWith({imdbId: undefined, tmdbId: 1399, mediaType: 'tv'}, undefined);
  });

  it('does not cache a missing TMDB key, so a key added later is used', async () => {
    const store = memoryStore();
    const sources = fetchers({
      omdb: jest.fn(async () => ({Response: 'True'} as OMDBTitle)),
      cinemeta: jest.fn(async () => undefined),
      tmdb: jest.fn(async () => undefined),
    });
    await loadTitleRatings(title, {store, now: NOW, fetchers: sources});
    await loadTitleRatings(title, {store, now: NOW + 1, fetchers: sources});
    expect(sources.tmdb).toHaveBeenCalledTimes(2);
  });

  it('keeps the old scores for a while when a refresh fails', async () => {
    const store = memoryStore();
    await loadTitleRatings(title, {store, now: NOW, fetchers: fetchers()});
    const failing = fetchers({omdb: jest.fn(async () => { throw new Error('offline'); })});
    const later = NOW + RATINGS_TTL_MS + 1;
    const result = await loadTitleRatings(title, {store, now: later, fetchers: failing});
    expect(result).toMatchObject({imdb: 8.8, rt: 87});
    await loadTitleRatings(title, {store, now: later + 1000, fetchers: failing});
    expect(failing.omdb).toHaveBeenCalledTimes(1);
  });

  it('does not cache a cancelled lookup', async () => {
    const store = memoryStore();
    const controller = new AbortController();
    const sources = fetchers({
      omdb: jest.fn(async () => {
        controller.abort();
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }),
    });
    await expect(loadTitleRatings(title, {store, now: NOW, fetchers: sources, signal: controller.signal})).rejects.toThrow('aborted');
    expect(store.values.size).toBe(0);
  });
});

describe('title page ratings', () => {
  it('uses the Cinemeta score from the page until the lookup has an IMDb score', () => {
    expect(withCinemetaHint(undefined, 7.1)).toEqual({imdb: 7.1, imdbFrom: 'cinemeta'});
    expect(withCinemetaHint({rt: 80}, 7.1)).toEqual({rt: 80, imdb: 7.1, imdbFrom: 'cinemeta'});
    expect(withCinemetaHint({imdb: 7.4, imdbFrom: 'omdb'}, 7.1)).toEqual({imdb: 7.4, imdbFrom: 'omdb'});
    expect(withCinemetaHint(undefined, undefined)).toEqual({});
  });

  it('saves which ratings to show and the OMDb key', () => {
    expect(readRatingSettings().show).toEqual(DEFAULT_RATING_PREFS);
    useRatingSettings.getState().setShown('metacritic', false);
    useRatingSettings.getState().setOmdbKey('  abc123 ');
    const saved = readRatingSettings();
    expect(saved.show.metacritic).toBe(false);
    expect(saved.show.imdb).toBe(true);
    expect(saved.omdbKey).toBe('abc123');
    expect(saved.omdbKeyChangedAt).toBeGreaterThan(0);
  });
});
