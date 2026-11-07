export type CalendarSource = 'trakt' | 'tvmaze' | 'cinemeta' | 'tmdb';

/** A show the calendar follows. */
export interface CalendarShow {
  /** IMDb id when known, else "provider|link", else "trakt:<id>". */
  key: string;
  title: string;
  poster?: string;
  imdbId?: string;
  tmdbId?: string;
  year?: number;
  /** The title page in a provider, when the show came from the library. */
  provider?: string;
  link?: string;
  inWatchList: boolean;
  fromContinueWatching: boolean;
  fromTrakt: boolean;
  genres?: string[];
  certification?: string;
}

export type CalendarOpen =
  | {kind: 'info'; link: string; provider: string; poster?: string}
  | {kind: 'finder'; title: string; imdbId?: string; year?: number; poster?: string; season: number; episode: number};

export interface CalendarEpisode {
  /** "<showKey>:<season>:<episode>" */
  id: string;
  showKey: string;
  showTitle: string;
  poster?: string;
  season: number;
  episode: number;
  title?: string;
  /** Air time (ms since epoch). For a date-only source, local midnight of that day. */
  airsAt: number;
  /** False when the source gives the day only. */
  timeKnown: boolean;
  source: CalendarSource;
  open: CalendarOpen;
}
