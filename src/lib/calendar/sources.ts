/**
 * Where episode air dates come from, best first:
 *
 * - Trakt's /calendars/my/shows, when the profile is signed in to Trakt.
 * - TVmaze's public API: free, no key. Data is CC BY-SA 4.0, credited in
 *   the Calendar screen and in Credits.
 * - Cinemeta (the Stremio catalogue), for shows TVmaze does not know.
 * - TMDB, with the viewer's own API key, as the last fallback (dates only).
 *
 * Parsing is kept apart from fetching so tests run without the network.
 */
import {AHEAD_DAYS, DAY_MS, PAST_DAYS, startOfLocalDay, type TimezoneOffset, deviceOffset} from './group';
import type {CalendarEpisode, CalendarOpen, CalendarShow, CalendarSource} from './types';

export const TVMAZE = 'https://api.tvmaze.com';
export const CINEMETA = 'https://v3-cinemeta.strem.io';
export const TMDB = 'https://api.themoviedb.org/3';

export interface CalendarWindow {
  from: number;
  to: number;
}

export const calendarWindow = (now: number): CalendarWindow => ({from: now - (PAST_DAYS + 1) * DAY_MS, to: now + (AHEAD_DAYS + 1) * DAY_MS});

const inWindow = (at: number, window: CalendarWindow) => Number.isFinite(at) && at >= window.from && at <= window.to;

const openFor = (show: CalendarShow, season: number, episode: number): CalendarOpen =>
  show.link && show.provider
    ? {kind: 'info', link: show.link, provider: show.provider, poster: show.poster}
    : {kind: 'finder', title: show.title, imdbId: show.imdbId, year: show.year, poster: show.poster, season, episode};

const makeEpisode = (
  show: CalendarShow,
  season: number,
  episode: number,
  airsAt: number,
  timeKnown: boolean,
  source: CalendarSource,
  title?: string,
): CalendarEpisode => ({
  id: `${show.key}:${season}:${episode}`,
  showKey: show.key,
  showTitle: show.title,
  poster: show.poster,
  season,
  episode,
  title: title || undefined,
  airsAt,
  timeKnown,
  source,
  open: openFor(show, season, episode),
});

/** "2026-11-09" as local midnight of that day. */
export const dateOnlyToLocal = (date: string, offset: TimezoneOffset = deviceOffset): number => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  if (!match) return NaN;
  const day = Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS);
  return startOfLocalDay(day, offset);
};

const num = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

// ---------------------------------------------------------------- TVmaze

export interface TvmazeShowInfo {
  id: number;
  poster?: string;
  genres: string[];
  year?: number;
}

export const parseTvmazeShow = (data: any): TvmazeShowInfo | undefined => {
  const id = num(data?.id);
  if (id === undefined) return undefined;
  return {
    id,
    poster: data?.image?.medium || data?.image?.original || undefined,
    genres: Array.isArray(data?.genres) ? data.genres.filter((genre: unknown) => typeof genre === 'string') : [],
    year: num(String(data?.premiered || '').slice(0, 4)),
  };
};

/** Regular episodes from TVmaze's episode list, inside the window. */
export const parseTvmazeEpisodes = (show: CalendarShow, data: unknown, window: CalendarWindow, offset: TimezoneOffset = deviceOffset): CalendarEpisode[] => {
  if (!Array.isArray(data)) return [];
  const result: CalendarEpisode[] = [];
  for (const raw of data as any[]) {
    const season = num(raw?.season);
    const number = num(raw?.number);
    if (season === undefined || number === undefined || season < 1) continue;
    if (raw?.type && raw.type !== 'regular') continue;
    const timeKnown = Boolean(raw?.airstamp && raw?.airtime);
    const airsAt = timeKnown ? Date.parse(raw.airstamp) : dateOnlyToLocal(raw?.airdate, offset);
    if (!inWindow(airsAt, window)) continue;
    result.push(makeEpisode(show, season, number, airsAt, timeKnown, 'tvmaze', raw?.name));
  }
  return result;
};

