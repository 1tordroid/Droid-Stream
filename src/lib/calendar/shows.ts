/**
 * The shows the calendar follows for the profile in use: its watch list and
 * library, and Continue watching. Movies are left out; a show's IMDb id comes
 * from the title page the app saved when it was opened.
 */
import {isKidsSafe} from '../profiles/kids';
import type {CalendarShow} from './types';

export interface LibraryEntry {
  title: string;
  poster?: string;
  link: string;
  provider: string;
}

export interface ContinueEntry {
  title: string;
  poster?: string;
  infoUrl: string;
  providerValue: string;
  type?: string;
}

/** What the saved title page says about a show. */
export interface SavedInfo {
  type?: string;
  imdbId?: string;
  tmdbId?: string | number;
  title?: string;
  image?: string;
  poster?: string;
  tags?: string[];
}

const isSeriesType = (type?: string) => /series|show|tv|anime/i.test(type || '');

const keyFor = (info: SavedInfo | undefined, provider: string, link: string): string =>
  info?.imdbId && /^tt\d+$/.test(info.imdbId) ? info.imdbId : `${provider}|${link}`;

/**
 * Shows from the watch list and Continue watching, merged by IMDb id (or by
 * title page). A title is a show when its saved page says so; Continue
 * watching also counts a "series" entry without a saved page.
 */
export const collectShows = (library: LibraryEntry[], continueWatching: ContinueEntry[], infoFor: (provider: string, link: string) => SavedInfo | undefined): CalendarShow[] => {
  const shows = new Map<string, CalendarShow>();
  const add = (provider: string, link: string, title: string, poster: string | undefined, inWatchList: boolean, fallbackType?: string) => {
    if (!link || !provider || !title) return;
    const info = infoFor(provider, link);
    if (!isSeriesType(info?.type ?? fallbackType)) return;
    const key = keyFor(info, provider, link);
    const existing = shows.get(key);
    if (existing) {
      existing.inWatchList ||= inWatchList;
      existing.fromContinueWatching ||= !inWatchList;
      return;
    }
    shows.set(key, {
      key,
      title,
      poster: poster || info?.poster || info?.image || undefined,
      imdbId: key.startsWith('tt') ? key : undefined,
      tmdbId: info?.tmdbId !== undefined && info?.tmdbId !== null && String(info.tmdbId) ? String(info.tmdbId) : undefined,
      provider,
      link,
      inWatchList,
      fromContinueWatching: !inWatchList,
      fromTrakt: false,
      genres: info?.tags,
    });
  };
  library.forEach(item => add(item.provider, item.link, item.title, item.poster, true));
  continueWatching.forEach(item => add(item.providerValue, item.infoUrl, item.title, item.poster, false, item.type));
  return [...shows.values()];
};

/** A kids profile sees only shows without an adult rating or genre. Unknown ratings pass. */
export const kidsFilter = (shows: CalendarShow[], kids: boolean): CalendarShow[] =>
  kids ? shows.filter(show => isKidsSafe({certification: show.certification, genres: show.genres})) : shows;
