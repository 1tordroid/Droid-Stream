/**
 * Which Live TV channels can be recorded: never those known to use DRM
 * (Widevine, PlayReady, ClearKey, FairPlay, SAMPLE-AES). Plain AES-128 HLS is
 * ordinary encryption and can be recorded. Pure: runs in unit tests.
 */
import {isDrmKeyLine} from './livePlaylist';

export const PROTECTED_CHANNEL_MESSAGE = "This channel is protected and can't be recorded.";

/** Playlist option names that carry a DRM licence (#KODIPROP, #EXTVLCOPT, #EXTINF attributes). */
const DRM_OPTION = /(^|[._-])(license|licence|drm|clearkey|widevine|playready)([._-]|$)/i;

/**
 * Whether one playlist line or option says the channel needs a DRM licence:
 * `#KODIPROP:inputstream.adaptive.license_type=...`, `...license_key=...`,
 * `#EXTVLCOPT:drm=...` and the like. `inputstream.adaptive.manifest_type` alone is not DRM.
 */
export const isDrmOption = (line: string): boolean => {
  const body = line.replace(/^#(KODIPROP|EXTVLCOPT):/i, '');
  const eq = body.indexOf('=');
  const name = (eq >= 0 ? body.slice(0, eq) : body).trim();
  const value = eq >= 0 ? body.slice(eq + 1).trim() : '';
  if (!name || !value) return false;
  return DRM_OPTION.test(name) || /^com\.(widevine|microsoft\.playready)|^org\.w3\.clearkey/i.test(value);
};

/** Whether a fetched HLS playlist or DASH manifest uses DRM. */
export const manifestUsesDrm = (text: string): boolean => {
  if (/<(?:[\w-]+:)?ContentProtection\b/i.test(text)) return true;
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .some(line => (line.startsWith('#EXT-X-KEY:') || line.startsWith('#EXT-X-SESSION-KEY:')) && isDrmKeyLine(line));
};

export interface ChannelProtectionInfo {
  url: string;
  /** Set by the M3U reader when the entry has a licence option. */
  drm?: boolean;
  /** #EXTINF attributes, lower-case keys. */
  attrs?: Record<string, string>;
}

/**
 * Known to use DRM: flagged by the playlist, a licence attribute, a DASH
 * address (live DASH here is the Widevine path, e.g. JioTV), or found out
 * earlier when the channel was played or recorded ([knownProtected]).
 */
export const isDrmProtected = (channel: ChannelProtectionInfo, knownProtected: ReadonlySet<string> = new Set()): boolean => {
  if (channel.drm || knownProtected.has(channel.url)) return true;
  if (Object.entries(channel.attrs || {}).some(([name, value]) => isDrmOption(`${name}=${value}`))) return true;
  return /\.mpd(\?|#|$)/i.test(channel.url);
};

/** Shows Record only for channels not known to use DRM, with an address that can be recorded. */
export const canRecordChannel = (channel: ChannelProtectionInfo, knownProtected?: ReadonlySet<string>): boolean =>
  !isDrmProtected(channel, knownProtected) && (/^https?:\/\//i.test(channel.url) || /^jiotv:\w+$/.test(channel.url));
