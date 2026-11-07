/**
 * Download backend for "Video (photo with song)": fetches the photos and the
 * song, then makes an MP4 on the phone with FFmpeg.
 */
import * as RNFS from '@dr.pogodin/react-native-fs';
import {cleanupDownloadStaging} from '../downloadDestination';
import type {DownloadBackend, DownloadBackendContext} from '../downloadBackends/types';
import useDownloadsStore from '../zustand/downloadsStore';
import {buildPhotoSongArgs, songSegment, type VideoEncoder} from './photoVideo';
import {cancelFetches, cancelFfmpeg, fetchFile, mediaDuration, onFfmpegProgress, runFfmpeg} from './native';
import type {SocialVideoJob} from './types';

const cancelled = new Set<string>();

const setStage = (id: string, stage: string | undefined, extra: Record<string, unknown> = {}) => {
  const store = useDownloadsStore.getState();
  const current = store.getDownload(id);
  if (!current?.social || current.status === 'canceling') return;
  store.updateDownload(id, {...extra, social: {...current.social, stage}});
};

const throwIfCancelled = (id: string) => {
  if (cancelled.has(id)) throw new Error('Download cancelled');
};

const fileSize = async (path: string) => {
  try {
    return Number((await RNFS.stat(path)).size) || 0;
  } catch {
    return 0;
  }
};

const run = async ({record, destination}: DownloadBackendContext): Promise<void> => {
  const job: SocialVideoJob | undefined = record.social;
  if (!job?.images.length || !job.audioUrl) throw new Error('This download has no photos or song');
  const id = record.id;
  const work = `${destination.stagingDirectory}/work`;
  await RNFS.mkdir(work);
  useDownloadsStore.getState().updateDownload(id, {status: 'downloading', backendJobId: id, canPause: false, canResume: false});
  const headers = job.headers || {};
  const images: string[] = [];
  let downloaded = 0;
  for (const [index, image] of job.images.entries()) {
    setStage(id, `Photo ${index + 1} of ${job.images.length}`, {downloadedBytes: downloaded, speed: 0});
    const path = `${work}/photo${index + 1}.${image.ext || 'jpg'}`;
    await fetchFile(id, image.url, path, headers);
    throwIfCancelled(id);
    downloaded += await fileSize(path);
    images.push(path);
  }
  setStage(id, 'Song', {downloadedBytes: downloaded});
  const audio = `${work}/song.m4a`;
  await fetchFile(id, job.audioUrl, audio, headers);
  throwIfCancelled(id);
  downloaded += await fileSize(audio);

  const segment = songSegment((await mediaDuration(audio)) || undefined, job.start, job.duration);
  const stopProgress = onFfmpegProgress(id, timeMs => {
    const percent = Math.min(99, Math.round(timeMs / 10 / segment.duration));
    setStage(id, `Making video ${percent}%`);
  });
  try {
    let log = '';
    // The phone's H.264 encoder first; a few phones refuse it, so MPEG-4 is the fallback.
    for (const encoder of ['h264_mediacodec', 'mpeg4'] as VideoEncoder[]) {
      setStage(id, 'Making video', {downloadedBytes: downloaded, totalBytes: downloaded});
      const args = buildPhotoSongArgs({
        images,
        audio,
        output: destination.stagingPath,
        duration: segment.duration,
        start: segment.start,
        secondsPerImage: job.secondsPerImage,
        crossfade: job.crossfade,
        width: job.width,
        height: job.height,
        encoder,
      });
      const result = await runFfmpeg(id, args);
      throwIfCancelled(id);
      if (result.cancelled) throw new Error('Download cancelled');
      if (result.code === 0 && (await fileSize(destination.stagingPath)) > 0) {
        setStage(id, undefined);
        return;
      }
      log = result.log;
    }
    throw new Error(`Could not make the video. ${log.trim().split('\n').pop() || ''}`.trim());
  } finally {
    stopProgress();
    await RNFS.unlink(work).catch(() => undefined);
  }
};

export const socialDownloadBackend: DownloadBackend = {
  async start(context: DownloadBackendContext): Promise<void> {
    cancelled.delete(context.record.id);
    try {
      await run(context);
    } finally {
      cancelled.delete(context.record.id);
    }
  },

  async cancel(downloadId: string): Promise<void> {
    cancelled.add(downloadId);
    cancelFetches(downloadId);
    cancelFfmpeg(downloadId);
  },

  async cleanup(downloadId: string): Promise<void> {
    await cleanupDownloadStaging(downloadId);
  },
};
