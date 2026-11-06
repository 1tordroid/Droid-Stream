/** Byte range [start, end). The native downloader uses the same split rules. */
export interface PlannedSegment {
  start: number;
  end: number;
  owned: boolean;
}

export interface ByteRange {
  start: number;
  end: number;
}

/** A range is split only when both halves are at least this large. */
export const MIN_SPLIT_BYTES = 2 * 1024 * 1024;

/**
 * Steals the second half of the largest in-progress segment.
 * Returns null when nothing is large enough to split.
 */
export const splitLargestOwned = (
  segments: PlannedSegment[],
): PlannedSegment[] | null => {
  const largest = segments
    .filter(segment => segment.owned && segment.end - segment.start >= MIN_SPLIT_BYTES * 2)
    .sort((left, right) => right.end - right.start - (left.end - left.start))[0];
  if (!largest) return null;
  const middle = largest.start + Math.floor((largest.end - largest.start) / 2);
  return segments.flatMap(segment =>
    segment === largest
      ? [
          {...segment, end: middle},
          {start: middle, end: segment.end, owned: true},
        ]
      : [segment],
  );
};

/**
 * One connection owns the whole file, then idle connections take half of the
 * largest piece until the connection count is filled or pieces are too small.
 * Servers without Range support stay on a single connection.
 */
export const planSegments = (
  totalBytes: number,
  connections: number,
  rangesSupported: boolean,
): PlannedSegment[] => {
  const safeTotal = Math.max(0, Math.floor(totalBytes));
  const wanted = rangesSupported ? Math.max(1, Math.floor(connections)) : 1;
  let segments: PlannedSegment[] = [{start: 0, end: safeTotal, owned: true}];
  while (segments.length < wanted) {
    const next = splitLargestOwned(segments);
    if (!next) break;
    segments = next;
  }
  return segments;
};

/** Sorts ranges and joins overlaps and ranges that touch. */
export const mergeRanges = (ranges: ByteRange[]): ByteRange[] => {
  const sorted = ranges
    .filter(range => range.end > range.start)
    .map(range => ({start: range.start, end: range.end}))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: ByteRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end) {
      merged.push(range);
    } else {
      last.end = Math.max(last.end, range.end);
    }
  }
  return merged;
};

/** Bytes still missing, given the ranges already stored. */
export const missingRanges = (totalBytes: number, downloaded: ByteRange[]): ByteRange[] => {
  const total = Math.max(0, Math.floor(totalBytes));
  const done = mergeRanges(downloaded).filter(range => range.end > 0 && range.start < total);
  const holes: ByteRange[] = [];
  let cursor = 0;
  for (const range of done) {
    const start = Math.max(0, range.start);
    const end = Math.min(total, range.end);
    if (start > cursor) holes.push({start: cursor, end: start});
    cursor = Math.max(cursor, end);
  }
  if (cursor < total) holes.push({start: cursor, end: total});
  return holes;
};

/** What a restarted download still has to fetch, and how much is already safe. */
export const resumePlan = (totalBytes: number, remaining: ByteRange[]) => {
  const holes = mergeRanges(remaining).filter(
    range => range.start >= 0 && range.end <= totalBytes && range.end > range.start,
  );
  const left = holes.reduce((sum, range) => sum + (range.end - range.start), 0);
  return {
    holes,
    downloadedBytes: Math.max(0, totalBytes - left),
    remainingBytes: left,
  };
};

export const retryDelayMs = (
  attempt: number,
  initialMs = 1000,
  maxMs = 30_000,
): number => Math.min(maxMs, initialMs * 2 ** Math.max(0, Math.floor(attempt)));

export const etaSeconds = (remainingBytes: number, bytesPerSecond: number): number | null => {
  if (remainingBytes <= 0) return 0;
  if (bytesPerSecond <= 0) return null;
  return Math.ceil(remainingBytes / bytesPerSecond);
};

export type DownloadCategory = 'Video' | 'Audio' | 'Subtitles' | 'Other';