// ---------------------------------------------------------------- Cinemeta

/** Cinemeta "released" values at exactly midnight UTC carry the day only. */
export const parseCinemetaVideos = (show: CalendarShow, videos: unknown, window: CalendarWindow, offset: TimezoneOffset = deviceOffset): CalendarEpisode[] => {
  if (!Array.isArray(videos)) return [];
  const result: CalendarEpisode[] = [];
  for (const video of videos as any[]) {
    const season = num(video?.season);
    const episode = num(video?.episode ?? video?.number);
    if (season === undefined || episode === undefined || season < 1 || typeof video?.released !== 'string') continue;
    const dateOnly = /T00:00:00(\.000)?Z$/.test(video.released) || /^\d{4}-\d{2}-\d{2}$/.test(video.released);
    const airsAt = dateOnly ? dateOnlyToLocal(video.released, offset) : Date.parse(video.released);
    if (!inWindow(airsAt, window)) continue;
    result.push(makeEpisode(show, season, episode, airsAt, !dateOnly, 'cinemeta', video?.name || video?.title));
  }
  return result;
};

// ---------------------------------------------------------------- TMDB

/** TMDB's show details name the last and next episode, with dates only. */
export const parseTmdbShow = (show: CalendarShow, data: any, window: CalendarWindow, offset: TimezoneOffset = deviceOffset): CalendarEpisode[] =>
  [data?.last_episode_to_air, data?.next_episode_to_air]
    .filter(Boolean)
    .map((raw: any) => {
      const season = num(raw?.season_number);
      const episode = num(raw?.episode_number);
      const airsAt = dateOnlyToLocal(raw?.air_date, offset);
      if (season === undefined || episode === undefined || season < 1 || !inWindow(airsAt, window)) return undefined;
      return makeEpisode(show, season, episode, airsAt, false, 'tmdb', raw?.name);
    })
    .filter(Boolean) as CalendarEpisode[];

// ---------------------------------------------------------------- Trakt

/** Shows and episodes from Trakt's calendar (with ?extended=full). */
export const parseTraktCalendar = (data: unknown): {shows: CalendarShow[]; episodes: CalendarEpisode[]} => {
  const shows = new Map<string, CalendarShow>();
  const episodes: CalendarEpisode[] = [];
  if (!Array.isArray(data)) return {shows: [], episodes};
  for (const raw of data as any[]) {
    const ids = raw?.show?.ids || {};
    const title = typeof raw?.show?.title === 'string' ? raw.show.title : undefined;
    const season = num(raw?.episode?.season);
    const number = num(raw?.episode?.number);
    const airsAt = Date.parse(raw?.first_aired);
    if (!title || season === undefined || number === undefined || season < 1 || !Number.isFinite(airsAt)) continue;
    const imdbId = typeof ids.imdb === 'string' && ids.imdb ? ids.imdb : undefined;
    const key = imdbId || `trakt:${ids.trakt ?? ids.slug ?? title}`;
    const show: CalendarShow = shows.get(key) || {
      key,
      title,
      imdbId,
      tmdbId: ids.tmdb !== undefined && ids.tmdb !== null ? String(ids.tmdb) : undefined,
      year: num(raw?.show?.year),
      inWatchList: false,
      fromContinueWatching: false,
      fromTrakt: true,
      genres: Array.isArray(raw?.show?.genres) ? raw.show.genres : undefined,
      certification: typeof raw?.show?.certification === 'string' ? raw.show.certification : undefined,
    };
    shows.set(key, show);
    episodes.push(makeEpisode(show, season, number, airsAt, true, 'trakt', raw?.episode?.title));
  }
  return {shows: [...shows.values()], episodes};
};

