/**
 * Live HLS recording logic: reads media playlists, decides which segments are
 * new (by media sequence), and writes the local playlist the finalizer remuxes.
 * Pure: no React Native imports, so it runs in unit tests.
 */

export class LiveDrmError extends Error {
  constructor() {
    super("This channel is protected and can't be recorded.");
    this.name = 'LiveDrmError';
  }
}

export interface LiveKey {
  method: 'AES-128';
  uri: string;
  /** 32 hex digits, without 0x. */
  iv: string;
}

export interface LiveSegment {
  sequence: number;
  url: string;
  duration: number;
  discontinuity: boolean;
  key?: LiveKey;
  /** fMP4 initialization section. */
  map?: {url: string; range?: string};
  /** Inclusive byte range "start-end". */
  range?: string;
}

export interface MediaPlaylist {
  targetDuration: number;
  mediaSequence: number;
  discontinuitySequence: number;
  endList: boolean;
  segments: LiveSegment[];
}

const attribute = (line: string, name: string): string | undefined => {
  const match = new RegExp(`[:,]${name}=("([^"]*)"|[^,]*)`).exec(line);
  return match ? (match[2] ?? match[1]) : undefined;
};

const resolve = (base: string, value: string): string => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
};

/** The IV HLS uses when a key gives none: the media sequence, 128-bit big-endian. */
export const sequenceIv = (sequence: number): string => {
  let hex = Math.max(0, Math.floor(sequence)).toString(16);
  if (hex.length > 32) hex = hex.slice(-32);
  return hex.padStart(32, '0');
};

const normalizeIv = (value: string): string => {
  const hex = value.replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{1,32}$/.test(hex)) throw new Error('This stream has an invalid encryption IV.');
  return hex.padStart(32, '0');
};

/**
 * Methods and key formats that are DRM. AES-128 with the plain key format is
 * ordinary encryption and is recorded; everything else is refused.
 */
export const isDrmKeyLine = (line: string): boolean => {
  const method = (attribute(line, 'METHOD') || 'NONE').toUpperCase();
  if (method === 'NONE') return false;
  const format = (attribute(line, 'KEYFORMAT') || 'identity').toLowerCase();
  return method !== 'AES-128' || format !== 'identity';
};

export const isMasterPlaylist = (text: string): boolean => /#EXT-X-STREAM-INF/i.test(text);

export interface LiveVariant {
  video: string;
  audio?: string;
}

/** Best variant of a master playlist, with its separate audio rendition when it has one. */
export const pickLiveVariant = (text: string, baseUrl: string): LiveVariant => {
  const lines = text.split(/\r?\n/).map(line => line.trim());
  if (lines.some(line => line.startsWith('#EXT-X-SESSION-KEY') && isDrmKeyLine(line))) throw new LiveDrmError();
  let best: {url: string; bandwidth: number; audio?: string} | undefined;
  lines.forEach((line, index) => {
    if (!line.startsWith('#EXT-X-STREAM-INF')) return;
    const url = lines.slice(index + 1).find(next => next && !next.startsWith('#'));
    if (!url) return;
    const bandwidth = Number(attribute(line, 'BANDWIDTH')) || 0;
    if (!best || bandwidth > best.bandwidth) best = {url: resolve(baseUrl, url), bandwidth, audio: attribute(line, 'AUDIO')};
  });
  if (!best) throw new Error('No stream found in this playlist.');
  const group = best.audio;
  const renditions = group
    ? lines.filter(line => line.startsWith('#EXT-X-MEDIA:') && attribute(line, 'TYPE') === 'AUDIO' && attribute(line, 'GROUP-ID') === group)
    : [];
  const rendition = renditions.find(line => attribute(line, 'DEFAULT') === 'YES') ||
    renditions.find(line => attribute(line, 'AUTOSELECT') === 'YES') || renditions[0];
  const audioUri = rendition ? attribute(rendition, 'URI') : undefined;
  return {video: best.url, audio: audioUri ? resolve(baseUrl, audioUri) : undefined};
};

