/**
 * Network library: poster grids built from the files on WebDAV and SMB
 * sources and device folders. Original code written for Droid Stream.
 */

/** pikpak, debrid and tdplus are cloud accounts; see cloud.ts. */
export type NetlibSourceKind = 'webdav' | 'smb' | 'device' | 'pikpak' | 'debrid' | 'tdplus';

export interface NetlibSource {
  id: string;
  kind: NetlibSourceKind;
  name: string;
  /** Where scanning starts: a WebDAV URL, an SMB path in the share, or a device folder URI. */
  root: string;
}

/** One entry of a folder listing. */
export interface NetlibEntry {
  /** WebDAV: the file URL. SMB: the path in the share. Device: the file URI. */
  path: string;
  name: string;
  directory: boolean;
  size?: number;
  modified?: number;
  etag?: string;
  /** Cloud sources: a preview picture and the file type, for showing photos. */
  thumbnail?: string;
  mimeType?: string;
}

/** A video found by a scan, with the folder names between the scan root and it. */
export interface NetlibFile extends Omit<NetlibEntry, 'directory'> {
  folders: string[];
}

export interface NetlibParsed {
  kind: 'movie' | 'episode' | 'other';
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  /** Every episode in a multi-episode file. */
  episodes?: number[];
  part?: number;
  resolution?: string;
  /** A trailer, sample or featurette. */
  extra?: boolean;
  /** From an id tag such as {tmdb-603} or [imdbid-tt0133093]. */
  tmdbId?: number;
  imdbId?: string;
}

/** One file of a title. A movie can have several (qualities, cd1/cd2). */
export interface NetlibVersion {
  /** See versionKey in ids.ts; the player keeps progress under it. */
  key: string;
  name: string;
  size?: number;
  modified?: number;
  resolution?: string;
  part?: number;
}

export interface NetlibEpisode {
  season: number;
  episode: number;
  /** Set when one file holds several episodes ("S01E01-E02"). */
  lastEpisode?: number;
  versions: NetlibVersion[];
}

export interface NetlibMatch {
  type: 'movie' | 'series';
  title: string;
  year?: number;
  tmdbId?: number;
  imdbId?: string;
  poster?: string;
  background?: string;
  overview?: string;
  rating?: string;
  genres?: string[];
  /** Chosen with Fix match; a rescan keeps it. */
  manual?: boolean;
}

export type NetlibKind = 'movie' | 'show' | 'other';

export interface NetlibItem {
  id: string;
  sourceId: string;
  kind: NetlibKind;
  /** From the file and folder names. */
  title: string;
  year?: number;
  /** Movies and other videos. */
  versions: NetlibVersion[];
  /** Shows. */
  episodes: NetlibEpisode[];
  /** Newest file time, for the "Recently added" sort. */
  added: number;
  tmdbId?: number;
  imdbId?: string;
  match?: NetlibMatch;
}

export interface NetlibLibrary {
  sourceId: string;
  scannedAt: number;
  items: NetlibItem[];
  /** Set when the scan stopped at the file limit. */
  truncated?: boolean;
}

/** Per-source choices, set on the library's settings sheet. */
export interface NetlibSourceSettings {
  /** Folder to scan instead of the source root. */
  root?: string;
  /** Look up posters and details online (TMDB, or Cinemeta without a key). */
  matchOnline: boolean;
  /** Hide the Other tab. */
  hideOther?: boolean;
}

export type NetlibSort = 'title' | 'added' | 'year';
