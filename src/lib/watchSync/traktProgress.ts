/**
 * Trakt playback progress (Trakt's /sync/playback): movies and episodes
 * paused part way on any app or device linked to Trakt. They have no source
 * to play here, so Home shows them in a "Continue on Trakt" row that opens the
 * title, and the player starts at the Trakt position when this device has no
 * progress of its own for what is playing.
 *
 * Kept per profile, in the watch-sync store (each profile has its own Trakt
 * sign-in).
 */
import type {WatchMeta} from '../watchMeta';
import {readSyncSettings, traktAuthedGet, watchSyncStorage} from './index';

export interface TraktPlaybackItem {
  /** Trakt's playback id. */
  id: string;
  type: 'movie' | 'series';
  /** The movie or show title. */
  title: string;
  year?: number;
  /** The movie's or show's ids. */
  imdbId?: string;
  tmdbId?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  /** Percent watched, 0 to 100. */
  progress: number;
  /** When it was paused (ms since epoch). */
  pausedAt: number;
}

const KEY = 'trakt-playback';
const HIDDEN_KEY = 'trakt-playback-hidden';
/** Trakt is asked again after this long. */
export const TRAKT_PLAYBACK_MAX_AGE_MS = 10 * 60 * 1000;
/** Positions this close to the start or the end are left out. */
const MIN_PERCENT = 1;
const MAX_PERCENT = 95;
const MAX_ITEMS = 30;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const idText = (value: unknown): string | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value);

/**
 * Trakt's answer as rows: newest first, one per show (its most recent
 * episode), without positions near the start or the end.
 */
