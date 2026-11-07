import type {SocialRules} from './rules/ruleSchema';

export type SocialSite = 'instagram' | 'facebook' | 'twitter' | 'threads' | 'pinterest' | 'reddit' | 'tumblr';

/** What a link points at. */
export type SocialLinkKind = 'post' | 'story' | 'highlight' | 'profile';

export interface SocialLink {
  site: SocialSite;
  kind: SocialLinkKind;
  url: string;
  /** Post code, tweet id, pin id and so on. */
  id?: string;
  /** User name, blog name or page name when the link has one. */
  user?: string;
}

/** One size of an image or video. */
export interface SocialVariant {
  url: string;
  width?: number;
  height?: number;
}

export interface SocialMediaItem {
  /** Unique inside the post (or the profile batch). */
  id: string;
  kind: 'image' | 'video';
  /** Largest first. */
  variants: SocialVariant[];
  /** Small image for the grid. */
  thumbnail?: string;
  ext: string;
  /** Post this item belongs to (a profile batch has many posts). */
  postId: string;
  /** Position inside its post, from 1. */
  index: number;
  /** The video can only be saved with yt-dlp (no direct file link). */
  needsYtdl?: boolean;
  /** Page link for yt-dlp. */
  pageUrl?: string;
}

/** A song attached to an Instagram photo post. */
export interface SocialMusic {
  url: string;
  title?: string;
  artist?: string;
  /** Full song length in seconds, when known. */
  duration?: number;
  /** Where the post's clip starts, in seconds. */
  start?: number;
  /** Length of the post's clip, in seconds. */
  clip?: number;
}

export interface SocialPost {
  site: SocialSite;
  kind: SocialLinkKind;
  url: string;
  /** User name used for folders. */
  author: string;
  authorName?: string;
  title: string;
  caption?: string;
  items: SocialMediaItem[];
  music?: SocialMusic;
  /** The post also has a video that yt-dlp can save. */
  hasVideo?: boolean;
  /** A note to show, such as "Sign in to get the song". */
  note?: string;
  /** For a profile link: the profile picture and the account id. */
  profile?: {userId?: string; picture?: SocialMediaItem};
}

export type SocialErrorCode = 'signIn' | 'notFound' | 'private' | 'rateLimit' | 'unsupported' | 'network' | 'empty';

export class SocialError extends Error {
  code: SocialErrorCode;

  constructor(code: SocialErrorCode, message: string) {
    super(message);
    this.name = 'SocialError';
    this.code = code;
  }
}

export interface SocialResponse {
  status: number;
  url: string;
  text: string;
}

export interface SocialRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

/** Everything an extractor needs from outside, so tests can pass fixtures. */
export interface SocialContext {
  fetch: (url: string, request?: SocialRequest) => Promise<SocialResponse>;
  /** Cookie value for a site, from the video downloader's cookie file. */
  cookie: (host: string, name: string) => string | undefined;
  /** "name=value; ..." for a URL, or empty. */
  cookieHeader: (url: string) => string;
  /** Waits between pages of a profile. */
  sleep: (ms: number) => Promise<void>;
  /** Site rules to read with; the active rules when missing. */
  rules?: SocialRules;
}

export interface ProfileOptions {
  /** Latest posts to read. */
  limit: number;
  /** Pause between requests, in ms. */
  delayMs: number;
  onProgress?: (posts: number) => void;
}

export interface SocialExtractor {
  site: SocialSite;
  extract(link: SocialLink, context: SocialContext, profile?: ProfileOptions): Promise<SocialPost>;
}

/** Saved with a "photo with song" download. */
export interface SocialVideoJob {
  images: {url: string; ext: string}[];
  audioUrl: string;
  headers?: Record<string, string>;
  /** Seconds into the song. */
  start?: number;
  /** Seconds of song to use; the whole song when missing. */
  duration?: number;
  secondsPerImage: number;
  crossfade: boolean;
  width?: number;
  height?: number;
  /** Step shown in Downloads. */
  stage?: string;
}
