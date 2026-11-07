import * as RNFS from '@dr.pogodin/react-native-fs';
import {cleanupDownloadStaging} from '../downloadDestination';
import {
  copyFileToSaf,
  getOrCreateSafDirectory,
  isSafDownloadLocation,
} from '../downloadLocation';
import {
  createDownloadDirectoryName,
  createDownloadSeasonDirectoryName,
  sanitizeDownloadFileName,
} from '../downloadId';
import {ytdlCancel, ytdlDownload, onYtdlEvent} from '../ytdl/native';
import {cleanYtdlError, ProgressAggregator, stageLabel} from '../ytdl/progress';
import useDownloadsStore, {type DownloadItem} from '../zustand/downloadsStore';
import {DownloadPausedError, type DownloadBackend, type DownloadBackendContext} from './types';

const running = new Map<string, Promise<void>>();
const pausing = new Set<string>();
const cancelling = new Set<string>();

const patchSpec = (id: string, patch: Partial<NonNullable<DownloadItem['ytdl']>>, extra: Partial<DownloadItem> = {}) => {
  const store = useDownloadsStore.getState();
  const current = store.getDownload(id);
  if (!current?.ytdl) return;
  store.updateDownload(id, {...extra, ytdl: {...current.ytdl, ...patch}});
};

const baseName = (record: DownloadItem): string =>
  record.displayFileName?.replace(/\.[^.]+$/, '') || record.title;

/** Subtitle files kept beside the video, named like it: "Title.en.srt". */
const saveSidecars = async (record: DownloadItem, files: string[]): Promise<void> => {
  const location = record.downloadLocation;
  if (!location || files.length === 0) return;
  const folders = [
    createDownloadDirectoryName(record.showName || record.title),
    createDownloadSeasonDirectoryName(record.seasonTitle),
  ].filter((name): name is string => Boolean(name));
  for (const file of files) {
    const name = file.split('/').pop() || '';
    // media.en.srt -> "en", "srt"
    const match = name.match(/^media\.(.+)\.([a-z0-9]+)$/i);
    if (!match) continue;
    const fileName = `${baseName(record)}.${match[1]}`;
    try {
      if (isSafDownloadLocation(location)) {
        let directory = location.uri;
        for (const folder of folders) directory = await getOrCreateSafDirectory(directory, folder);
        await copyFileToSaf({fromPath: file, directoryUri: directory, fileName, fileType: match[2]});
      } else {
        const directory = [location.path, ...folders.map(sanitizeDownloadFileName)].join('/');
        await RNFS.mkdir(directory);
        await RNFS.copyFile(file, `${directory}/${sanitizeDownloadFileName(fileName)}.${match[2]}`);
      }
    } catch (error) {
      // A missing subtitle file must not fail the video.
      console.warn('Subtitle file could not be saved:', error);
    }
  }
};

const run = async ({record, destination}: DownloadBackendContext): Promise<void> => {
  const spec = record.ytdl;
  if (!spec) throw new Error('This download has no yt-dlp options');
  const id = record.id;
  const store = useDownloadsStore.getState();
  const workDir = `${destination.stagingDirectory}/work`;
  const progress = new ProgressAggregator();
  const unsubscribe = onYtdlEvent(id, event => {
    if (event.type === 'progress') {
      const next = progress.update(event);
      const current = useDownloadsStore.getState().getDownload(id);
      if (!current || current.status === 'pausing' || current.status === 'canceling') return;
      useDownloadsStore.getState().updateDownload(id, {
        status: 'downloading',
        downloadedBytes: next.downloaded,
        totalBytes: next.total,
        speed: next.speed,
        errorCode: undefined,
        errorMessage: undefined,
        ytdl: current.ytdl ? {...current.ytdl, eta: next.eta, stage: undefined} : current.ytdl,
      });
    } else if (event.status === 'started') {
      const label = stageLabel(event.name);
      if (label) patchSpec(id, {stage: label, eta: null}, {speed: 0});
    }
  });
  store.updateDownload(id, {
    status: 'downloading',
    backendJobId: id,
    canPause: true,
    canResume: false,
  });
  try {
    const result = await ytdlDownload(id, record.url, spec.args, workDir);
    if (result.cancelled || pausing.has(id) || cancelling.has(id)) {
      if (pausing.has(id) && !cancelling.has(id)) throw new DownloadPausedError();
      throw new Error('Download cancelled');
    }
    if (result.error || !result.file) {
      throw new Error(cleanYtdlError(result.error));
    }
    const latest = useDownloadsStore.getState().getDownload(id) || record;
    const ext = (result.ext || spec.ext || latest.videoType || 'mp4').toLowerCase();
    // "Best" audio keeps whatever type the site sends; name the file after it.
    store.updateDownload(id, {
      canPause: false,
      videoType: ext,
      displayFileName: `${baseName(latest)}.${ext}`,
      poster: latest.poster || result.thumbnail || undefined,
      ytdl: latest.ytdl ? {...latest.ytdl, ext, stage: undefined, eta: null} : latest.ytdl,
    });
    if (await RNFS.exists(destination.stagingPath)) await RNFS.unlink(destination.stagingPath);
    await RNFS.moveFile(result.file, destination.stagingPath);
    await saveSidecars(useDownloadsStore.getState().getDownload(id) || latest, result.subtitles || []);
  } finally {
    unsubscribe();
  }
};

export const ytdlpDownloadBackend: DownloadBackend = {
  // Partial files stay in the staging folder so yt-dlp continues them after a
  // pause, a failure or an app restart.
  preserveStagingOnFailure: true,
  restartOnResume: true,

  async start(context: DownloadBackendContext): Promise<void> {
    const id = context.record.id;
    pausing.delete(id);
    cancelling.delete(id);
    const job = run(context);
    running.set(id, job.catch(() => undefined));
    try {
      await job;
    } finally {
      running.delete(id);
      pausing.delete(id);
    }
  },

  async pause(downloadId: string): Promise<void> {
    if (!running.has(downloadId)) return;
    pausing.add(downloadId);
    await ytdlCancel(downloadId);
    await running.get(downloadId);
  },

  // Resume starts the job again through the queue; yt-dlp continues the partial files.
  async resume(): Promise<void> {},

  async cancel(downloadId: string): Promise<void> {
    cancelling.add(downloadId);
    await ytdlCancel(downloadId);
    await running.get(downloadId);
  },

  async cleanup(downloadId: string): Promise<void> {
    await cleanupDownloadStaging(downloadId);
  },
};
