/**
 * Multi-site torrent search for Droid Stream.
 * Original TypeScript written for this app. No code from GPL or closed apps.
 */

export type TorrentCategory =
  | 'all'
  | 'movies'
  | 'tv'
  | 'anime'
  | 'music'
  | 'games'
  | 'apps'
  | 'books'
  | 'other';

export const TORRENT_CATEGORIES: {id: TorrentCategory; label: string; icon: string}[] = [
  {id: 'all', label: 'All', icon: 'apps'},
  {id: 'movies', label: 'Movies', icon: 'movie-open'},
  {id: 'tv', label: 'TV', icon: 'television-classic'},
  {id: 'anime', label: 'Anime', icon: 'animation-play'},
  {id: 'music', label: 'Music', icon: 'music'},
  {id: 'games', label: 'Games', icon: 'gamepad-variant'},
  {id: 'apps', label: 'Apps', icon: 'application'},
  {id: 'books', label: 'Books', icon: 'book-open-variant'},
  {id: 'other', label: 'Other', icon: 'dots-horizontal-circle'},
];

export interface TorrentResult {
  /** Stable key: the info hash when known, otherwise engine + link. */
  id: string;
  title: string;
  /** Lower-case 40-char hex (or 32-char base32) info hash, when known. */
  infoHash?: string;
  magnet?: string;
  /** Direct .torrent download link. */
  torrentUrl?: string;
  /** Page on the site; used to resolve a magnet lazily and for "Open site". */
  detailUrl?: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  /** Upload time in ms since epoch, 0 when unknown. */
  uploadedAt: number;
  category: TorrentCategory;
  /** Engine that produced this row. */
  engine: string;
  /** Every engine that returned the same torrent (after de-duplication). */
  engines: string[];
  uploader?: string;
  files?: number;
  imdbId?: string;
  poster?: string;
  /** Served by HTTP web seeds, so a zero peer count is expected. */
  webSeeded?: boolean;
}

export interface EngineSearchOptions {
  category: TorrentCategory;
  page: number;
  signal: AbortSignal;
  /** Base URL to use; engines with mirrors receive the chosen one. */
  baseUrl: string;
}

export interface TorrentEngine {
  id: string;
  name: string;
  /** Short note shown in the source list. */
  description: string;
  /** Categories the site covers; 'all' means general purpose. */
  categories: TorrentCategory[];
  /** Mirrors, first is the default. Users can add their own. */
  mirrors: string[];
  enabledByDefault: boolean;
  /** True when results usually need a second request to get the magnet. */
  lazyMagnet?: boolean;
  search(query: string, options: EngineSearchOptions): Promise<TorrentResult[]>;
  /** Popular or recent torrents for the Trending view. */
  trending?(options: EngineSearchOptions): Promise<TorrentResult[]>;
  /** Turns a result without a magnet into one with a magnet. */
  resolve?(result: TorrentResult, options: {signal: AbortSignal; baseUrl: string}): Promise<TorrentResult>;
}

export type SortKey = 'relevance' | 'seeders' | 'leechers' | 'size' | 'date' | 'name';

export interface ResultFilters {
  minSeeders: number;
  minSizeMb: number;
  maxSizeMb: number;
  /** Resolution tags to keep, empty keeps everything. */
  qualities: string[];
  /** Words a title must not contain. */
  exclude: string;
  /** Search inside current results. */
  within: string;
  hideZeroSeed: boolean;
}

export const defaultFilters = (): ResultFilters => ({
  minSeeders: 0,
  minSizeMb: 0,
  maxSizeMb: 0,
  qualities: [],
  exclude: '',
  within: '',
  hideZeroSeed: false,
});

export interface EngineStatus {
  engine: string;
  state: 'idle' | 'loading' | 'done' | 'error';
  count: number;
  ms: number;
  error?: string;
}
