import type {YtdlFormat, YtdlInfo, YtdlPlaylistEntry, YtdlVideoInfo} from './types';

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const hasCodec = (codec?: string | null): boolean => Boolean(codec && codec !== 'none');

export const isVideoFormat = (format: YtdlFormat): boolean =>
  hasCodec(format.vcodec) || (!format.vcodec && Boolean(format.height));

export const isAudioOnlyFormat = (format: YtdlFormat): boolean =>
  hasCodec(format.acodec) && format.vcodec === 'none';

const parseFormat = (value: unknown): YtdlFormat | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const id = text(item.id);
  if (!id) return null;
  return {
    id,
    ext: text(item.ext),
    width: number(item.width),
    height: number(item.height),
    fps: number(item.fps),
    vcodec: text(item.vcodec) ?? null,
    acodec: text(item.acodec) ?? null,
    filesize: number(item.filesize),
    tbr: number(item.tbr),
    abr: number(item.abr),
    note: text(item.note) ?? null,
    protocol: text(item.protocol) ?? null,
    dynamicRange: text(item.dynamicRange) ?? null,
    language: text(item.language) ?? null,
  };
};

const parseEntry = (value: unknown, index: number): YtdlPlaylistEntry | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const url = text(item.url);
  if (!url) return null;
  return {
    index: number(item.index) ?? index + 1,
    id: text(item.id) ?? null,
    title: text(item.title) || `Item ${index + 1}`,
    url,
    duration: number(item.duration),
    thumbnail: text(item.thumbnail) ?? null,
    uploader: text(item.uploader) ?? null,
  };
};

/** Turns the native module's JSON into typed info. Throws on anything unusable. */
export const parseYtdlInfo = (json: string, url: string): YtdlInfo => {
  const raw = JSON.parse(json) as Record<string, unknown>;
  if (raw.type === 'playlist') {
    const entries = (Array.isArray(raw.entries) ? raw.entries : [])
      .map(parseEntry)
      .filter((entry): entry is YtdlPlaylistEntry => entry !== null);
    return {
      type: 'playlist',
      id: text(raw.id) ?? null,
      title: text(raw.title) || 'Playlist',
      uploader: text(raw.uploader) ?? null,
      webpageUrl: text(raw.webpageUrl) || url,
      extractor: text(raw.extractor) ?? null,
      entries,
    };
  }
  const subtitles: Record<string, string | null> = {};
  if (raw.subtitles && typeof raw.subtitles === 'object') {
    for (const [code, name] of Object.entries(raw.subtitles as Record<string, unknown>)) {
      subtitles[code] = text(name) ?? null;
    }
  }
  return {
    type: 'video',
    id: text(raw.id),
    title: text(raw.title) || 'Video',
    uploader: text(raw.uploader) ?? null,
    duration: number(raw.duration),
    thumbnail: text(raw.thumbnail) ?? null,
    webpageUrl: text(raw.webpageUrl) || url,
    extractor: text(raw.extractor) ?? null,
    isLive: raw.isLive === true,
    chapters: number(raw.chapters) ?? 0,
    formats: (Array.isArray(raw.formats) ? raw.formats : [])
      .map(parseFormat)
      .filter((format): format is YtdlFormat => format !== null),
    subtitles,
    automaticCaptions: (Array.isArray(raw.automaticCaptions) ? raw.automaticCaptions : []).filter(
      (code): code is string => typeof code === 'string',
    ),
    originalLanguage: text(raw.originalLanguage) ?? null,
  };
};

export interface QualityOption {
  /** null is "Best". */
  height: number | null;
  label: string;
  /** Largest known size of a video stream at this height, without audio. */
  size?: number;
  fps?: number;
  hdr?: boolean;
}

const qualityLabel = (option: QualityOption): string => {
  const height = option.height || 0;
  const fps = option.fps && option.fps > 30 ? Math.round(option.fps) : '';
  const name = height >= 4320 ? ' (8K)' : height >= 2160 ? ' (4K)' : '';
  return `${height}p${fps}${name}${option.hdr ? ' HDR' : ''}`;
};

