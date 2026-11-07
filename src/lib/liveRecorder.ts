/**
 * Records a live HLS stream while it airs: reloads the media playlist, fetches
 * each new segment once and in order (by media sequence), saves AES-128 keys
 * next to the segments, and on stop remuxes everything into one MP4 or TS.
 * A journal in the work folder lets a recording continue after the app was
 * closed, with a discontinuity where it stopped.
 */
import * as RNFS from '@dr.pogodin/react-native-fs';
import {
  LiveDrmError,
  buildLocalPlaylist,
  isMasterPlaylist,
  livePollDelayMs,
  newLiveCursor,
  nextLiveSegments,
  parseMediaPlaylist,
  pickLiveVariant,
  recordingStopReason,
  type LiveCursor,
  type LiveSegment,
  type LocalEntry,
  type MediaPlaylist,
  type RecordingLimits,
} from './downloadEngine/livePlaylist';
import {httpNative, requireMediaTools} from './downloadEngine/native';
import {
  SegmentHttpError,
  createWaker,
  ensureDirectory,
  fetchSegmentWithRetry,
  moveIntoPlace,
  readJson,
  withUserAgent,
  writeJson,
} from './downloadEngine/segmentFetch';

export {LiveDrmError};

export interface LiveSource {
  url: string;
  headers?: Record<string, string>;
}

interface TrackState {
  name: 'video' | 'audio';
  url: string;
  cursor: LiveCursor;
  entries: LocalEntry[];
  /** Key address to saved file name. */
  keys: Record<string, string>;
  /** Init section (address and range) to saved file name. */
  maps: Record<string, string>;
  counter: number;
  /** The next saved segment follows a gap. */
  gapNext: boolean;
  ended: boolean;
  playlist?: MediaPlaylist;
}

interface Journal {
  version: 1;
  source: string;
  tracks: Pick<TrackState, 'name' | 'entries' | 'keys' | 'maps' | 'counter'>[];
  bytes: number;
}

const stopRequested = new Set<string>();
const cancelled = new Set<string>();
const active = new Set<string>();
const completion = new Map<string, Promise<void>>();
const requests = new Map<string, AbortController>();
const waker = createWaker();

const MAX_PLAYLIST_FAILURES = 30;
const PLAYLIST_TIMEOUT_MS = 15_000;

const checkCancelled = (id: string) => {
  if (cancelled.has(id)) throw new Error('Recording cancelled');
};

const segmentExtension = (segment: LiveSegment): string => {
  const extension = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(segment.url)?.[1]?.toLowerCase();
  if (segment.map) return extension === 'm4a' ? 'm4a' : 'mp4';
  return extension && ['aac', 'mp3', 'ac3', 'ec3'].includes(extension) ? extension : 'ts';
};

const loadText = async (id: string, url: string, headers: Record<string, string>): Promise<{text: string; url: string}> => {
  const controller = new AbortController();
  requests.set(id, controller);
  const timer = setTimeout(() => controller.abort(), PLAYLIST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {headers: withUserAgent(headers), signal: controller.signal});
    if (!response.ok) throw new SegmentHttpError(response.status);
    return {text: await response.text(), url: response.url || url};
  } finally {
    clearTimeout(timer);
    if (requests.get(id) === controller) requests.delete(id);
  }
};

/** Media playlist addresses for a channel address, refusing DRM. */
const resolveTracks = async (id: string, source: LiveSource): Promise<{video: string; audio?: string}> => {
  if (/\.mpd(\?|$)/i.test(source.url)) throw new Error('Only HLS channels can be recorded.');
  const {text, url} = await loadText(id, source.url, source.headers || {});
  if (!isMasterPlaylist(text)) {
    parseMediaPlaylist(text, url);
    return {video: url};
  }
  return pickLiveVariant(text, url);
};

