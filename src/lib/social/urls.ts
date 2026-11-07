import type {SocialLink, SocialSite} from './types';

const parse = (value: string): URL | undefined => {
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) return undefined;
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
};

const hostOf = (url: URL): string => url.hostname.toLowerCase().replace(/^(www|m|mobile|web|mbasic|old|new|np)\./, '');

const segments = (url: URL): string[] =>
  url.pathname
    .split('/')
    .filter(Boolean)
    .map(part => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });

// Instagram paths that are not user names.
const INSTAGRAM_RESERVED = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about', 'legal', 'developer',
  'web', 's', 'challenge', 'emails', 'session', 'privacy', 'terms', 'press', 'api', 'graphql', 'static',
]);

const USER_NAME = /^[A-Za-z0-9._]{1,30}$/;

/** "aGlnaGxpZ2h0OjE3OTk5" in a /s/ share link is base64 for "highlight:17999…". */
const highlightFromShare = (code: string): string | undefined => {
  try {
    const padded = code.replace(/-/g, '+').replace(/_/g, '/');
    const text = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('utf8');
    return text.match(/^highlight:(\d+)$/)?.[1];
  } catch {
    return undefined;
  }
};

const instagram = (url: URL): SocialLink | undefined => {
  const parts = segments(url);
  const href = url.toString();
  if (parts.length === 0) return undefined;
  const postAt = parts.findIndex(part => ['p', 'reel', 'reels', 'tv'].includes(part));
  if (postAt >= 0 && postAt <= 1 && parts[postAt + 1]) {
    return {site: 'instagram', kind: 'post', url: href, id: parts[postAt + 1], user: postAt === 1 ? parts[0] : undefined};
  }
  if (parts[0] === 'stories') {
    if (parts[1] === 'highlights' && /^\d+$/.test(parts[2] || '')) {
      return {site: 'instagram', kind: 'highlight', url: href, id: parts[2]};
    }
    if (parts[1] && USER_NAME.test(parts[1])) {
      return {site: 'instagram', kind: 'story', url: href, user: parts[1], id: /^\d+$/.test(parts[2] || '') ? parts[2] : undefined};
    }
    return undefined;
  }
  if (parts[0] === 's' && parts[1]) {
    const id = highlightFromShare(parts[1]);
    return id ? {site: 'instagram', kind: 'highlight', url: href, id} : undefined;
  }
  if (parts.length === 1 && USER_NAME.test(parts[0]) && !INSTAGRAM_RESERVED.has(parts[0].toLowerCase())) {
    return {site: 'instagram', kind: 'profile', url: href, user: parts[0]};
  }
  return undefined;
};

const facebook = (url: URL): SocialLink | undefined => {
  const parts = segments(url);
  const href = url.toString();
  const query = url.searchParams;
  const first = (parts[0] || '').toLowerCase();
  // Video pages go to the video downloader.
  if (['watch', 'reel', 'videos'].includes(first) || parts.includes('videos')) return undefined;
  if (first === 'share') {
    if (['v', 'r'].includes(parts[1] || '')) return undefined;
    const code = parts[1] === 'p' ? parts[2] : parts[1];
    return code ? {site: 'facebook', kind: 'post', url: href, id: code} : undefined;
  }
  const fbid = query.get('fbid') || query.get('story_fbid');
  if (['photo', 'photo.php', 'permalink.php', 'story.php'].includes(first) && fbid) {
    return {site: 'facebook', kind: 'post', url: href, id: fbid, user: query.get('id') || undefined};
  }
  const postAt = parts.findIndex(part => ['posts', 'permalink', 'photos'].includes(part));
  if (postAt >= 1 && parts[postAt + 1]) {
    const id = parts[parts.length - 1];
    return {site: 'facebook', kind: 'post', url: href, id, user: first === 'groups' ? parts[1] : parts[0]};
  }
  return undefined;
};

const twitter = (url: URL): SocialLink | undefined => {
  const parts = segments(url);
  const at = parts.indexOf('status');
  const id = at >= 1 ? parts[at + 1] : undefined;
  if (!id || !/^\d{5,25}$/.test(id)) return undefined;
  const user = parts[at - 1] !== 'web' && parts[0] !== 'i' ? parts[0] : undefined;
  return {site: 'twitter', kind: 'post', url: url.toString(), id, user};
};

const threads = (url: URL): SocialLink | undefined => {
  const parts = segments(url);
  if (parts[0]?.startsWith('@') && parts[1] === 'post' && parts[2]) {
    return {site: 'threads', kind: 'post', url: url.toString(), id: parts[2], user: parts[0].slice(1)};
  }
  if (parts[0] === 't' && parts[1]) return {site: 'threads', kind: 'post', url: url.toString(), id: parts[1]};
  return undefined;
};