export const parseTraktPlayback = (data: unknown): TraktPlaybackItem[] => {
  if (!Array.isArray(data)) return [];
  const items: TraktPlaybackItem[] = [];
  for (const raw of data as any[]) {
    const progress = Number(raw?.progress);
    if (!Number.isFinite(progress) || progress < MIN_PERCENT || progress > MAX_PERCENT) continue;
    const pausedAt = Date.parse(raw?.paused_at) || 0;
    const id = idText(raw?.id);
    if (!id) continue;
    if (raw?.type === 'movie' && raw.movie) {
      const title = text(raw.movie.title);
      if (!title) continue;
      items.push({
        id,
        type: 'movie',
        title,
        ...(Number(raw.movie.year) > 0 ? {year: Number(raw.movie.year)} : {}),
        ...(text(raw.movie.ids?.imdb) ? {imdbId: text(raw.movie.ids.imdb)} : {}),
        ...(idText(raw.movie.ids?.tmdb) ? {tmdbId: idText(raw.movie.ids.tmdb)} : {}),
        progress,
        pausedAt,
      });
    } else if (raw?.type === 'episode' && raw.show && raw.episode) {
      const title = text(raw.show.title);
      const season = Number(raw.episode.season);
      const episode = Number(raw.episode.number);
      if (!title || !Number.isInteger(season) || !Number.isInteger(episode)) continue;
      items.push({
        id,
        type: 'series',
        title,
        ...(Number(raw.show.year) > 0 ? {year: Number(raw.show.year)} : {}),
        ...(text(raw.show.ids?.imdb) ? {imdbId: text(raw.show.ids.imdb)} : {}),
        ...(idText(raw.show.ids?.tmdb) ? {tmdbId: idText(raw.show.ids.tmdb)} : {}),
        season,
        episode,
        ...(text(raw.episode.title) ? {episodeTitle: text(raw.episode.title)} : {}),
        progress,
        pausedAt,
      });
    }
  }
  items.sort((a, b) => b.pausedAt - a.pausedAt);
  const seen = new Set<string>();
  return items
    .filter(item => {
      const key = item.type === 'series' ? `show:${item.imdbId || item.tmdbId || normalizeTitle(item.title)}` : `movie:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ITEMS);
};

/** Lower case, letters and digits only, for matching titles from different places. */
export const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// ---------------------------------------------------------------- storage

interface SavedPlayback {
  at: number;
  items: TraktPlaybackItem[];
}

const readSaved = (): SavedPlayback | undefined => {
  try {
    const saved = JSON.parse(watchSyncStorage.getString(KEY) || 'null');
    return saved && Array.isArray(saved.items) && typeof saved.at === 'number' ? saved : undefined;
  } catch {
    return undefined;
  }
};

const readHidden = (): string[] => {
  try {
    const saved = JSON.parse(watchSyncStorage.getString(HIDDEN_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

/** Shown while Trakt is connected and syncing for this profile. */
export const traktPlaybackAvailable = (): boolean => {
  const trakt = readSyncSettings().trakt;
  return Boolean(trakt.enabled && trakt.accessToken);
};

/** The saved Trakt progress for this profile, without the rows the viewer removed. */
export const readTraktPlayback = (): TraktPlaybackItem[] => {
  if (!traktPlaybackAvailable()) return [];
  const hidden = new Set(readHidden());
  return (readSaved()?.items || []).filter(item => !hidden.has(item.id));
};

/** Removes a row here only; Trakt keeps the progress. */
export const hideTraktPlayback = (id: string): void => {
  const hidden = readHidden().filter(item => item !== id);
  // Only ids Trakt still lists need keeping.
  const listed = new Set((readSaved()?.items || []).map(item => item.id));
  watchSyncStorage.setString(HIDDEN_KEY, JSON.stringify([...hidden.filter(item => listed.has(item)), id]));
};

let refreshing: Promise<TraktPlaybackItem[]> | undefined;

/**
 * Asks Trakt for the current progress when the saved copy is older than
 * TRAKT_PLAYBACK_MAX_AGE_MS (or when forced). Keeps the saved copy when
 * Trakt cannot be reached.
 */
export const refreshTraktPlayback = ({force = false, now = Date.now()}: {force?: boolean; now?: number} = {}): Promise<TraktPlaybackItem[]> => {
  if (!traktPlaybackAvailable()) return Promise.resolve([]);
  const saved = readSaved();
  if (!force && saved && now - saved.at < TRAKT_PLAYBACK_MAX_AGE_MS && saved.at <= now) return Promise.resolve(readTraktPlayback());
  if (!refreshing) {
    refreshing = traktAuthedGet('/sync/playback?limit=50')
      .then(data => {
        watchSyncStorage.setString(KEY, JSON.stringify({at: now, items: parseTraktPlayback(data)} satisfies SavedPlayback));
        return readTraktPlayback();
      })
      .catch(() => readTraktPlayback())
      .finally(() => {
        refreshing = undefined;
      });
  }
  return refreshing;
};

// ---------------------------------------------------------------- resume hint

const sameId = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/**
 * The Trakt position (percent) for what is playing, matched by IMDb or TMDB
 * id, else by title (and year when both have one), and for a show by season
 * and episode. Undefined when Trakt has none.
 */
export const traktResumePercent = (meta: WatchMeta | undefined, items: TraktPlaybackItem[] = readTraktPlayback()): number | undefined => {
  if (!meta?.title) return undefined;
  const title = normalizeTitle(meta.title);
  const match = items.find(item => {
    if (item.type !== meta.type) return false;
    if (item.type === 'series' && (item.season !== meta.season || item.episode !== meta.episode)) return false;
    if (sameId(item.imdbId, meta.imdbId) || sameId(item.tmdbId, meta.tmdbId)) return true;
    // With ids on both sides that differ, it is another title.
    if ((item.imdbId && meta.imdbId) || (item.tmdbId && meta.tmdbId)) return false;
    if (normalizeTitle(item.title) !== title) return false;
    return !item.year || !meta.year || item.year === meta.year;
  });
  return match?.progress;
};

/** Where to start, in seconds, from a Trakt percent and the video's length. 0 when unknown. */
export const traktResumeSeconds = (percent: number | undefined, durationSeconds: number): number => {
  if (!percent || !(durationSeconds > 0)) return 0;
  const seconds = (Math.min(MAX_PERCENT, Math.max(0, percent)) / 100) * durationSeconds;
  return seconds > 5 ? Math.floor(seconds) : 0;
};
