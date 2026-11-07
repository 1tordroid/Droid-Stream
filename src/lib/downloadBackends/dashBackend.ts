import {cleanupDownloadStaging} from '../downloadDestination';
import {cancelDashDownload, dashDownloader, pauseDashDownload} from '../dashDownloader';
import {getEngineOptions} from '../downloadEngine/engineStore';
import {settingsStorage} from '../storage';
import useDownloadsStore from '../zustand/downloadsStore';
import {createDownloadProgressReporter} from './httpBackend';
import type {DownloadBackend, DownloadBackendContext} from './types';

/** MPEG-DASH: the chosen video and audio, joined into one file. */
export const dashDownloadBackend: DownloadBackend = {
  preserveStagingOnFailure: true,
  restartOnResume: true,
  async start({record, destination}: DownloadBackendContext): Promise<void> {
    const store = useDownloadsStore.getState();
    store.updateDownload(record.id, {backendJobId: record.id, status: 'downloading', canPause: true, canResume: false});
    const report = createDownloadProgressReporter((downloaded, total, speed) =>
      useDownloadsStore.getState().updateProgress(record.id, downloaded, total, speed),
    );
    await dashDownloader({
      downloadId: record.id,
      manifestUrl: record.url,
      headers: record.headers,
      wanted: getEngineOptions(record.id).dash,
      tempDirectory: `${destination.stagingDirectory}/dash`,
      outputPath: destination.stagingPath,
      connections: settingsStorage.getDownloadConnections(),
      onProgress: (downloaded, total) => report({bytesWritten: downloaded, totalBytes: total}),
      onFinalizing: () => useDownloadsStore.getState().updateDownload(record.id, {status: 'finalizing', canPause: false, canResume: false}),
    });
  },
  pause: pauseDashDownload,
  async resume(): Promise<void> {}, // Resume starts again through the queue.
  cancel: cancelDashDownload,
  async cleanup(downloadId: string): Promise<void> {
    await cleanupDownloadStaging(downloadId);
  },
};