export const recordLive = async ({
  downloadId,
  source,
  refreshSource,
  tempDirectory,
  outputPath,
  format,
  limits,
  onProgress,
  onFinalizing,
}: {
  downloadId: string;
  source: LiveSource;
  /** A fresh address for channels whose links expire. */
  refreshSource?: () => Promise<LiveSource>;
  tempDirectory: string;
  outputPath: string;
  format: 'mp4' | 'mpegts';
  limits: RecordingLimits;
  onProgress?: (bytes: number, seconds: number) => void;
  onFinalizing?: () => void;
}): Promise<void> => {
  if (active.has(downloadId)) throw new Error('This recording is already running');
  active.add(downloadId);
  stopRequested.delete(downloadId);
  cancelled.delete(downloadId);
  let done!: () => void;
  completion.set(downloadId, new Promise<void>(resolve => { done = resolve; }));
  const tools = requireMediaTools();
  let current = source;
  try {
    await ensureDirectory(tempDirectory);
    const journalPath = `${tempDirectory}/journal.json`;
    const urls = await resolveTracks(downloadId, current);
    checkCancelled(downloadId);
    const saved = await readJson<Journal>(journalPath);
    const resumed = saved?.version === 1 ? saved : undefined;
    const makeTrack = (name: TrackState['name'], url: string): TrackState => {
      const old = resumed?.tracks.find(track => track.name === name);
      return {
        name,
        url,
        cursor: newLiveCursor(),
        entries: old?.entries || [],
        keys: old?.keys || {},
        maps: old?.maps || {},
        counter: old?.counter || 0,
        // A recording that continues after a stop has a gap where it stopped.
        gapNext: Boolean(old?.entries.length),
        ended: false,
      };
    };
    const tracks = [makeTrack('video', urls.video), ...(urls.audio ? [makeTrack('audio', urls.audio)] : [])];
    let bytes = resumed?.bytes || 0;
    const seconds = () => tracks[0].entries.reduce((sum, entry) => sum + entry.duration, 0);
    const saveJournal = () =>
      writeJson(journalPath, {
        version: 1,
        source: current.url,
        bytes,
        tracks: tracks.map(({name, entries, keys, maps, counter}) => ({name, entries, keys, maps, counter})),
      } satisfies Journal);
    onProgress?.(bytes, seconds());

    const fetchOnce = (url: string, path: string, headers: Record<string, string>, range?: string) =>
      fetchSegmentWithRetry({
        tag: downloadId,
        url,
        path,
        headers,
        range,
        attempts: 3,
        checkRunning: () => checkCancelled(downloadId),
        sleep: ms => waker.sleep(downloadId, ms),
      });

    const saveSegment = async (track: TrackState, segment: LiveSegment, headers: Record<string, string>) => {
      let keyFile: string | undefined;
      if (segment.key) {
        keyFile = track.keys[segment.key.uri];
        if (!keyFile) {
          keyFile = `${track.name}_key_${Object.keys(track.keys).length}.key`;
          const size = await fetchOnce(segment.key.uri, `${tempDirectory}/${keyFile}`, headers);
          if (size !== 16) throw new Error('The stream gave an encryption key that is not 16 bytes.');
          track.keys[segment.key.uri] = keyFile;
        }
      }
      let mapFile: string | undefined;
      if (segment.map) {
        const mapKey = `${segment.map.url}#${segment.map.range || ''}`;
        mapFile = track.maps[mapKey];
        if (!mapFile) {
          mapFile = `${track.name}_init_${Object.keys(track.maps).length}.mp4`;
          bytes += await fetchOnce(segment.map.url, `${tempDirectory}/${mapFile}`, headers, segment.map.range);
          track.maps[mapKey] = mapFile;
        }
      }
      const file = `${track.name}_${track.counter}.${segmentExtension(segment)}`;
      bytes += await fetchOnce(segment.url, `${tempDirectory}/${file}`, headers, segment.range);
      track.counter++;
      track.entries.push({
        file,
        duration: segment.duration,
        discontinuity: segment.discontinuity || track.gapNext,
        keyFile,
        iv: segment.key?.iv,
        mapFile,
      });
      track.gapNext = false;
    };

    let failures = 0;
    let refreshed = false;
    let stopReason: string | undefined;
    while (!stopRequested.has(downloadId)) {
      checkCancelled(downloadId);
      stopReason = recordingStopReason(limits, Date.now(), seconds());
      if (stopReason) break;
      let changed = false;
      try {
        for (const track of tracks) {
          if (track.ended) continue;
          const {text, url} = await loadText(downloadId, track.url, current.headers || {});
          const playlist = parseMediaPlaylist(text, url);
          track.playlist = playlist;
          const step = nextLiveSegments(track.cursor, playlist);
          track.cursor = step.cursor;
          if (step.gap || step.restarted) track.gapNext = true;
          for (const segment of step.segments) {
            if (stopRequested.has(downloadId)) break;
            checkCancelled(downloadId);
            try {
              await saveSegment(track, segment, current.headers || {});
              changed = true;
            } catch (error) {
              checkCancelled(downloadId);
              // A segment that is gone leaves a gap; the recording carries on.
              if (error instanceof SegmentHttpError && (error.status === 404 || error.status === 410)) {
                track.gapNext = true;
                continue;
              }
              throw error;
            }
          }
          if (playlist.endList) track.ended = true;
        }
        failures = 0;
        refreshed = false;
      } catch (error) {
        checkCancelled(downloadId);
        if (error instanceof LiveDrmError) {
          // The stream turned to DRM: keep what was recorded before it.
          if (tracks[0].entries.length) break;
          throw error;
        }
        failures++;
        const status = error instanceof SegmentHttpError ? error.status : 0;
        // Expired channel links (JioTV) get a fresh address once per failure streak.
        if (refreshSource && !refreshed && (status === 401 || status === 403 || status === 410)) {
          refreshed = true;
          try {
            current = await refreshSource();
            const fresh = await resolveTracks(downloadId, current);
            tracks[0].url = fresh.video;
            if (tracks[1] && fresh.audio) tracks[1].url = fresh.audio;
            tracks.forEach(track => { track.cursor = newLiveCursor(); track.gapNext = true; });
            continue;
          } catch (refreshError) {
            if (refreshError instanceof LiveDrmError) throw refreshError;
          }
        }
        if (failures >= MAX_PLAYLIST_FAILURES) {
          if (tracks[0].entries.length) break;
          throw error;
        }
      }
      if (changed) {
        await saveJournal();
        onProgress?.(bytes, seconds());
      }
      if (tracks.every(track => track.ended)) break;
      const delay = livePollDelayMs(tracks[0].playlist, changed);
      await waker.sleep(downloadId, failures ? Math.min(delay * 2 ** Math.min(failures, 3), 15_000) : delay);
    }
    checkCancelled(downloadId);
    await saveJournal();

    if (!tracks[0].entries.length) throw new Error('Nothing was recorded. The channel may be offline.');
    onFinalizing?.();
    const playlists = await Promise.all(
      tracks.map(async track => {
        const path = `${tempDirectory}/${track.name}.m3u8`;
        await RNFS.writeFile(path, buildLocalPlaylist(track.entries), 'utf8');
        return track.entries.length ? path : null;
      }),
    );
    const output = `${tempDirectory}/recording.media`;
    try {
      await tools.finalizeHlsAs(playlists[0]!, playlists[1] || null, output, format);
    } catch (error) {
      if (!playlists[1]) throw error;
      // Keep the picture rather than lose the whole recording.
      await tools.finalizeHlsAs(playlists[0]!, null, output, format);
    }
    checkCancelled(downloadId);
    await moveIntoPlace(output, outputPath);
    await RNFS.unlink(tempDirectory).catch(() => undefined);
  } catch (error) {
    if (cancelled.has(downloadId)) {
      await RNFS.unlink(tempDirectory).catch(() => undefined);
      await RNFS.unlink(outputPath).catch(() => undefined);
    }
    throw error;
  } finally {
    httpNative?.cancelFetches?.(downloadId);
    active.delete(downloadId);
    stopRequested.delete(downloadId);
    cancelled.delete(downloadId);
    requests.delete(downloadId);
    waker.clear(downloadId);
    completion.delete(downloadId);
    done();
  }
};

/** Stops recording and saves what was recorded. */
export const stopLiveRecording = (downloadId: string): boolean => {
  if (!active.has(downloadId)) return false;
  stopRequested.add(downloadId);
  requests.get(downloadId)?.abort();
  waker.wake(downloadId);
  return true;
};

/** Stops recording and throws the recording away. */
export const cancelLiveRecording = async (downloadId: string): Promise<void> => {
  if (!active.has(downloadId)) return;
  cancelled.add(downloadId);
  requests.get(downloadId)?.abort();
  waker.wake(downloadId);
  httpNative?.cancelFetches?.(downloadId);
  await completion.get(downloadId);
};

export const isLiveRecordingActive = (downloadId: string): boolean => active.has(downloadId);