/** One choice per video height, highest first, with "Best" on top. */
export const qualityOptions = (info: YtdlVideoInfo): QualityOption[] => {
  const byHeight = new Map<number, QualityOption>();
  for (const format of info.formats) {
    if (!isVideoFormat(format) || !format.height) continue;
    // Storyboards and image tracks are not videos.
    if (format.protocol === 'mhtml' || format.ext === 'mhtml') continue;
    const option = byHeight.get(format.height) || {height: format.height, label: ''};
    if (format.filesize && (!option.size || format.filesize > option.size)) option.size = format.filesize;
    if (format.fps && (!option.fps || format.fps > option.fps)) option.fps = format.fps;
    if (format.dynamicRange && format.dynamicRange !== 'SDR') option.hdr = true;
    byHeight.set(format.height, option);
  }
  const options = [...byHeight.values()]
    .sort((left, right) => (right.height || 0) - (left.height || 0))
    .map(option => ({...option, label: qualityLabel(option)}));
  return [{height: null, label: 'Best'}, ...options];
};

/** The size of the best audio stream, to add to a video-only size. */
export const bestAudioSize = (info: YtdlVideoInfo): number | undefined => {
  const sizes = info.formats
    .filter(isAudioOnlyFormat)
    .map(format => format.filesize || 0)
    .filter(size => size > 0);
  return sizes.length ? Math.max(...sizes) : undefined;
};

export interface SubtitleLanguage {
  code: string;
  name: string;
  auto: boolean;
}

/** Uploaded subtitles first, then automatic captions in the original language. */
export const subtitleLanguages = (info: YtdlVideoInfo): SubtitleLanguage[] => {
  const result: SubtitleLanguage[] = Object.entries(info.subtitles)
    // Live chat replays are not subtitles.
    .filter(([code]) => code !== 'live_chat')
    .map(([code, name]) => ({code, name: name || code, auto: false}))
    .sort((left, right) => left.code.localeCompare(right.code));
  const seen = new Set(result.map(item => item.code));
  for (const code of info.automaticCaptions) {
    const base = code.replace(/-orig$/, '');
    if (seen.has(code) || seen.has(base)) continue;
    seen.add(code);
    result.push({code, name: `${base} (auto${code.endsWith('-orig') ? ', original' : ''})`, auto: true});
  }
  return result;
};

/** The languages to tick by default: the user's preferred ones that the video has. */
export const defaultSubtitleSelection = (
  available: SubtitleLanguage[],
  preferred: string[],
): string[] => {
  const picked: string[] = [];
  for (const language of preferred) {
    const wanted = language.toLowerCase();
    const match =
      available.find(item => !item.auto && item.code.toLowerCase() === wanted) ||
      available.find(item => !item.auto && item.code.toLowerCase().startsWith(`${wanted}-`)) ||
      available.find(item => item.auto && item.code.toLowerCase().replace(/-orig$/, '') === wanted);
    if (match && !picked.includes(match.code)) picked.push(match.code);
  }
  return picked;
};

/** Formats for the advanced list: video formats first, by height, then audio. */
export const sortedFormats = (info: YtdlVideoInfo): YtdlFormat[] =>
  info.formats
    .filter(format => format.protocol !== 'mhtml' && format.ext !== 'mhtml')
    .sort((left, right) => {
      const leftVideo = isVideoFormat(left) ? 1 : 0;
      const rightVideo = isVideoFormat(right) ? 1 : 0;
      if (leftVideo !== rightVideo) return rightVideo - leftVideo;
      return (right.height || 0) - (left.height || 0) || (right.tbr || right.abr || 0) - (left.tbr || left.abr || 0);
    });

export const describeFormat = (format: YtdlFormat): string => {
  const parts: string[] = [];
  if (isVideoFormat(format)) {
    parts.push(format.height ? `${format.height}p` : 'video');
    if (format.fps) parts.push(`${Math.round(format.fps)}fps`);
    if (format.vcodec) parts.push(format.vcodec.split('.')[0]);
    if (!hasCodec(format.acodec)) parts.push('no audio');
  } else {
    parts.push('audio');
    if (format.acodec) parts.push(format.acodec.split('.')[0]);
    if (format.abr) parts.push(`${Math.round(format.abr)}k`);
    if (format.language) parts.push(format.language);
  }
  if (format.ext) parts.push(format.ext);
  if (format.note) parts.push(format.note);
  return parts.join(' · ');
};

/** The first URL in shared text such as "Watch this: https://youtu.be/abc". */
export const urlInSharedText = (value: string): string | undefined => {
  const match = value.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  return match?.replace(/[),.;!?]+$/, '');
};

const DIRECT_MEDIA = /\.(mp4|mkv|webm|avi|mov|m4v|mp3|m4a|flac|zip|apk|torrent|m3u8|mpd)(\?|#|$)/i;

/** A web page (not a file) that the yt-dlp downloader should look at. */
export const isPageLink = (url: string): boolean => {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    return !DIRECT_MEDIA.test(new URL(url).pathname);
  } catch {
    return false;
  }
};
