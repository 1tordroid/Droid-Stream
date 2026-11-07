/**
 * Downloads a static MPEG-DASH stream: the chosen video and audio
 * representations, segment by segment, then joins each track and muxes them
 * into one file with FFmpeg (no re-encoding). Finished segments are kept on
 * pause or failure, so the next start continues.
 */
import * as RNFS from '@dr.pogodin/react-native-fs';
import {DownloadPausedError} from './downloadBackends/types';
import {estimateDashBytes, parseMpd, selectDash, type DashManifest, type DashRepresentation} from './downloadEngine/mpd';
import {httpNative, requireMediaTools} from './downloadEngine/native';
import {
  createWaker,
  ensureDirectory,
  fetchSegmentWithRetry,
  fileSize,
  moveIntoPlace,
  readJson,
  resetDirectory,
  withUserAgent,
  writeJson,
} from './downloadEngine/segmentFetch';

const CHUNK_BYTES = 8 * 1024 * 1024;

const cancelled = new Set<string>();
const paused = new Set<string>();
const active = new Set<string>();
const finishing = new Set<string>();
const completion = new Map<string, Promise<void>>();
const manifestRequests = new Map<string, AbortController>();
const waker = createWaker();

const checkRunning = (id: string) => {
  if (cancelled.has(id)) throw new Error('Download cancelled');
  if (paused.has(id)) throw new DownloadPausedError();
};

const stopTransfers = (id: string) => {
  manifestRequests.get(id)?.abort();
  waker.wake(id);
  httpNative?.cancelFetches?.(id);
};

interface Part {
  url: string;
  range?: string;
  path: string;
}

interface Track {
  name: 'video' | 'audio';
  representation: DashRepresentation;
  parts: Part[];
}

/** Loads and reads the manifest. Throws for DRM, live or broken manifests. */
export const loadDashManifest = async (
  url: string,
  headers: Record<string, string> | undefined,
  signal?: AbortSignal,
): Promise<DashManifest> => {
  const response = await fetch(url, {headers: withUserAgent(headers), signal});
  if (!response.ok) throw new Error(`The DASH manifest failed with HTTP status ${response.status}`);
  return parseMpd(await response.text(), response.url || url);
};

/** Splits one big file into byte ranges so several connections can share it. */
const singleFileParts = async (url: string, headers: Record<string, string>, prefix: string): Promise<Part[]> => {
  const probed = await httpNative?.probe(url, headers).catch(() => undefined);
  const size = Number(probed?.size || 0);
  if (!probed?.acceptRanges || size <= CHUNK_BYTES) return [{url, path: `${prefix}_0.seg`}];
  const parts: Part[] = [];
  for (let start = 0, index = 0; start < size; start += CHUNK_BYTES, index++) {
    parts.push({url, range: `${start}-${Math.min(size, start + CHUNK_BYTES) - 1}`, path: `${prefix}_${index}.seg`});
  }
  return parts;
};

const trackParts = async (name: Track['name'], representation: DashRepresentation, headers: Record<string, string>, dir: string): Promise<Part[]> => {
  const prefix = `${dir}/${name}`;
  if (representation.singleFile) return singleFileParts(representation.segments[0].url, headers, prefix);
  const parts: Part[] = [];
  if (representation.init) parts.push({url: representation.init.url, range: representation.init.range, path: `${prefix}_init.seg`});
  representation.segments.forEach((segment, index) => parts.push({url: segment.url, range: segment.range, path: `${prefix}_${index}.seg`}));
  return parts;
};

