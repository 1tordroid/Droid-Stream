import {cleanupDownloadStaging} from '../downloadDestination';
import {parseEd2kLink} from '../ed2k/link';
import {
  cancelEd2kTransfer,
  ensureEd2kServers,
  isEd2kCancelledError,
  isEd2kPausedError,
  onEd2kProgress,
  pauseEd2kTransfer,
  startEd2kTransfer,
} from '../ed2k/native';
import {isEd2kEnabled} from '../ed2k/settings';
import {formatEd2kStatus, useEd2kStatusStore} from '../ed2k/status';
import {readTorrentSettings} from '../torrent/settings';
import useDownloadsStore from '../zustand/downloadsStore';
import {DownloadPausedError, type DownloadBackend, type DownloadBackendContext} from './types';

/**
 * eD2k files download into the staging file with a part map beside it, so a
 * paused or interrupted download continues from its finished blocks. Pause
 * stops the native transfer and closes every connection; resume starts it
 * again through the queue. Peer-to-peer downloads follow the torrent Wi-Fi
 * only setting.
 */
export const ed2kDownloadBackend: DownloadBackend = {
  preserveStagingOnFailure: true,
  restartOnResume: true,

  async start({record, destination}: DownloadBackendContext): Promise<void> {
    const link = parseEd2kLink(record.url);
    if (!link || link.kind !== 'file') {
      throw new Error('This is not an eD2k file link');
    }
    if (!isEd2kEnabled()) {
      throw new Error('eD2k downloads are off. Turn them on in Settings > Preferences.');
    }
    // Peers named in the link work without a server.
    const servers = await ensureEd2kServers().catch(error => {
      if (link.sources.length > 0) return [];
      throw error;
    });
    const store = useDownloadsStore.getState();
    store.updateDownload(record.id, {
      backendJobId: link.hash,
      status: 'downloading',
      totalBytes: link.size,
      canPause: true,
      canResume: false,
    });
    const statusStore = useEd2kStatusStore.getState();
    statusStore.set(record.id, 'eD2k · Connecting to a server');
    const unsubscribe = onEd2kProgress(event => {
      if (event.downloadId !== record.id) return;
      useDownloadsStore
        .getState()
        .updateProgress(record.id, event.downloadedBytes, event.totalBytes, event.speed);
      useEd2kStatusStore.getState().set(record.id, formatEd2kStatus(event));
    });
    try {
      await startEd2kTransfer(
        record.id,
        {
          hash: link.hash,
          size: link.size,
          path: destination.stagingPath,
          sources: link.sources,
          partHashes: link.partHashes,
          wifiOnly: readTorrentSettings().wifiOnly,
        },
        servers,
      );
    } catch (error) {
      if (isEd2kPausedError(error)) throw new DownloadPausedError();
      if (isEd2kCancelledError(error)) throw new Error('Download cancelled');
      throw error;
    } finally {
      unsubscribe();
      useEd2kStatusStore.getState().clear(record.id);
    }
  },

  async pause(downloadId: string): Promise<void> {
    await pauseEd2kTransfer(downloadId);
  },

  // Resume is restarted through the manager queue.
  async resume(): Promise<void> {},

  async cancel(downloadId: string): Promise<void> {
    await cancelEd2kTransfer(downloadId);
  },

  async cleanup(downloadId: string): Promise<void> {
    useEd2kStatusStore.getState().clear(downloadId);
    await cleanupDownloadStaging(downloadId);
  },
};
