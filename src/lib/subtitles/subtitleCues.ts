/**
 * The timed lines of a subtitle track the player shows, for sync tools, the
 * second subtitle and translation. External tracks are read from their file
 * or address; embedded text tracks of a Matroska file through its index.
 */
import * as FileSystem from 'expo-file-system/legacy';
import {isProbeableSource, playerTools} from '../player/playerTools';
import {cleanCueText, parseSubtitles, type SubtitleCue} from './cueParser';

export interface PlayerTextTrack {
  index: number;
  title?: string;
  language?: string;
  type?: string;
}

export interface ExternalSubtitle {
  uri: string;
  title?: string;
  language?: string;
  type?: string;
}

export type SubtitleRef =
  | {kind: 'external'; key: string; uri: string; type?: string}
  | {kind: 'embedded'; key: string; ordinal: number};

/**
 * Where a track of the player's list comes from. Media3 lists the file's own
 * tracks first and the added (external) ones after them, in the order given.
 */
export const subtitleRefFor = (
  track: PlayerTextTrack | undefined,
  tracks: PlayerTextTrack[],
  externals: ExternalSubtitle[],
): SubtitleRef | undefined => {
  if (!track) return undefined;
  const position = tracks.findIndex(item => item.index === track.index);
  if (position < 0) return undefined;
  const embeddedCount = Math.max(0, tracks.length - externals.length);
  // A title only identifies an added track when no other track has it.
  const uniqueTitle = Boolean(track.title) && tracks.filter(item => item.title === track.title).length === 1;
  const byTitle = uniqueTitle ? externals.find(sub => sub.title === track.title) : undefined;
  const byPosition = position >= embeddedCount ? externals[position - embeddedCount] : undefined;
  const external = byTitle || byPosition;
  if (external?.uri) return {kind: 'external', key: `ext:${external.uri}`, uri: external.uri, type: external.type};
  if (position >= embeddedCount) return undefined;
  return {kind: 'embedded', key: `emb:${position}`, ordinal: position};
};

const cache = new Map<string, Promise<SubtitleCue[]>>();

const readText = async (uri: string, headers: Record<string, string>): Promise<string> => {
  if (/^(file:|content:|\/)/i.test(uri)) {
    return FileSystem.readAsStringAsync(uri.startsWith('/') ? `file://${uri}` : uri);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    let response = await fetch(uri, {headers, signal: controller.signal});
    // Some subtitle hosts refuse the video's headers; try once without them.
    if (!response.ok && Object.keys(headers).length) response = await fetch(uri, {signal: controller.signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The cues of [ref], sorted, kept for this app run. A track that cannot be
 * read rejects with a short reason.
 */
export const loadSubtitleCues = (
  ref: SubtitleRef,
  videoUri: string,
  headers: Record<string, string> = {},
  videoType?: string,
): Promise<SubtitleCue[]> => {
  const key = ref.kind === 'external' ? ref.key : `${videoUri.split('#')[0]}|${ref.key}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      if (ref.kind === 'external') {
        const cues = parseSubtitles(await readText(ref.uri, headers), `${ref.type || ''} ${ref.uri}`);
        if (!cues.length) throw new Error('No lines found in this subtitle');
        return cues;
      }
      if (!playerTools || !isProbeableSource(videoUri, videoType)) {
        throw new Error('The lines of this subtitle track cannot be read here');
      }
      const lines = await playerTools.readEmbeddedSubtitle(videoUri, headers, ref.ordinal).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        if (/only text subtitles/i.test(message)) throw new Error('Picture subtitles (PGS, VobSub) have no text lines to read');
        if (/not indexed/i.test(message)) throw new Error('This subtitle track cannot be read without downloading the whole video');
        throw new Error('Could not read this subtitle track');
      });
      const cues = lines
        .map(line => ({start: line.start / 1000, end: line.end / 1000, text: cleanCueText(line.text)}))
        .filter(cue => cue.text && cue.end > cue.start)
        .sort((a, b) => a.start - b.start);
      if (!cues.length) throw new Error('No lines found in this subtitle');
      return cues;
    })();
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
    if (cache.size > 8) cache.delete(cache.keys().next().value as string);
  }
  return pending;
};
