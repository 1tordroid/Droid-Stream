/**
 * What the browser found on a page: classified by URL and type, merged so
 * the same file found by the page script and the network hook shows once.
 */

export type MediaKind = 'video' | 'audio' | 'image' | 'hls' | 'dash' | 'torrent' | 'magnet' | 'file';

export interface MediaItem {
  url: string;
  kind: MediaKind;
  /** The page it was found on (sent as Referer). */
  pageUrl: string;
  title?: string;
  poster?: string;
  quality?: string;
  width?: number;
  height?: number;
  size?: number;
  mime?: string;
  /** A player fed by MediaSource: the file has no URL, so the page is used. */
  blob?: boolean;
  source: 'page' | 'network' | 'download';
  foundAt: number;
}

const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|flv|3gp|wmv|mpeg|mpg)$/;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba|wma)$/;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|heic)$/;
const FILE_EXT = /\.(zip|rar|7z|apk|pdf|exe|msi|dmg|iso|tar|gz|xz|epub)$/;

const pathOf = (url: string): string => {
  try {
    return decodeURIComponent(url.split(/[?#]/)[0]).toLowerCase();
  } catch {
    return url.split(/[?#]/)[0].toLowerCase();
  }
};

/** Pieces of a stream (HLS segments, DASH fragments, init chunks), which are not worth listing. */
export const isSegmentUrl = (url: string): boolean => {
  const path = pathOf(url);
  if (/\.(ts|m4s|m4f|cmfv|cmfa|aac|vtt|webvtt|key)$/.test(path) && !/\.m3u8|\.mpd/.test(path)) return true;
  if (/(^|[/_.-])(seg|segment|chunk|frag|fragment)[-_]?\d+/.test(path)) return true;
  if (/\/(init|range)[-_]?\d*\.(mp4|m4s|webm)$/.test(path)) return true;
  // YouTube streams in byte ranges of many files; yt-dlp handles these pages.
  if (/googlevideo\.com\/videoplayback/i.test(url)) return true;
  return false;
};

/** The whole file for a URL that asks for one byte range of it (Instagram and Facebook do this). */
export const normalizeMediaUrl = (url: string): string => {
  if (!/[?&](bytestart|byteend)=/i.test(url)) return url;
  const [base, hash] = url.split('#');
  const [path, query = ''] = base.split('?');
  const kept = query.split('&').filter(part => part && !/^(bytestart|byteend)=/i.test(part));
  return `${path}${kept.length ? `?${kept.join('&')}` : ''}${hash ? `#${hash}` : ''}`;
};

export const classifyMedia = (url: string, mime = ''): MediaKind | null => {
  const text = url.trim();
  if (/^magnet:\?/i.test(text)) return 'magnet';
  if (!/^https?:\/\//i.test(text)) return null;
  const type = mime.toLowerCase().split(';')[0].trim();
  const path = pathOf(text);
  if (type === 'application/x-bittorrent' || path.endsWith('.torrent')) return 'torrent';
  if (/mpegurl/.test(type) || path.endsWith('.m3u8') || /[?&]format=m3u8/i.test(text)) return 'hls';
  if (type === 'application/dash+xml' || path.endsWith('.mpd')) return 'dash';
  if (isSegmentUrl(text)) return null;
  if (type.startsWith('video/') || VIDEO_EXT.test(path)) return 'video';
  if (type.startsWith('audio/') || AUDIO_EXT.test(path)) return 'audio';
  if (type.startsWith('image/') || IMAGE_EXT.test(path)) return 'image';
  if (FILE_EXT.test(path) || type === 'application/octet-stream' || type === 'application/zip' || type === 'application/vnd.android.package-archive') return 'file';
  return null;
};

/** "1080p" and the like, when the URL or a size says so. */
export const qualityOf = (url: string, height?: number): string | undefined => {
  if (height && height > 0) return `${height}p`;
  const match = /(?:^|[^a-z0-9])(2160|1440|1080|720|540|480|360|240|144)p?(?:[^0-9]|$)/i.exec(pathOf(url));
  return match ? `${match[1]}p` : /(?:^|[^a-z])(4k|uhd)(?:[^a-z]|$)/i.test(pathOf(url)) ? '2160p' : undefined;
};

export const fileNameOf = (url: string, fallback = 'download'): string => {
  const last = pathOf(url).replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/, '').split('/').filter(Boolean).pop() || '';
  const clean = last.replace(/[\\:*?"<>|]+/g, '_').slice(0, 120);
  return clean || fallback;
};

const KIND_ORDER: MediaKind[] = ['video', 'hls', 'dash', 'audio', 'torrent', 'magnet', 'file', 'image'];

/** Adds a found item, merging what was known about the same file. Newest pages first. */
export const mergeMedia = (list: MediaItem[], item: MediaItem, limit = 200): MediaItem[] => {
  const url = normalizeMediaUrl(item.url);
  const index = list.findIndex(entry => entry.url === url);
  if (index >= 0) {
    const merged: MediaItem = {...list[index]};
    for (const key of ['title', 'poster', 'quality', 'width', 'height', 'size', 'mime'] as const) {
      if (merged[key] === undefined && item[key] !== undefined) (merged as any)[key] = item[key];
    }
    if (merged.kind === 'file' && item.kind !== 'file') merged.kind = item.kind;
    const next = list.slice();
    next[index] = merged;
    return next;
  }
  return [{...item, url}, ...list].slice(0, limit);
};

export const sortMedia = (list: MediaItem[]): MediaItem[] =>
  list.slice().sort((left, right) => {
    const kind = KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
    if (kind) return kind;
    const area = (right.width || 0) * (right.height || 0) - (left.width || 0) * (left.height || 0);
    if (area) return area;
    return (right.size || 0) - (left.size || 0);
  });

/** Videos and streams, which get the floating download button. */
export const isPlayable = (item: MediaItem): boolean => item.kind === 'video' || item.kind === 'hls' || item.kind === 'dash' || item.kind === 'audio';

/** Sites whose pages yt-dlp reads well, so their videos go to the yt-dlp sheet. */
const YTDL_SITES = [
  'youtube.com', 'youtu.be', 'instagram.com', 'facebook.com', 'fb.watch', 'x.com', 'twitter.com', 'tiktok.com',
  'reddit.com', 'vimeo.com', 'dailymotion.com', 'twitch.tv', 'soundcloud.com', 'bilibili.com', 'pinterest.com',
  'tumblr.com', 'streamable.com', 'rumble.com', 'bandcamp.com', 'mixcloud.com', 'threads.net', 'linkedin.com',
  'ok.ru', 'vk.com', 'archive.org', 'ted.com', 'bitchute.com', 'odysee.com', 'kick.com', 'imgur.com',
];

const onSite = (host: string, sites: string[]): boolean =>
  sites.some(site => host === site || host.endsWith(`.${site}`));

export const hostOfUrl = (url: string): string =>
  /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^:/?#]+)/i.exec(url)?.[1]?.toLowerCase() || '';

export const isYtdlSite = (pageUrl: string): boolean => onSite(hostOfUrl(pageUrl), YTDL_SITES);

export const KIND_LABEL: Record<MediaKind, string> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Image',
  hls: 'Stream (HLS)',
  dash: 'Stream (DASH)',
  torrent: 'Torrent',
  magnet: 'Magnet',
  file: 'File',
};
