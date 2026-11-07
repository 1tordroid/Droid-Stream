import {AppState} from 'react-native';
import {ensureDownloadLocationAccess, getDownloadFileName} from '../downloadLocation';
import {scheduleQueuedDownloads, waitForDownloadsHydration} from '../downloadManager';
import {settingsStorage} from '../storage';
import {torrentManager} from '../torrentManager';
import useDownloadsStore, {
  CURRENT_DOWNLOAD_STATUSES,
  type DownloadInput,
  type DownloadItem,
} from '../zustand/downloadsStore';
import {buildYtdlArgs, expectedExtension, sanitizeCustomArgs, splitArgs} from './args';
import {setLastKnownWifi} from './schedule';
import {readYtdlSettings} from './settings';
import type {YtdlJobSpec, YtdlRequest} from './types';

export interface YtdlQueueItem {
  url: string;
  title: string;
  thumbnail?: string | null;
  /** Position in a playlist, from 1. */
  index?: number;
  /** Playlist title: the items are saved in a folder of this name. */
  playlist?: string;
  extractor?: string | null;
}

export interface YtdlQueueOptions {
  notBefore?: number;
  wifiOnly?: boolean;
  /** Arguments of a template, as typed. */
  templateArgs?: string;
  qualityLabel?: string;
}

const sameJob = (item: DownloadItem, url: string, args: string[]): boolean =>
  item.sourceType === 'ytdlp' &&
  item.url === url &&
  CURRENT_DOWNLOAD_STATUSES.has(item.status) &&
  JSON.stringify(item.ytdl?.args) === JSON.stringify(args);

const newId = (): string => `ytdl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The download records for the chosen items. Pure, so the queue rules can be
 * tested: one record per item, nothing added twice while it is still in the queue.
 */
export const buildYtdlRecords = (
  items: YtdlQueueItem[],
  request: YtdlRequest,
  options: YtdlQueueOptions,
  existing: DownloadItem[],
  folderName: string,
  makeId: () => string = newId,
): {records: DownloadInput[]; duplicates: number} => {
  const extraArgs = [
    ...(request.extraArgs || []),
    ...(options.templateArgs ? sanitizeCustomArgs(splitArgs(options.templateArgs)).args : []),
  ];
  const args = buildYtdlArgs({...request, extraArgs});
  const ext = expectedExtension(request);
  const records: DownloadInput[] = [];
  let duplicates = 0;
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.url) || existing.some(record => sameJob(record, item.url, args))) {
      duplicates += 1;
      continue;
    }
    seen.add(item.url);
    const spec: YtdlJobSpec = {
      args,
      kind: request.kind,
      ext,
      notBefore: options.notBefore,
      wifiOnly: options.wifiOnly || undefined,
      extractor: item.extractor,
      playlist: item.playlist,
    };
    const title = item.title.trim() || 'Video';
    records.push({
      id: makeId(),
      title,
      type: 'series',
      showName: folderName.trim() || 'Video downloads',
      seasonTitle: item.playlist,
      episodeName: title,
      episodeIndex: item.index,
      url: item.url,
      poster: item.thumbnail || undefined,
      provider: 'yt-dlp',
      quality: options.qualityLabel,
      sourceType: 'ytdlp',
      // "Best" audio learns its real type when the download ends.
      videoType: ext || 'm4a',
      displayFileName: getDownloadFileName(title, ext || 'm4a'),
      filePath: '',
      status: 'queued',
      ytdl: spec,
    });
  }
  return {records, duplicates};
};

/** Adds the items to Downloads. Returns how many were added and how many were already there. */
export const enqueueYtdl = async (
  items: YtdlQueueItem[],
  request: YtdlRequest,
  options: YtdlQueueOptions = {},
): Promise<{added: number; duplicates: number} | undefined> => {
  const location = await ensureDownloadLocationAccess(settingsStorage.getDownloadLocationConfig());
  if (!location) return undefined;
  settingsStorage.setDownloadLocation(location);
  const store = useDownloadsStore.getState();
  const {records, duplicates} = buildYtdlRecords(
    items,
    request,
    options,
    Object.values(store.downloads),
    readYtdlSettings().folderName,
  );
  for (const record of records) {
    store.enqueueDownload({...record, downloadLocation: location});
  }
  if (options.wifiOnly) await refreshWifi();
  await scheduleQueuedDownloads();
  ensureYtdlScheduler();
  return {added: records.length, duplicates};
};

const refreshWifi = async (): Promise<void> => {
  setLastKnownWifi(await torrentManager.isOnWifi().catch(() => true));
};

const hasWaiting = (): boolean =>
  Object.values(useDownloadsStore.getState().downloads).some(
    item => item.status === 'queued' && item.sourceType === 'ytdlp' && (item.ytdl?.notBefore || item.ytdl?.wifiOnly),
  );

let timer: ReturnType<typeof setInterval> | undefined;
let appStateWatched = false;

/**
 * While a yt-dlp download waits for its start time or for Wi-Fi, check every
 * 30 seconds. The download service keeps the app running in the background
 * only while something downloads, so a scheduled start also needs the app open
 * or another download running.
 */
export const ensureYtdlScheduler = (): void => {
  if (timer || !hasWaiting()) return;
  const tick = async () => {
    if (!hasWaiting()) {
      if (timer) clearInterval(timer);
      timer = undefined;
      return;
    }
    await refreshWifi();
    await scheduleQueuedDownloads();
  };
  timer = setInterval(() => {
    tick().catch(() => undefined);
  }, 30_000);
  if (!appStateWatched) {
    appStateWatched = true;
    AppState?.addEventListener?.('change', state => {
      if (state === 'active' && timer) tick().catch(() => undefined);
    });
  }
};

/** Picks up waiting downloads saved before the app was closed. */
export const startYtdlScheduler = (): void => {
  waitForDownloadsHydration()
    .then(ensureYtdlScheduler)
    .catch(() => undefined);
};