/** Reads a media playlist. Throws LiveDrmError for DRM keys. */
export const parseMediaPlaylist = (text: string, baseUrl: string): MediaPlaylist => {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || !lines[0].startsWith('#EXTM3U')) throw new Error('This is not an HLS playlist.');
  let targetDuration = 0;
  let mediaSequence = 0;
  let discontinuitySequence = 0;
  let endList = false;
  let key: {uri: string; iv?: string} | undefined;
  let map: LiveSegment['map'];
  let duration = 0;
  let discontinuity = false;
  let range: {length: number; offset?: number} | undefined;
  const rangeEnds = new Map<string, number>();
  const segments: LiveSegment[] = [];
  for (const line of lines) {
    if (line.startsWith('#EXT-X-TARGETDURATION:')) targetDuration = Number(line.split(':')[1]) || 0;
    else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) mediaSequence = Number(line.split(':')[1]) || 0;
    else if (line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:')) discontinuitySequence = Number(line.split(':')[1]) || 0;
    else if (line.startsWith('#EXT-X-ENDLIST')) endList = true;
    else if (line === '#EXT-X-DISCONTINUITY') discontinuity = true;
    else if (line.startsWith('#EXT-X-KEY:')) {
      if (isDrmKeyLine(line)) throw new LiveDrmError();
      const method = (attribute(line, 'METHOD') || 'NONE').toUpperCase();
      const uri = attribute(line, 'URI');
      if (method === 'NONE') key = undefined;
      else if (!uri) throw new Error('This stream has an encryption key without an address.');
      else {
        const iv = attribute(line, 'IV');
        key = {uri: resolve(baseUrl, uri), iv: iv ? normalizeIv(iv) : undefined};
      }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const uri = attribute(line, 'URI');
      const byteRange = attribute(line, 'BYTERANGE');
      if (uri) {
        const match = byteRange ? /^(\d+)@(\d+)$/.exec(byteRange) : null;
        map = {url: resolve(baseUrl, uri), range: match ? `${match[2]}-${Number(match[2]) + Number(match[1]) - 1}` : undefined};
      }
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      const match = /^(\d+)(?:@(\d+))?$/.exec(line.split(':')[1] || '');
      if (match) range = {length: Number(match[1]), offset: match[2] !== undefined ? Number(match[2]) : undefined};
    } else if (line.startsWith('#EXTINF:')) {
      duration = parseFloat(line.slice(8)) || 0;
    } else if (!line.startsWith('#')) {
      const sequence = mediaSequence + segments.length;
      const url = resolve(baseUrl, line);
      let segmentRange: string | undefined;
      if (range) {
        const start = range.offset ?? rangeEnds.get(url) ?? 0;
        segmentRange = `${start}-${start + range.length - 1}`;
        rangeEnds.set(url, start + range.length);
      }
      segments.push({
        sequence,
        url,
        duration,
        discontinuity,
        key: key ? {method: 'AES-128', uri: key.uri, iv: key.iv || sequenceIv(sequence)} : undefined,
        map,
        range: segmentRange,
      });
      duration = 0;
      discontinuity = false;
      range = undefined;
    }
  }
  return {targetDuration, mediaSequence, discontinuitySequence, endList, segments};
};

export interface LiveCursor {
  /** Media sequence of the last segment taken, or null before the first playlist. */
  lastSequence: number | null;
  discontinuitySequence: number;
}

export const newLiveCursor = (): LiveCursor => ({lastSequence: null, discontinuitySequence: 0});

export interface LiveStep {
  segments: LiveSegment[];
  cursor: LiveCursor;
  /** Segments left the playlist before they were fetched (a gap in the recording). */
  gap: boolean;
  /** The stream restarted its numbering. */
  restarted: boolean;
}

/** Segments at the live edge a new recording starts with (about what a player shows). */
export const LIVE_EDGE_SEGMENTS = 3;

/**
 * The segments of a fresh playlist not yet taken, in order, each once. A
 * missing stretch or a restarted numbering starts with a discontinuity so the
 * remux does not join unrelated timestamps.
 */