/** Trakt dates: the calendar starts [PAST_DAYS] ago and covers 31 days (Trakt allows 33). */
export const traktCalendarPath = (now: number): string => {
  const start = new Date(now - PAST_DAYS * DAY_MS).toISOString().slice(0, 10);
  return `/calendars/my/shows/${start}/31?extended=full`;
};

// ---------------------------------------------------------------- Loading

export interface CalendarDeps {
  /** Parsed JSON; undefined when the item does not exist (404). Throws on other failures. */
  fetchJson: (url: string) => Promise<any>;
  /** A GET to the Trakt API with the profile's sign-in; missing when not signed in. */
  traktGet?: (path: string) => Promise<any>;
  tmdbKey?: string;
  cacheGet: (key: string) => any;
  cacheSet: (key: string, value: unknown) => void;
  now: number;
  offset?: TimezoneOffset;
}

const EPISODES_TTL_MS = 12 * 60 * 60 * 1000;

interface CachedShowEpisodes {
  at: number;
  source: CalendarSource;
  /** Raw source data, parsed again each time so the window moves with the date. */
  raw: unknown;
  poster?: string;
  genres?: string[];
}

export interface ShowLoad {
  source?: CalendarSource;
  episodes: CalendarEpisode[];
  poster?: string;
  genres?: string[];
}

const parseCached = (show: CalendarShow, cached: CachedShowEpisodes, window: CalendarWindow, offset?: TimezoneOffset): CalendarEpisode[] => {
  const withPoster = {...show, poster: show.poster || cached.poster};
  if (cached.source === 'tvmaze') return parseTvmazeEpisodes(withPoster, cached.raw, window, offset);
  if (cached.source === 'cinemeta') return parseCinemetaVideos(withPoster, cached.raw, window, offset);
  if (cached.source === 'tmdb') return parseTmdbShow(withPoster, cached.raw, window, offset);
  return [];
};

const tvmazeShow = async (show: CalendarShow, deps: CalendarDeps): Promise<TvmazeShowInfo | undefined> => {
  const idKey = `tvmaze-id:${show.key}`;
  const known = deps.cacheGet(idKey);
  if (known && typeof known.id === 'number') return known as TvmazeShowInfo;
  if (known && known.none && deps.now - known.at < 7 * DAY_MS) return undefined;
  let data = show.imdbId ? await deps.fetchJson(`${TVMAZE}/lookup/shows?imdb=${encodeURIComponent(show.imdbId)}`) : undefined;
  // A title search only for shows without an IMDb id: a wrong match is worse than none.
  if (!data && !show.imdbId) data = await deps.fetchJson(`${TVMAZE}/singlesearch/shows?q=${encodeURIComponent(show.title)}`);
  const parsed = parseTvmazeShow(data);
  deps.cacheSet(idKey, parsed || {none: true, at: deps.now});
  return parsed;
};