const pinterest = (url: URL, host: string): SocialLink | undefined => {
  const parts = segments(url);
  if (host === 'pin.it') return parts[0] ? {site: 'pinterest', kind: 'post', url: url.toString()} : undefined;
  if (parts[0] !== 'pin' || !parts[1]) return undefined;
  // "/pin/some-title--1234567/" or "/pin/1234567/"
  const id = parts[1].match(/(?:^|--)(\d{5,25})$/)?.[1] || (/^[A-Za-z0-9_-]{10,}$/.test(parts[1]) ? parts[1] : undefined);
  return id ? {site: 'pinterest', kind: 'post', url: url.toString(), id} : undefined;
};

const reddit = (url: URL, host: string): SocialLink | undefined => {
  const parts = segments(url);
  if (host === 'redd.it') return parts[0] ? {site: 'reddit', kind: 'post', url: url.toString(), id: parts[0]} : undefined;
  const at = parts.indexOf('comments');
  if (at >= 0 && parts[at + 1]) {
    return {site: 'reddit', kind: 'post', url: url.toString(), id: parts[at + 1], user: parts[0] === 'r' ? parts[1] : undefined};
  }
  // Share links ("/r/pics/s/AbCd") redirect to the post.
  if (parts[0] === 'r' && parts[2] === 's' && parts[3]) return {site: 'reddit', kind: 'post', url: url.toString()};
  return undefined;
};

const tumblr = (url: URL, host: string): SocialLink | undefined => {
  const parts = segments(url);
  const href = url.toString();
  if (host !== 'tumblr.com' && host.endsWith('.tumblr.com')) {
    const blog = host.slice(0, -'.tumblr.com'.length);
    if (parts[0] === 'post' && /^\d+$/.test(parts[1] || '')) return {site: 'tumblr', kind: 'post', url: href, id: parts[1], user: blog};
    return undefined;
  }
  if (host !== 'tumblr.com') return undefined;
  if (parts[0] === 'blog' && parts[1] === 'view' && parts[2] && /^\d+$/.test(parts[3] || '')) {
    return {site: 'tumblr', kind: 'post', url: href, id: parts[3], user: parts[2]};
  }
  if (parts[0] && /^\d+$/.test(parts[1] || '')) return {site: 'tumblr', kind: 'post', url: href, id: parts[1], user: parts[0]};
  return undefined;
};

const SITE_HOSTS: {site: SocialSite; test: (host: string) => boolean}[] = [
  {site: 'instagram', test: host => host === 'instagram.com' || host === 'instagr.am'},
  {site: 'facebook', test: host => host === 'facebook.com' || host === 'fb.com'},
  {site: 'twitter', test: host => ['twitter.com', 'x.com', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com', 'fixvx.com'].includes(host)},
  {site: 'threads', test: host => host === 'threads.net' || host === 'threads.com'},
  {site: 'pinterest', test: host => host === 'pin.it' || /(^|\.)pinterest\.[a-z.]{2,6}$/.test(host)},
  {site: 'reddit', test: host => host === 'reddit.com' || host === 'redd.it'},
  {site: 'tumblr', test: host => host === 'tumblr.com' || host.endsWith('.tumblr.com')},
];

/** Which site and what kind of page a link is, or undefined for other links. */
export const classifySocialUrl = (value: string): SocialLink | undefined => {
  const url = parse(value);
  if (!url) return undefined;
  const host = hostOf(url);
  const site = SITE_HOSTS.find(entry => entry.test(host))?.site;
  switch (site) {
    case 'instagram':
      return instagram(url);
    case 'facebook':
      return facebook(url);
    case 'twitter':
      return twitter(url);
    case 'threads':
      return threads(url);
    case 'pinterest':
      return pinterest(url, host);
    case 'reddit':
      return reddit(url, host);
    case 'tumblr':
      return tumblr(url, host);
    default:
      return undefined;
  }
};

/** A post, story, highlight or profile on a site the photo downloader reads. */
export const isSocialPostUrl = (url: string): boolean => Boolean(classifySocialUrl(url));

/** First social link inside shared or copied text. */
export const socialLinkInText = (text: string): string | undefined => {
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    const link = match[0].replace(/[),.!?]+$/, '');
    if (isSocialPostUrl(link)) return link;
  }
  return undefined;
};

export const SITE_LABELS: Record<SocialSite, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'X',
  threads: 'Threads',
  pinterest: 'Pinterest',
  reddit: 'Reddit',
  tumblr: 'Tumblr',
};

/** Site whose cookies a sign-in gives, as saved by the cookie screen. */
export const SITE_COOKIE_HOSTS: Record<SocialSite, string> = {
  instagram: 'instagram.com',
  facebook: 'facebook.com',
  twitter: 'x.com',
  threads: 'threads.com',
  pinterest: 'pinterest.com',
  reddit: 'reddit.com',
  tumblr: 'tumblr.com',
};