const VIDEO = /\.(mkv|mp4|avi|mov|m4v|webm|ts|m3u8|mpd)$/i;
const AUDIO = /\.(mp3|m4a|aac|flac|ogg|opus|wav)$/i;
const SUBTITLE = /\.(srt|vtt|ass|ssa|sub)$/i;

export const fileCategory = (name: string, mime = ''): DownloadCategory => {
  const type = mime.toLowerCase();
  if (type.startsWith('video/') || VIDEO.test(name)) return 'Video';
  if (type.startsWith('audio/') || AUDIO.test(name)) return 'Audio';
  if (type.includes('subrip') || type.includes('vtt') || SUBTITLE.test(name)) return 'Subtitles';
  return 'Other';
};

export interface DuplicateCandidate {
  url: string;
  fileName?: string;
  size?: number;
}

export const findDuplicate = <T extends DuplicateCandidate>(
  existing: T[],
  candidate: DuplicateCandidate,
): T | undefined =>
  existing.find(item => {
    if (item.url && candidate.url && item.url === candidate.url) return true;
    return Boolean(
      item.fileName &&
        candidate.fileName &&
        item.fileName === candidate.fileName &&
        item.size &&
        candidate.size &&
        item.size === candidate.size,
    );
  });

export interface ScheduleWindow {
  /** 0 Sunday through 6 Saturday. */
  days: number[];
  startMinutes: number;
  endMinutes: number;
}

export interface TransferPolicy {
  wifiOnly: boolean;
  onWifi: boolean;
  chargingOnly: boolean;
  charging: boolean;
  pauseOnBatterySaver: boolean;
  powerSave: boolean;
  requireVpn: boolean;
  vpnConnected: boolean;
  scheduleEnabled: boolean;
  windows: ScheduleWindow[];
  now: Date;
}

const inWindow = (now: Date, window: ScheduleWindow): boolean => {
  if (window.days.length > 0 && !window.days.includes(now.getDay())) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (window.endMinutes === window.startMinutes) return true;
  if (window.endMinutes > window.startMinutes) {
    return minutes >= window.startMinutes && minutes < window.endMinutes;
  }
  return minutes >= window.startMinutes || minutes < window.endMinutes;
};

export const transferAllowed = (
  policy: TransferPolicy,
): {allowed: boolean; reason?: string} => {
  if (policy.wifiOnly && !policy.onWifi) return {allowed: false, reason: 'Waiting for Wi-Fi'};
  if (policy.chargingOnly && !policy.charging) return {allowed: false, reason: 'Waiting until charging'};
  if (policy.pauseOnBatterySaver && policy.powerSave) {
    return {allowed: false, reason: 'Paused by battery saver'};
  }
  if (policy.requireVpn && !policy.vpnConnected) {
    return {allowed: false, reason: 'Paused because the VPN is down'};
  }
  if (policy.scheduleEnabled && !policy.windows.some(window => inWindow(policy.now, window))) {
    return {allowed: false, reason: 'Outside the download schedule'};
  }
  return {allowed: true};
};

export interface QueueMeta {
  queue: string;
  /** Higher runs first. */
  priority: number;
  order: number;
}

export const compareQueue = (
  left: {id: string; createdAt: number},
  right: {id: string; createdAt: number},
  meta: Record<string, QueueMeta | undefined>,
): number => {
  const leftMeta = meta[left.id];
  const rightMeta = meta[right.id];
  const queue = (leftMeta?.queue || 'Downloads').localeCompare(rightMeta?.queue || 'Downloads');
  if (queue !== 0) return queue;
  const priority = (rightMeta?.priority || 0) - (leftMeta?.priority || 0);
  if (priority !== 0) return priority;
  const order = (leftMeta?.order || 0) - (rightMeta?.order || 0);
  if (order !== 0) return order;
  return left.createdAt === right.createdAt
    ? left.id.localeCompare(right.id)
    : left.createdAt - right.createdAt;
};

export const moveQueueItem = (
  ids: string[],
  id: string,
  direction: -1 | 1,
): string[] => {
  const index = ids.indexOf(id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= ids.length) return ids;
  const copy = ids.slice();
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  return copy;
};

