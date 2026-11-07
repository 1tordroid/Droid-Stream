import {cleanupDownloadStaging} from '../downloadDestination';
import {getEngineOptions} from '../downloadEngine/engineStore';
import {LiveDrmError} from '../downloadEngine/livePlaylist';
import {cancelLiveRecording, recordLive, type LiveSource} from '../liveRecorder';
import useDownloadsStore from '../zustand/downloadsStore';
import type {DownloadBackend, DownloadBackendContext} from './types';

/** JioTV links expire within hours and must be fetched when the recording starts. */
const jioSource = async (channelId: string): Promise<LiveSource> => {
  const {getJioStream} = require('../livetv/jio/channels') as typeof import('../livetv/jio/channels');
  const stream = await getJioStream(channelId);
  if (stream.drm || stream.type === 'mpd') throw new LiveDrmError();
  return {url: stream.url, headers: stream.headers};
};

/** Live HLS recording. Stop (Downloads, "Stop and save") keeps what was recorded. */
export const liveDownloadBackend: DownloadBackend = {
  preserveStagingOnFailure: true,
  async start({record, destination}: DownloadBackendContext): Promise<void> {
    const options = getEngineOptions(record.id).live || {};
    const refreshSource = options.jioChannelId ? () => jioSource(options.jioChannelId!) : undefined;
    const source = refreshSource ? await refreshSource() : {url: record.url, headers: record.headers};
    const started = Date.now();
    useDownloadsStore.getState().updateDownload(record.id, {backendJobId: record.id, status: 'downloading', canPause: false, canResume: false});
    let lastBytes = 0;
    let lastAt = started;
    await recordLive({
      downloadId: record.id,
      source,
      refreshSource,
      tempDirectory: `${destination.stagingDirectory}/live`,
      outputPath: destination.stagingPath,
      // The container is chosen when the recording is added (Advanced downloads).
      format: record.videoType === 'ts' ? 'mpegts' : 'mp4',
      limits: {stopAt: options.stopAt, maxDurationMs: options.maxDurationMs},
      onProgress: bytes => {
        const now = Date.now();
        const speed = now > lastAt ? ((bytes - lastBytes) * 1000) / (now - lastAt) : 0;
        lastBytes = bytes;
        lastAt = now;
        useDownloadsStore.getState().updateProgress(record.id, bytes, 0, Math.max(0, speed));
      },
      onFinalizing: () => useDownloadsStore.getState().updateDownload(record.id, {status: 'finalizing', canPause: false, canResume: false}),
    });
  },
  cancel: cancelLiveRecording,
  async cleanup(downloadId: string): Promise<void> {
    await cleanupDownloadStaging(downloadId);
  },
};
