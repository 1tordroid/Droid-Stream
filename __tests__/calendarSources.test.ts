import {describe, expect, it} from '@jest/globals';
import {
  CINEMETA,
  TMDB,
  TVMAZE,
  dateOnlyToLocal,
  loadCalendar,
  loadShowEpisodes,
  parseCinemetaVideos,
  parseTraktCalendar,
  parseTvmazeEpisodes,
  traktCalendarPath,
  type CalendarDeps,
} from '../src/lib/calendar/sources';
import {collectShows, kidsFilter} from '../src/lib/calendar/shows';
import type {TimezoneOffset} from '../src/lib/calendar/group';
import type {CalendarShow} from '../src/lib/calendar/types';

const utc: TimezoneOffset = () => 0;
const now = Date.UTC(2026, 10, 9, 12);
const window = {from: now - 8 * 86400000, to: now + 31 * 86400000};

const show = (extra: Partial<CalendarShow> = {}): CalendarShow => ({
  key: 'tt100',
  title: 'The Show',
  imdbId: 'tt100',
  provider: 'vega',
  link: 'https://site/show',
  inWatchList: true,
  fromContinueWatching: false,
  fromTrakt: false,
  ...extra,
});

const tvmazeEpisodes = [
  {season: 2, number: 4, name: 'Old', type: 'regular', airdate: '2026-10-01', airtime: '21:00', airstamp: '2026-10-02T01:00:00+00:00'},
  {season: 2, number: 5, name: 'Next', type: 'regular', airdate: '2026-11-10', airtime: '21:00', airstamp: '2026-11-11T02:00:00+00:00'},
  {season: 2, number: 6, name: 'Undated time', type: 'regular', airdate: '2026-11-17', airtime: '', airstamp: '2026-11-17T12:00:00+00:00'},
  {season: 0, number: 1, name: 'Special', type: 'significant_special', airdate: '2026-11-12', airtime: '20:00', airstamp: '2026-11-12T20:00:00+00:00'},
];

/** A fake network: url → JSON, a function, or an Error to throw. */
const fakeDeps = (routes: Record<string, unknown>, extra: Partial<CalendarDeps> = {}) => {
  const cache = new Map<string, unknown>();
  const calls: string[] = [];
  const deps: CalendarDeps = {
    now,
    offset: utc,
    cacheGet: key => cache.get(key),
    cacheSet: (key, value) => cache.set(key, value),
    fetchJson: async url => {
      calls.push(url);
      const route = Object.keys(routes).find(prefix => url.startsWith(prefix));
      const value = route ? routes[route] : undefined;
      if (value instanceof Error) throw value;
      return value;
    },
    ...extra,
  };
  return {deps, calls, cache};
};

describe('calendar parsers', () => {
  it('reads TVmaze episodes in the window, without specials', () => {
    const list = parseTvmazeEpisodes(show(), tvmazeEpisodes, window, utc);
    expect(list.map(episode => [episode.episode, episode.timeKnown])).toEqual([
      [5, true],
      [6, false],
    ]);
    expect(list[0]).toMatchObject({id: 'tt100:2:5', airsAt: Date.parse('2026-11-11T02:00:00Z'), title: 'Next', open: {kind: 'info', link: 'https://site/show'}});
    expect(list[1].airsAt).toBe(dateOnlyToLocal('2026-11-17', utc));
  });

  it('treats Cinemeta midnight dates as day-only', () => {
    const list = parseCinemetaVideos(
      show(),
      [
        {season: 1, episode: 3, name: 'A', released: '2026-11-12T00:00:00.000Z'},
        {season: 1, episode: 4, name: 'B', released: '2026-11-19T02:00:00.000Z'},
      ],
      window,
      utc,
    );
    expect(list.map(episode => episode.timeKnown)).toEqual([false, true]);
  });

  it('reads Trakt shows and episodes', () => {
    const parsed = parseTraktCalendar([
      {first_aired: '2026-11-10T01:00:00.000Z', episode: {season: 3, number: 2, title: 'T'}, show: {title: 'Trakt Show', year: 2020, ids: {trakt: 9, imdb: 'tt9', tmdb: 99}, genres: ['drama']}},
      {first_aired: 'bad', episode: {season: 3, number: 3}, show: {title: 'Trakt Show', ids: {trakt: 9}}},
    ]);
    expect(parsed.shows).toHaveLength(1);
    expect(parsed.shows[0]).toMatchObject({key: 'tt9', tmdbId: '99', fromTrakt: true});
    expect(parsed.episodes[0]).toMatchObject({season: 3, episode: 2, open: {kind: 'finder', imdbId: 'tt9', season: 3, episode: 2}});
    expect(traktCalendarPath(now)).toBe('/calendars/my/shows/2026-11-02/31?extended=full');
  });
});

