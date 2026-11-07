/** What yt-dlp reports about one format of a video. */
export interface YtdlFormat {
  id: string;
  ext?: string;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
  filesize?: number | null;
  tbr?: number | null;
  abr?: number | null;
  note?: string | null;
  protocol?: string | null;
  dynamicRange?: string | null;
  language?: string | null;
}

export interface YtdlVideoInfo {
  type: 'video';
  id?: string;
  title: string;
  uploader?: string | null;
  duration?: number | null;
  thumbnail?: string | null;
  webpageUrl: string;
  extractor?: string | null;
  isLive: boolean;
  chapters: number;
  formats: YtdlFormat[];
  /** Language code to track name. */
  subtitles: Record<string, string | null>;
  automaticCaptions: string[];
  originalLanguage?: string | null;
}

export interface YtdlPlaylistEntry {
  index: number;
  id?: string | null;
  title: string;
  url: string;
  duration?: number | null;
  thumbnail?: string | null;
  uploader?: string | null;
}

export interface YtdlPlaylistInfo {
  type: 'playlist';
  id?: string | null;
  title: string;
  uploader?: string | null;
  webpageUrl: string;
  extractor?: string | null;
  entries: YtdlPlaylistEntry[];
}

export type YtdlInfo = YtdlVideoInfo | YtdlPlaylistInfo;

export type YtdlKind = 'video' | 'audio';
export type YtdlContainer = 'mp4' | 'mkv';
export type YtdlAudioFormat = 'best' | 'm4a' | 'mp3' | 'opus';
export type YtdlSubtitleMode = 'off' | 'embed' | 'separate';
export type YtdlSponsorMode = 'off' | 'remove' | 'mark';

export const SPONSORBLOCK_CATEGORIES = [
  'sponsor',
  'intro',
  'outro',
  'selfpromo',
  'preview',
  'interaction',
  'music_offtopic',
  'filler',
] as const;
export type SponsorCategory = (typeof SPONSORBLOCK_CATEGORIES)[number];

/** Everything the Download sheet decides for one item. */
export interface YtdlRequest {
  kind: YtdlKind;
  /** Highest video height, or null for the best available. */
  maxHeight: number | null;
  /** A specific format picked in the advanced list. */
  formatId?: string;
  container: YtdlContainer;
  audioFormat: YtdlAudioFormat;
  subtitleMode: YtdlSubtitleMode;
  subtitleLanguages: string[];
  autoSubtitles: boolean;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  embedChapters: boolean;
  sponsorBlock: YtdlSponsorMode;
  sponsorCategories: SponsorCategory[];
  /** Seconds. Either end may be left open. */
  section?: {start?: number; end?: number};
  /** Cut on exact frames (re-encodes, slow on a phone). */
  preciseCut?: boolean;
  rateLimit?: string;
  /** Extra arguments from a template. */
  extraArgs?: string[];
}

/** Stored on the download record. */
export interface YtdlJobSpec {
  args: string[];
  kind: YtdlKind;
  /** The expected extension of the saved file, if known in advance. */
  ext?: string;
  /** Start no earlier than this time (ms since epoch). */
  notBefore?: number;
  wifiOnly?: boolean;
  /** Post-processing step shown in the queue. */
  stage?: string;
  /** Seconds left, as yt-dlp estimates it. */
  eta?: number | null;
  extractor?: string | null;
  /** Playlist title, used as the folder name. */
  playlist?: string;
}

/** One event from the native module. */
export type YtdlEvent =
  | {
      type: 'progress';
      status: 'downloading' | 'finished' | 'error';
      file: string;
      formatId?: string | null;
      downloaded: number;
      total: number;
      speed: number;
      eta?: number | null;
      fragment?: number | null;
      fragments?: number | null;
      planned: number;
      parts: number;
    }
  | {type: 'postprocess'; status: 'started' | 'processing' | 'finished'; name: string};

export interface YtdlResult {
  cancelled?: boolean;
  error?: string;
  log?: string[];
  file?: string;
  ext?: string;
  subtitles?: string[];
  title?: string | null;
  thumbnail?: string | null;
}

export interface YtdlStatus {
  available: boolean;
  error?: string | null;
  version?: string | null;
  source?: 'bundled' | 'updated';
  python?: string | null;
  bundledVersion?: string | null;
  pendingVersion?: string | null;
  jsSandbox?: boolean;
  cookies?: boolean;
}
