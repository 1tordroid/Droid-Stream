/**
 * Pure helpers for the player screen, moved out of Player.tsx so they can be
 * read and tested on their own. Behaviour is unchanged.
 */
import {isWatched} from '../../../lib/player/upNext';
import type {SkipInterval} from '../../../lib/providers/types';
import {cacheStorage, settingsStorage, watchProgressStorage} from '../../../lib/storage';
import type {DownloadItem} from '../../../lib/zustand/downloadsStore';

export const readCachedProgress = (link?: string) => {
  if (!link) {
    return {position: 0, duration: 0};
  }
  const progress = watchProgressStorage.getProgress(link);
  return {
    position: progress?.position || 0,
    duration: progress?.duration || 0,
  };
};

export const getCachedSkips = (keys: (string | undefined)[]): SkipInterval[] => {
  for (const key of keys) {
    if (!key) continue;
    try {
      const cached = cacheStorage.getString(`skips_${key}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {}
  }
  return [];
};

export const cacheSkips = (keys: (string | undefined)[], skips: SkipInterval[]) => {
  if (!skips || skips.length === 0) return;
  const serialized = JSON.stringify(skips);
  for (const key of keys) {
    if (!key) continue;
    try {
      cacheStorage.setString(`skips_${key}`, serialized);
    } catch {}
  }
};

// Download that holds the file or source of the playing episode, if any.
export const findDownloadForEpisode = (
  downloads: Record<string, DownloadItem>,
  activeEpisode: any,
  selectedStream: any,
): DownloadItem | undefined =>
  Object.values(downloads).find(
    d =>
      (activeEpisode?.id && d.id === activeEpisode.id) ||
      (activeEpisode?.link &&
        (d.filePath === activeEpisode.link ||
          d.url === activeEpisode.link ||
          d.sourceLink === activeEpisode.link)) ||
      (activeEpisode?.sourceLink &&
        (d.sourceLink === activeEpisode.sourceLink ||
          d.url === activeEpisode.sourceLink ||
          d.filePath === activeEpisode.sourceLink)) ||
      (selectedStream?.link &&
        (d.filePath === selectedStream.link || d.url === selectedStream.link)),
  );

// Everything the screen renders from the playback position: the active skip
// interval and whether the "Next" button shows (past 80% of the video).
export const getPlaybackRenderKey = (
  time: number,
  skips: SkipInterval[],
  duration: number,
) => {
  const skipIndex = skips.findIndex(s => time >= s.from && time < s.to);
  const nearEnd = duration > 0 && time / duration > 0.8;
  return `${skipIndex}:${nearEnd}`;
};

export const getResumePosition = (position: number, duration: number) => {
  if (!Number.isFinite(position) || position <= 5) {
    return 0;
  }

  // Completed episodes (including the 1/1 and legacy 10000/1 "watched"

  if (isWatched(position, duration)) {
    return 0;
  }

  return position;
};

export const formatTVTimelineTime = (time: number): string => {
  if (!Number.isFinite(time) || time < 0) return '00:00';
  const seconds = Math.floor(time);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const minuteText = minutes.toString().padStart(2, '0');
  const secondText = remainder.toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${minuteText}:${secondText}`
    : `${minuteText}:${secondText}`;
};

/** "#RGB" / "#RRGGBB" / "#AARRGGBB" to Android "#AARRGGBB" with the given alpha. */
export const withAlpha = (hex: string, opacity: number) => {
  let rgb = hex.replace('#', '');
  if (rgb.length === 3)
    rgb = rgb
      .split('')
      .map(c => c + c)
      .join('');
  if (rgb.length === 8) rgb = rgb.slice(2);
  if (!/^[0-9a-f]{6}$/i.test(rgb) || opacity >= 1) return hex;
  const alpha = Math.round(Math.max(0, opacity) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${alpha}${rgb}`;
};

export const readSubtitleStyle = () => ({
  fontSize: settingsStorage.getSubtitleFontSize() ?? 16,
  opacity: settingsStorage.getSubtitleOpacity() ?? 1,
  paddingBottom: settingsStorage.getSubtitleBottomPadding() ?? 10,
  textColor: withAlpha(
    settingsStorage.getSubtitleTextColor(),
    settingsStorage.getSubtitleTextOpacity(),
  ),
  fontFamily: settingsStorage.getSubtitleFontFamily(),
  edgeType: settingsStorage.getSubtitleEdgeType(),
  edgeColor: withAlpha(
    settingsStorage.getSubtitleEdgeColor(),
    settingsStorage.getSubtitleTextOpacity(),
  ),
  outlineWidth: settingsStorage.getSubtitleOutlineWidth() ?? 2,
  subtitlesFollowVideo: false,
});


export type QualityIconName = '8k' | '4k' | '2k' | 'hd' | 'sd' | 'video-settings';

export const getQualityIconName = (
  height?: number | string,
  fallbackQuality?: string,
): QualityIconName => {
  const normalizedFallback = fallbackQuality?.trim().toLowerCase() || '';
  const parsedHeight =
    Number(height) || Number(normalizedFallback.match(/\d+/)?.[0]);

  if (parsedHeight >= 3000 || /(?:8k|4320)/.test(normalizedFallback)) {
    return '8k';
  }
  if (parsedHeight >= 1500 || /(?:4k|2160)/.test(normalizedFallback)) {
    return '4k';
  }
  if (parsedHeight >= 1200 || normalizedFallback.includes('1440')) {
    return '2k';
  }
  if (parsedHeight >= 500 || /(?:1080|720|\bhd\b)/.test(normalizedFallback)) {
    return 'hd';
  }
  if (
    parsedHeight > 0 ||
    /(?:480|360|240|144|\bsd\b)/.test(normalizedFallback)
  ) {
    return 'sd';
  }

  return 'video-settings';
};

// URL of the phone's torrent stream server, which only listens on loopback.
export const TORRENT_STREAM_URL = /^http:\/\/127\.0\.0\.1:\d+\/stream\//i;

export const isCastableStreamUrl = (streamUrl: string, streamType?: string) => {
  // The delivery server relays the torrent stream to the receiver.
  if (TORRENT_STREAM_URL.test(streamUrl)) {
    return true;
  }
  if (streamType === 'torrent') {
    return false;
  }
  // Downloaded files are served to the receiver by the phone's delivery server.
  if (/^(content|file):\/\//i.test(streamUrl) || streamUrl.startsWith('/')) {
    return true;
  }
  if (!/^https?:\/\//i.test(streamUrl)) {
    return false;
  }

  try {
    const hostname = new URL(streamUrl).hostname.toLowerCase();
    return !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname);
  } catch {
    return false;
  }
};