describe('calendar source fallbacks', () => {
  it('uses TVmaze first and caches it', async () => {
    const {deps, calls} = fakeDeps({
      [`${TVMAZE}/lookup/shows`]: {id: 7, image: {medium: 'poster.jpg'}, genres: ['Drama']},
      [`${TVMAZE}/shows/7/episodes`]: tvmazeEpisodes,
    });
    const first = await loadShowEpisodes(show({poster: undefined}), deps);
    expect(first.source).toBe('tvmaze');
    expect(first.poster).toBe('poster.jpg');
    expect(first.episodes[0].poster).toBe('poster.jpg');
    const again = await loadShowEpisodes(show(), deps);
    expect(again.episodes).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it('falls back to Cinemeta when TVmaze does not know the show', async () => {
    const {deps} = fakeDeps({
      [`${TVMAZE}/lookup/shows`]: undefined,
      [`${CINEMETA}/meta/series/tt100.json`]: {meta: {poster: 'c.jpg', videos: [{season: 1, episode: 2, released: '2026-11-12T03:00:00.000Z'}]}},
    });
    const loaded = await loadShowEpisodes(show(), deps);
    expect(loaded.source).toBe('cinemeta');
    expect(loaded.episodes[0].id).toBe('tt100:1:2');
  });

  it('falls back to TMDB with a key when the others fail', async () => {
    const {deps} = fakeDeps(
      {
        [`${TVMAZE}/`]: new Error('offline'),
        [`${CINEMETA}/`]: new Error('offline'),
        [`${TMDB}/tv/55`]: {poster_path: '/p.jpg', next_episode_to_air: {season_number: 4, episode_number: 1, air_date: '2026-11-20', name: 'Back'}},
      },
      {tmdbKey: 'key'},
    );
    const loaded = await loadShowEpisodes(show({tmdbId: '55'}), deps);
    expect(loaded.source).toBe('tmdb');
    expect(loaded.episodes[0]).toMatchObject({season: 4, episode: 1, timeKnown: false});
  });

  it('only searches TVmaze by title for shows without an IMDb id', async () => {
    const {deps, calls} = fakeDeps({[`${TVMAZE}/singlesearch/shows`]: {id: 8}, [`${TVMAZE}/shows/8/episodes`]: []});
    await loadShowEpisodes(show({key: 'vega|x', imdbId: undefined}), deps);
    expect(calls[0]).toContain('singlesearch/shows?q=The%20Show');
  });

  it('returns nothing when every source fails', async () => {
    const {deps} = fakeDeps({[`${TVMAZE}/`]: new Error('x'), [`${CINEMETA}/`]: new Error('x')});
    expect(await loadShowEpisodes(show(), deps)).toEqual({episodes: []});
  });

  it('takes Trakt first and looks up only the library shows Trakt did not cover', async () => {
    const {deps, calls} = fakeDeps(
      {
        [`${TVMAZE}/lookup/shows`]: {id: 7},
        [`${TVMAZE}/shows/7/episodes`]: tvmazeEpisodes,
      },
      {
        traktGet: async () => [
          {first_aired: '2026-11-10T01:00:00.000Z', episode: {season: 1, number: 1}, show: {title: 'Lib Show', ids: {imdb: 'tt1'}}},
          {first_aired: '2026-11-10T01:00:00.000Z', episode: {season: 1, number: 1}, show: {title: 'Trakt Only', ids: {imdb: 'tt2'}}},
        ],
      },
    );
    const result = await loadCalendar([show({key: 'tt1', imdbId: 'tt1', title: 'Lib Show'}), show({key: 'tt3', imdbId: 'tt3'})], deps);
    expect(result.sources.sort()).toEqual(['trakt', 'tvmaze']);
    expect(calls.every(url => !url.includes('tt1'))).toBe(true);
    const lib = result.episodes.find(episode => episode.showKey === 'tt1');
    expect(lib?.open.kind).toBe('info');
    expect(result.shows.find(item => item.key === 'tt2')?.fromTrakt).toBe(true);
  });

  it('keeps working when Trakt fails', async () => {
    const {deps} = fakeDeps({[`${TVMAZE}/`]: undefined, [`${CINEMETA}/`]: undefined}, {traktGet: async () => Promise.reject(new Error('Trakt is down'))});
    const result = await loadCalendar([show()], deps);
    expect(result.traktError).toBe('Trakt is down');
    expect(result.episodes).toEqual([]);
  });
});

describe('followed shows', () => {
  const info: Record<string, any> = {
    'vega|a': {type: 'series', imdbId: 'tt1'},
    'vega|b': {type: 'movie', imdbId: 'tt2'},
    'other|c': {type: 'series', imdbId: 'tt1'},
  };
  const infoFor = (provider: string, link: string) => info[`${provider}|${link}`];

  it('takes series from the watch list and Continue watching, merged by IMDb id', () => {
    const shows = collectShows(
      [
        {title: 'A', link: 'a', provider: 'vega'},
        {title: 'B', link: 'b', provider: 'vega'},
      ],
      [
        {title: 'A again', infoUrl: 'c', providerValue: 'other'},
        {title: 'D', infoUrl: 'd', providerValue: 'vega', type: 'series'},
        {title: 'E', infoUrl: 'e', providerValue: 'vega', type: 'movie'},
      ],
      infoFor,
    );
    expect(shows.map(item => [item.key, item.inWatchList, item.fromContinueWatching])).toEqual([
      ['tt1', true, true],
      ['vega|d', false, true],
    ]);
  });

  it('hides adult shows in a kids profile', () => {
    const list = [show({key: 'a', genres: ['Animation']}), show({key: 'b', certification: 'TV-MA'}), show({key: 'c'})];
    expect(kidsFilter(list, true).map(item => item.key)).toEqual(['a', 'c']);
    expect(kidsFilter(list, false)).toHaveLength(3);
  });
});