/** One show's episodes: TVmaze, then Cinemeta, then TMDB. Cached for 12 hours. */
export const loadShowEpisodes = async (show: CalendarShow, deps: CalendarDeps): Promise<ShowLoad> => {
  const window = calendarWindow(deps.now);
  const cacheKey = `episodes:${show.key}`;
  const cached = deps.cacheGet(cacheKey) as CachedShowEpisodes | undefined;
  if (cached && deps.now - cached.at < EPISODES_TTL_MS) {
    return {source: cached.source, episodes: parseCached(show, cached, window, deps.offset), poster: cached.poster, genres: cached.genres};
  }
  const save = (entry: Omit<CachedShowEpisodes, 'at'>): ShowLoad => {
    const full = {...entry, at: deps.now};
    deps.cacheSet(cacheKey, full);
    return {source: entry.source, episodes: parseCached(show, full, window, deps.offset), poster: entry.poster, genres: entry.genres};
  };
  try {
    const info = await tvmazeShow(show, deps);
    if (info) {
      const raw = await deps.fetchJson(`${TVMAZE}/shows/${info.id}/episodes`);
      if (Array.isArray(raw)) return save({source: 'tvmaze', raw, poster: info.poster, genres: info.genres});
    }
  } catch {
    // Next source.
  }
  if (show.imdbId) {
    try {
      const data = await deps.fetchJson(`${CINEMETA}/meta/series/${encodeURIComponent(show.imdbId)}.json`);
      const videos = data?.meta?.videos;
      if (Array.isArray(videos) && videos.length) return save({source: 'cinemeta', raw: videos, poster: data.meta.poster, genres: data.meta.genres});
    } catch {
      // Next source.
    }
  }
  if (show.tmdbId && deps.tmdbKey) {
    try {
      const data = await deps.fetchJson(`${TMDB}/tv/${encodeURIComponent(show.tmdbId)}?api_key=${encodeURIComponent(deps.tmdbKey)}`);
      if (data) {
        const poster = typeof data.poster_path === 'string' ? `https://image.tmdb.org/t/p/w342${data.poster_path}` : undefined;
        const genres = Array.isArray(data.genres) ? data.genres.map((genre: any) => genre?.name).filter(Boolean) : undefined;
        return save({source: 'tmdb', raw: data, poster, genres});
      }
    } catch {
      // Nothing left.
    }
  }
  // An old copy beats nothing when every source failed.
  if (cached) return {source: cached.source, episodes: parseCached(show, cached, window, deps.offset), poster: cached.poster, genres: cached.genres};
  return {episodes: []};
};

export interface CalendarResult {
  shows: CalendarShow[];
  episodes: CalendarEpisode[];
  /** Sources that answered, for the credit line. */
  sources: CalendarSource[];
  traktError?: string;
}

/**
 * Every followed show's episodes. Trakt comes first when signed in; library
 * shows Trakt had nothing for are looked up one by one, a few at a time.
 */
export const loadCalendar = async (shows: CalendarShow[], deps: CalendarDeps, concurrency = 2): Promise<CalendarResult> => {
  const sources = new Set<CalendarSource>();
  let episodes: CalendarEpisode[] = [];
  const allShows = new Map(shows.map(show => [show.key, show]));
  let traktError: string | undefined;
  if (deps.traktGet) {
    try {
      const trakt = parseTraktCalendar(await deps.traktGet(traktCalendarPath(deps.now)));
      for (const show of trakt.shows) {
        const own = allShows.get(show.key);
        allShows.set(show.key, own ? {...own, fromTrakt: true, tmdbId: own.tmdbId || show.tmdbId, genres: own.genres || show.genres, certification: show.certification} : show);
      }
      // Library shows open their own title page, Trakt-only ones the stream finder.
      episodes = trakt.episodes.map(episode => {
        const show = allShows.get(episode.showKey)!;
        return {...episode, showTitle: show.title, poster: show.poster, open: openFor(show, episode.season, episode.episode)};
      });
      if (trakt.episodes.length) sources.add('trakt');
    } catch (error) {
      traktError = error instanceof Error ? error.message : String(error);
    }
  }
  const covered = new Set(episodes.map(episode => episode.showKey));
  const pending = shows.filter(show => !covered.has(show.key));
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const show = pending[next++];
      const loaded = await loadShowEpisodes(show, deps).catch(() => ({episodes: []}) as ShowLoad);
      if (loaded.source) sources.add(loaded.source);
      const merged = {...show, poster: show.poster || loaded.poster, genres: show.genres || loaded.genres};
      allShows.set(show.key, merged);
      episodes.push(...loaded.episodes.map(episode => ({...episode, poster: merged.poster})));
    }
  };
  await Promise.all(Array.from({length: Math.max(1, concurrency)}, worker));
  // Trakt-only shows have no poster: Cinemeta's, when cached by the poster lookup, is added by the screen.
  return {shows: [...allShows.values()], episodes, sources: [...sources], traktError};
};