export interface StreamVariant {
  url: string;
  bandwidth?: number;
  height?: number;
  label: string;
  kind: 'video' | 'audio' | 'subtitle';
}

/** Reads an HLS master playlist. A media playlist (no EXT-X-STREAM-INF) returns nothing. */
export const parseHlsVariants = (playlist: string, baseUrl: string): StreamVariant[] => {
  const lines = playlist.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const variants: StreamVariant[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    const next = lines[index + 1];
    if (!next || next.startsWith('#')) continue;
    const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(line)?.[1] || 0) || undefined;
    const height = Number(/RESOLUTION=\d+x(\d+)/.exec(line)?.[1] || 0) || undefined;
    variants.push({
      url: resolveStreamUrl(baseUrl, next),
      bandwidth,
      height,
      kind: 'video',
      label: height ? `${height}p` : bandwidth ? `${Math.round(bandwidth / 1000)} kbps` : 'Video',
    });
  }
  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA')) continue;
    const uri = /URI="([^"]+)"/.exec(line)?.[1];
    if (!uri) continue;
    const type = /TYPE=([^,]+)/.exec(line)?.[1]?.toUpperCase();
    const name = /NAME="([^"]+)"/.exec(line)?.[1] || type || 'Track';
    if (type === 'AUDIO' || type === 'SUBTITLES') {
      variants.push({
        url: resolveStreamUrl(baseUrl, uri),
        kind: type === 'AUDIO' ? 'audio' : 'subtitle',
        label: name,
      });
    }
  }
  return variants;
};

export const parseDashRepresentations = (mpd: string, baseUrl: string): StreamVariant[] => {
  const variants: StreamVariant[] = [];
  const pattern = /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(mpd))) {
    const attrs = match[1];
    const body = match[2];
    const bandwidth = Number(/bandwidth="(\d+)"/i.exec(attrs)?.[1] || 0) || undefined;
    const height = Number(/height="(\d+)"/i.exec(attrs)?.[1] || 0) || undefined;
    const mime = /mimeType="([^"]+)"/i.exec(attrs)?.[1] || '';
    const href = /<BaseURL>\s*([^<]+)\s*<\/BaseURL>/i.exec(body)?.[1]?.trim();
    if (!href) continue;
    variants.push({
      url: resolveStreamUrl(baseUrl, href),
      bandwidth,
      height,
      kind: mime.startsWith('audio/') ? 'audio' : 'video',
      label: height ? `${height}p` : mime.startsWith('audio/') ? 'Audio' : 'Video',
    });
  }
  return variants;
};

export const resolveStreamUrl = (baseUrl: string, value: string): string => {
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export const ipv4ToInt = (value: string): number | null => {
  const match = IPV4.exec(value.trim());
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some(part => part > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
};

export const intToIpv4 = (value: number): string =>
  [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.');

export interface IpRange {
  start: string;
  end: string;
}

/** Parses single addresses, CIDR, start-end, and `name:start-end` blocklist lines. */
export const parseBlocklist = (text: string): IpRange[] => {
  const ranges: IpRange[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const payload = line.includes(':') ? line.slice(line.lastIndexOf(':') + 1).trim() : line;
    const range = parseIpToken(payload);
    if (range) ranges.push(range);
  }
  return ranges;
};

const parseIpToken = (token: string): IpRange | null => {
  const cidr = /^(.+)\/(\d{1,2})$/.exec(token);
  if (cidr) {
    const base = ipv4ToInt(cidr[1]);
    const bits = Number(cidr[2]);
    if (base == null || bits > 32) return null;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    const start = base & mask;
    const end = (start | (~mask >>> 0)) >>> 0;
    return {start: intToIpv4(start), end: intToIpv4(end)};
  }
  const span = /^(.+)-(.+)$/.exec(token);
  if (span && ipv4ToInt(span[1]) != null && ipv4ToInt(span[2]) != null) {
    return {start: span[1].trim(), end: span[2].trim()};
  }
  if (ipv4ToInt(token) != null) return {start: token, end: token};
  return null;
};
