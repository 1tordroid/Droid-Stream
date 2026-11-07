import type {SocialSite} from '../types';

/**
 * The shape of the site rules file. Rules are data only: links, ids, header
 * values, JSON paths and patterns the site readers use. Everything that
 * decides what the app does stays in code.
 */

/** Rules files this app can read. A file with another schema is ignored. */
export const RULES_SCHEMA = 1;

/** Kinds of value a rule can hold. */
export type RuleKind =
  /** A link with {placeholders}, on one of the site's own hosts. */
  | 'url'
  /** A short plain text, such as an id or a header name. */
  | 'text'
  /** A list of short texts. */
  | 'texts'
  /** Header names and values. */
  | 'headers'
  /** A dotted JSON path, such as "data.user". */
  | 'path'
  /** JSON paths tried in order. */
  | 'paths'
  /** A pattern from the safe subset (see safeRegex.ts). */
  | 'pattern'
  /** Small JSON values (null, true, numbers, short texts) by name. */
  | 'values';

type SpecNode = RuleKind | {readonly [key: string]: SpecNode};

export const SITE_SPEC = {
  instagram: {
    signInCookie: 'text',
    csrfCookie: 'text',
    csrfHeader: 'text',
    headers: 'headers',
    pages: {home: 'url', origin: 'url', post: 'url', profile: 'url'},
    endpoints: {
      mediaInfo: 'url',
      graphql: 'url',
      embed: 'url',
      profileInfo: 'url',
      userInfo: 'url',
      feed: 'url',
      reelsMedia: 'url',
    },
    graphql: {
      docId: 'text',
      queryName: 'text',
      queryNameHeader: 'text',
      shortcodeVariable: 'text',
      variables: 'values',
      media: 'paths',
    },
    paths: {
      embedMedia: 'text',
      profileUser: 'path',
    },
    patterns: {
      embedContext: 'pattern',
      embedImage: 'pattern',
      embedSrcset: 'pattern',
      embedSrc: 'pattern',
      embedUsername: 'pattern',
    },
  },
  twitter: {
    headers: 'headers',
    endpoints: {tweet: 'url'},
    tombstoneType: 'text',
    patterns: {photo: 'pattern', videoSize: 'pattern'},
  },
  reddit: {
    headers: 'headers',
    endpoints: {post: 'url', postFallback: 'url', originalImage: 'url'},
    patterns: {imageLink: 'pattern', imageExtension: 'pattern'},
  },
  tumblr: {
    endpoints: {read: 'url'},
    photoSizes: 'texts',
    htmlFields: 'texts',
    patterns: {readPrefix: 'pattern', readMarker: 'pattern', mediaHost: 'pattern', video: 'pattern'},
  },
  pinterest: {
    headers: 'headers',
    endpoints: {resource: 'url', pin: 'url'},
    fieldSetKey: 'text',
    sizeKeys: 'texts',
    paths: {pin: 'path'},
    patterns: {sizeInLink: 'pattern'},
    originalSize: 'text',
  },
  threads: {
    headers: 'headers',
    endpoints: {post: 'url', postWithUser: 'url'},
    patterns: {placeholderImage: 'pattern'},
  },
  facebook: {
    headers: 'headers',
    signInCookie: 'text',
    photoType: 'text',
    imageKeys: 'texts',
    patterns: {
      loginRedirect: 'pattern',
      viewerImage: 'pattern',
      video: 'pattern',
      owner: 'pattern',
      cdnImage: 'pattern',
      titleSuffix: 'pattern',
    },
  },
} as const satisfies Record<SocialSite, SpecNode>;

/**
 * Hosts each site's links may point at. This list is in code on purpose:
 * a rules file can never send a request (or the sign-in token in it) to a
 * host outside the site.
 */
export const SITE_HOSTS: Record<SocialSite, readonly string[]> = {
  instagram: ['instagram.com'],
  twitter: ['twimg.com', 'twitter.com', 'x.com'],
  reddit: ['reddit.com', 'redd.it'],
  tumblr: ['tumblr.com'],
  pinterest: ['pinterest.com'],
  threads: ['threads.com', 'threads.net'],
  facebook: ['facebook.com'],
};

export interface RulePattern {
  pattern: string;
  /** Any of "i", "m" and "s". The app adds "g" itself where it needs it. */
  flags?: string;
}

export type RuleValue = string | number | boolean | null;

type ValueOf<K> = K extends 'url' | 'text' | 'path'
  ? string
  : K extends 'texts' | 'paths'
    ? string[]
    : K extends 'headers'
      ? Record<string, string>
      : K extends 'pattern'
        ? RulePattern
        : K extends 'values'
          ? Record<string, RuleValue>
          : never;

type Shape<S> = {[K in keyof S]: S[K] extends string ? ValueOf<S[K]> : Shape<S[K]>};

export type SiteRules = Shape<typeof SITE_SPEC>;

export interface SocialRules {
  /** Format of the file; see RULES_SCHEMA. */
  schema: number;
  /** Goes up by one with every change. A phone only takes a higher version. */
  version: number;
  /** Day of the change, YYYY-MM-DD. */
  updated: string;
  sites: SiteRules;
}

export const RULE_SITES = Object.keys(SITE_SPEC) as SocialSite[];
