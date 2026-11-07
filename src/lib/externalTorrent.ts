import {AppState, type NativeEventSubscription} from 'react-native';
import {torrentManager} from './torrentManager';
import {isTorrentStream, resolveTorrentStream} from './torrentStream';
import {readStoredTorrents} from './torrent/settings';
import {settingsStorage} from './storage/SettingsStorage';
import useDownloadsStore from './zustand/downloadsStore';

// Torrents this flow added for an external player. Only these are removed
// again, and only while no download or Torrents tab entry uses them.
const ownedHashes = new Set<string>();
let returnWatch: NativeEventSubscription | undefined;

const VIDEO_FILE = /\.(mp4|mkv|avi|webm|mov|ts|flv|wmv|m4v)$/i;

/** True when a download or the Torrents tab also holds this torrent. */
export const isTorrentHeldElsewhere = (infoHash: string): boolean => {
  const hash = infoHash.toLowerCase();
  if (readStoredTorrents().some(item => item.infoHash?.toLowerCase() === hash)) {
    return true;
  }
  return Object.values(useDownloadsStore.getState().downloads).some(
    item =>
      item.status !== 'completed' &&
      (item.torrentInfoHash?.toLowerCase() === hash ||
        String(item.backendJobId ?? '').toLowerCase() === hash),
  );
};

const largestVideoIndex = async (infoHash: string): Promise<number> => {
  const files = await torrentManager.getFiles(infoHash);
  if (!files?.length) throw new Error('No files found in torrent');
  const videos = files.filter(file => VIDEO_FILE.test(file.name));
  const pool = videos.length ? videos : files;
  return pool.reduce((best, file) => (file.size > best.size ? file : best), pool[0]).index;
};

/** Removes this flow's torrents that nothing else holds, then lets the engine sleep. */
export const releaseExternalTorrents = async (): Promise<void> => {
  returnWatch?.remove();
  returnWatch = undefined;
  const deleteFiles = !settingsStorage.keepDirectTorrentFile();
  for (const hash of [...ownedHashes]) {
    ownedHashes.delete(hash);
    if (isTorrentHeldElsewhere(hash)) continue;
    await torrentManager.deleteTorrent(hash, deleteFiles).catch(() => {});
  }
  const remaining = await torrentManager.listTorrents().catch(() => undefined);
  if (remaining && remaining.length === 0) await torrentManager.releaseEngineForeground();
};

// External players keep the app in the background; the torrent goes when the
// user comes back to Droid Stream.
const releaseOnReturn = () => {
  returnWatch?.remove();
  let left = false;
  returnWatch = AppState.addEventListener('change', state => {
    if (state === 'background') left = true;
    else if (state === 'active' && left) releaseExternalTorrents().catch(() => {});
  });
};

/**
 * Turns a stream into a URL an external player can open. Torrents start on the
 * phone and play from the local stream server; other links pass through.
 */
export const externalPlayerUrl = async (stream: {link: string; type?: string}): Promise<string> => {
  if (!isTorrentStream(stream)) return stream.link;
  await releaseExternalTorrents();
  const resolved = await resolveTorrentStream(stream.link, {
    addTorrent: link => torrentManager.addTorrent(link),
    deleteTorrent: hash => torrentManager.deleteTorrent(hash, !settingsStorage.keepDirectTorrentFile()),
    findVideoFileIndex: largestVideoIndex,
    prepareVideoFile: (hash, fileIndex) =>
      torrentManager.prepareVideoFile(hash, fileIndex, false, settingsStorage.isTorrentFullDownload()),
    getStreamUrl: (hash, fileIndex) => torrentManager.getStreamUrl(hash, fileIndex),
    onAdded: hash => {
      // A torrent that was already running for something else stays its own.
      if (!isTorrentHeldElsewhere(hash)) ownedHashes.add(hash);
    },
    isCancelled: () => false,
  });
  if (!resolved) throw new Error('Torrent could not be started');
  resolved.preparation.catch(() => {});
  // The engine must keep running while another app is in front.
  await torrentManager.keepEngineInForeground();
  releaseOnReturn();
  return resolved.streamUrl;
};