export const dashDownloader = async ({
  downloadId,
  manifestUrl,
  headers = {},
  wanted,
  tempDirectory,
  outputPath,
  connections = 4,
  onProgress,
  onFinalizing,
}: {
  downloadId: string;
  manifestUrl: string;
  headers?: Record<string, string>;
  wanted?: {video?: string; audio?: string};
  tempDirectory: string;
  outputPath: string;
  connections?: number;
  onProgress?: (downloadedBytes: number, totalBytes: number) => void;
  onFinalizing?: () => void;
}): Promise<void> => {
  if (active.has(downloadId)) throw new Error('This download is already running');
  cancelled.delete(downloadId);
  paused.delete(downloadId);
  active.add(downloadId);
  let done!: () => void;
  completion.set(downloadId, new Promise<void>(resolve => { done = resolve; }));
  const tools = requireMediaTools();
  try {
    await ensureDirectory(tempDirectory);
    const controller = new AbortController();
    manifestRequests.set(downloadId, controller);
    const manifest = await loadDashManifest(manifestUrl, headers, controller.signal);
    manifestRequests.delete(downloadId);
    checkRunning(downloadId);
    const selection = selectDash(manifest, wanted);
    const tracks: Track[] = [];
    if (selection.video) tracks.push({name: 'video', representation: selection.video, parts: []});
    if (selection.audio) tracks.push({name: 'audio', representation: selection.audio, parts: []});
    for (const track of tracks) track.parts = await trackParts(track.name, track.representation, headers, tempDirectory);
    checkRunning(downloadId);

    // Keep finished parts only for the same manifest and choice of tracks.
    const identity = JSON.stringify({
      url: manifestUrl,
      tracks: tracks.map(track => [track.name, track.representation.id, track.parts.map(part => `${part.url}#${part.range || ''}`)]),
    });
    const checkpointPath = `${tempDirectory}/resume.json`;
    const saved = await readJson<{identity: string}>(checkpointPath);
    if (saved?.identity !== identity) {
      await resetDirectory(tempDirectory);
      await writeJson(checkpointPath, {identity});
    }

    const parts = tracks.flatMap(track => track.parts);
    const estimate = Math.max(estimateDashBytes(manifest, selection), 1);
    let downloaded = 0;
    const pending: Part[] = [];
    for (const part of parts) {
      const size = await fileSize(part.path);
      if (size > 0) downloaded += size;
      else pending.push(part);
    }
    const report = () => onProgress?.(downloaded, pending.length ? Math.max(estimate, downloaded + 1) : downloaded);
    report();

    let next = 0;
    let workers = Math.max(1, Math.min(connections, 8, pending.length || 1));
    let failed: unknown;
    const worker = async (index: number) => {
      while (index < workers && failed === undefined) {
        checkRunning(downloadId);
        const part = pending[next++];
        if (!part) return;
        try {
          downloaded += await fetchSegmentWithRetry({
            tag: downloadId,
            url: part.url,
            path: part.path,
            headers,
            range: part.range,
            checkRunning: () => {
              checkRunning(downloadId);
              if (failed !== undefined) throw failed;
            },
            sleep: ms => waker.sleep(downloadId, ms),
            onRateLimit: () => {
              if (workers > 1) workers--;
            },
          });
          report();
        } catch (error) {
          if (failed === undefined) failed = error;
          stopTransfers(downloadId);
          throw error;
        }
      }
    };
    const results = await Promise.allSettled(Array.from({length: workers}, (_, index) => worker(index)));
    checkRunning(downloadId);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed !== undefined || rejected) throw failed ?? rejected!.reason;

    onProgress?.(downloaded, downloaded);
    finishing.add(downloadId);
    onFinalizing?.();
    const trackFiles: Partial<Record<Track['name'], string>> = {};
    for (const track of tracks) {
      const target = `${tempDirectory}/${track.name}.track`;
      await tools.concatFiles(track.parts.map(part => part.path), target, true);
      trackFiles[track.name] = target;
    }
    checkRunning(downloadId);
    const muxed = `${tempDirectory}/output.media`;
    const webm = tracks.some(track => /webm/i.test(track.representation.mimeType));
    try {
      await tools.muxTracks(trackFiles.video || null, trackFiles.audio || null, muxed, 'mp4');
    } catch (error) {
      // Vorbis and some WebM audio cannot go into MP4; Matroska takes them, and players read it by content.
      if (!webm) throw error;
      await tools.muxTracks(trackFiles.video || null, trackFiles.audio || null, muxed, 'matroska');
    }
    checkRunning(downloadId);
    await moveIntoPlace(muxed, outputPath);
    await RNFS.unlink(tempDirectory).catch(() => undefined);
  } catch (error) {
    if (cancelled.has(downloadId)) {
      await RNFS.unlink(tempDirectory).catch(() => undefined);
      await RNFS.unlink(outputPath).catch(() => undefined);
    }
    checkRunning(downloadId);
    throw error;
  } finally {
    httpNative?.cancelFetches?.(downloadId);
    active.delete(downloadId);
    cancelled.delete(downloadId);
    paused.delete(downloadId);
    finishing.delete(downloadId);
    manifestRequests.delete(downloadId);
    waker.clear(downloadId);
    completion.delete(downloadId);
    done();
  }
};

export const pauseDashDownload = async (downloadId: string): Promise<void> => {
  if (!active.has(downloadId) || finishing.has(downloadId)) throw new Error('This download cannot be paused now');
  paused.add(downloadId);
  stopTransfers(downloadId);
  await completion.get(downloadId);
};

export const cancelDashDownload = async (downloadId: string): Promise<void> => {
  if (!active.has(downloadId)) return;
  cancelled.add(downloadId);
  stopTransfers(downloadId);
  await completion.get(downloadId);
};
