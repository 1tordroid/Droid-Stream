/**
 * Runs one Watch online route for a torrent result and opens the player.
 */
import {checkAllCaches, connectedServices, getService, pickVideo, sendToDebrid, VIDEO_FILE, type DebridId, type DebridTransfer} from '../debrid';
import {looseCloudItem, PIKPAK_SOURCE_ID} from '../netlib/cloud';
import {versionKey} from '../netlib/ids';
import {playNetlibVersion} from '../netlib/playback';
import {isPikPakSignedIn} from '../pikpak/drive';
import {playDebridFile, streamOnDevice} from '../torrentSearch/actions';
import {resolveResult} from '../torrentSearch/search';
import type {TorrentResult} from '../torrentSearch/types';
import {planWatchRoutes, type WatchRoute, type WatchRoutePlan} from './routes';

export interface WatchProgress {
  text: string;
  /** 0..1 when known. */
  fraction?: number;
}

type Navigation = {navigate: (screen: string, params?: object) => void};

/** PikPak and some services report raw phase names. */
export const statusText = (status: string): string => {
  const known: Record<string, string> = {
    PHASE_TYPE_RUNNING: 'downloading',
    PHASE_TYPE_PENDING: 'waiting',
    PHASE_TYPE_COMPLETE: 'done',
    PHASE_TYPE_ERROR: 'failed',
  };
  return known[status] || status.replace(/_/g, ' ').toLowerCase();
};

const magnetOf = (result: TorrentResult): string => result.magnet || (result.infoHash ? `magnet:?xt=urn:btih:${result.infoHash}` : '');

/**
 * The routes for this result. Cache checks run here when the caller has none
 * (link intake, the Magnet screen); a failed check just means no cached route.
 */
export const buildWatchPlan = async (result: TorrentResult, cachedOn?: DebridId[]): Promise<WatchRoutePlan> => {
  const services = connectedServices().filter(service => service.id !== 'pikpak');
  let cached = cachedOn;
  const hash = result.infoHash?.toLowerCase();
  if (!cached) {
    cached = hash && services.some(service => service.canCheckCache) ? (await checkAllCaches([hash]).catch(() => ({} as Record<string, DebridId[]>)))[hash] || [] : [];
  }
  const linkable = Boolean(result.magnet || result.infoHash || result.detailUrl);
  return planWatchRoutes({
    services: services.map(service => ({id: service.id, name: service.name, canCheckCache: service.canCheckCache})),
    cachedOn: cached,
    pikpak: isPikPakSignedIn(),
    hasMagnet: linkable,
    canStream: linkable || Boolean(result.torrentUrl),
  });
};

const progressOf = (name: string, transfer: DebridTransfer): WatchProgress => ({
  text: `${name}: ${Math.round(transfer.progress * 100)}% · ${statusText(transfer.status)}`,
  fraction: transfer.progress,
});

const PIKPAK_WAIT_MS = 60 * 60 * 1000;
const UNCACHED_WAIT_MS = 15 * 60 * 1000;

/** Starts one route; resolves once the player opened. Throws so the caller can try the next route. */
export const runWatchRoute = async (
  route: WatchRoute,
  input: TorrentResult,
  navigation: Navigation,
  options: {onProgress?: (progress: WatchProgress) => void; signal?: AbortSignal} = {},
): Promise<void> => {
  const report = options.onProgress || (() => undefined);
  const stopped = () => {
    if (options.signal?.aborted) throw new Error('Cancelled');
  };
  report({text: 'Getting the magnet…'});
  const result = await resolveResult(input);
  stopped();
  if (route.kind === 'torrent') {
    report({text: 'Starting the torrent on this device…'});
    await streamOnDevice(result, navigation);
    return;
  }
  const magnet = magnetOf(result);
  if (!magnet) throw new Error('This result has no magnet link');

  if (route.kind === 'debrid') {
    const name = getService(route.service).name;
    report({text: `Asking ${name}…`});
    const resolution = await sendToDebrid(route.service, magnet, {
      signal: options.signal,
      maxWaitMs: route.cached ? 45000 : UNCACHED_WAIT_MS,
      onProgress: transfer => report(progressOf(name, transfer)),
    });
    stopped();
    const file = pickVideo(resolution.files);
    if (!file || !VIDEO_FILE.test(file.name)) throw new Error(`No video in this torrent on ${name}`);
    await playDebridFile(resolution, file, navigation, result.title);
    return;
  }

  report({text: 'Adding to PikPak…'});
  const resolution = await sendToDebrid('pikpak', magnet, {
    signal: options.signal,
    maxWaitMs: PIKPAK_WAIT_MS,
    onProgress: transfer => report(progressOf('PikPak', transfer)),
  });
  stopped();
  const file = pickVideo(resolution.files);
  if (!file || !VIDEO_FILE.test(file.name)) throw new Error('No video in this torrent on PikPak');
  report({text: 'Opening PikPak…', fraction: 1});
  const key = versionKey(PIKPAK_SOURCE_ID, file.id);
  // Played as a library file so PikPak's transcodes show as qualities in the player.
  const opened = await playNetlibVersion(navigation, looseCloudItem(PIKPAK_SOURCE_ID, file.id, result.title || file.name), key);
  if (!opened) throw new Error('PikPak could not play this video');
};