export const nextLiveSegments = (cursor: LiveCursor, playlist: MediaPlaylist, edge = LIVE_EDGE_SEGMENTS): LiveStep => {
  const all = playlist.segments;
  const last = all[all.length - 1];
  const nextCursor = (taken: LiveSegment[]): LiveCursor => ({
    lastSequence: taken.length ? taken[taken.length - 1].sequence : cursor.lastSequence,
    discontinuitySequence: playlist.discontinuitySequence,
  });
  if (!last) return {segments: [], cursor: {...cursor, discontinuitySequence: playlist.discontinuitySequence}, gap: false, restarted: false};
  if (cursor.lastSequence === null) {
    // A playlist that has ended (or a VOD) is taken whole; a live one from its edge.
    const taken = playlist.endList ? all : all.slice(-Math.max(1, edge));
    return {segments: taken, cursor: nextCursor(taken), gap: false, restarted: false};
  }
  // Numbering went back past what was taken while the discontinuity count moved
  // (or the whole window is older): the encoder restarted.
  const restarted = last.sequence < cursor.lastSequence &&
    (playlist.discontinuitySequence !== cursor.discontinuitySequence || cursor.lastSequence - last.sequence > all.length);
  if (restarted) {
    const taken = all.slice(-Math.max(1, edge)).map((segment, index) => (index === 0 ? {...segment, discontinuity: true} : segment));
    return {segments: taken, cursor: nextCursor(taken), gap: false, restarted: true};
  }
  const fresh = all.filter(segment => segment.sequence > cursor.lastSequence!);
  const gap = fresh.length > 0 && fresh[0].sequence > cursor.lastSequence + 1;
  const taken = gap ? fresh.map((segment, index) => (index === 0 ? {...segment, discontinuity: true} : segment)) : fresh;
  return {segments: taken, cursor: nextCursor(taken), gap, restarted: false};
};

/**
 * How long to wait before reloading the playlist: the target duration after
 * a change, half of it when nothing was new (as the HLS spec asks).
 */
export const livePollDelayMs = (playlist: MediaPlaylist | undefined, changed: boolean): number => {
  const target = playlist && playlist.targetDuration > 0 ? playlist.targetDuration : 6;
  const seconds = changed ? target : target / 2;
  return Math.round(Math.min(10, Math.max(1, seconds)) * 1000);
};

export interface RecordingLimits {
  /** Wall-clock end, ms since epoch. */
  stopAt?: number;
  /** Longest recording, ms. */
  maxDurationMs?: number;
}

/** Why a recording should stop now, if it should. */
export const recordingStopReason = (
  limits: RecordingLimits,
  now: number,
  recordedSeconds: number,
): 'end-time' | 'duration' | undefined => {
  if (limits.stopAt && now >= limits.stopAt) return 'end-time';
  if (limits.maxDurationMs && recordedSeconds * 1000 >= limits.maxDurationMs) return 'duration';
  return undefined;
};

export interface LocalEntry {
  file: string;
  duration: number;
  discontinuity: boolean;
  keyFile?: string;
  iv?: string;
  mapFile?: string;
}

/** The local VOD playlist the finalizer reads. Keys point at saved key files. */
export const buildLocalPlaylist = (entries: LocalEntry[]): string => {
  const target = Math.max(1, Math.ceil(entries.reduce((max, entry) => Math.max(max, entry.duration), 0)));
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-PLAYLIST-TYPE:VOD', `#EXT-X-TARGETDURATION:${target}`, '#EXT-X-MEDIA-SEQUENCE:0'];
  let key = '';
  let map: string | undefined;
  for (const entry of entries) {
    if (entry.discontinuity) lines.push('#EXT-X-DISCONTINUITY');
    const nextKey = entry.keyFile ? `${entry.keyFile}|${entry.iv}` : '';
    if (nextKey !== key) {
      lines.push(entry.keyFile ? `#EXT-X-KEY:METHOD=AES-128,URI="${entry.keyFile}",IV=0x${entry.iv}` : '#EXT-X-KEY:METHOD=NONE');
      key = nextKey;
    }
    if (entry.mapFile && entry.mapFile !== map) {
      lines.push(`#EXT-X-MAP:URI="${entry.mapFile}"`);
      map = entry.mapFile;
    }
    lines.push(`#EXTINF:${entry.duration.toFixed(3)},`, entry.file);
  }
  lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
};
