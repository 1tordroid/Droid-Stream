/* eslint-disable no-bitwise -- GIDs are an FNV-1a hash. */
/**
 * Downloads described the way aria2's JSON-RPC interface describes them, so
 * AriaNg and the aria2 browser extensions can show the list. Written from
 * aria2's public RPC documentation.
 */
import type {DownloadItem, DownloadStatus} from '../zustand/downloadsStore';

export type Aria2Status = 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';

/** Shown as the folder of every file; the real files stay in the app's download folder. */
export const ARIA2_DIR = '/Droid Stream';

const STATUS: Record<DownloadStatus, Aria2Status> = {
  queued: 'waiting',
  starting: 'active',
  downloading: 'active',
  pausing: 'active',
  finalizing: 'active',
  paused: 'paused',
  interrupted: 'paused',
  error: 'error',
  missing: 'error',
  completed: 'complete',
  canceling: 'removed',
};

export const aria2StatusOf = (status: DownloadStatus): Aria2Status => STATUS[status] || 'error';

const fnv1a = (text: string, seed: number): number => {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

/** aria2 GIDs are 16 hex digits. The same download always gets the same one. */
export const gidFor = (downloadId: string): string =>
  fnv1a(downloadId, 0x811c9dc5).toString(16).padStart(8, '0') +
  fnv1a(`${downloadId}\u0001`, 0x050c5d1f).toString(16).padStart(8, '0');

export const isGid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-fA-F]{16}$/.test(value);

const whole = (value: number | undefined): string => String(Math.max(0, Math.round(Number(value) || 0)));

const fileName = (item: DownloadItem): string =>
  (item.displayFileName || item.title || 'download').replace(/[\\/]+/g, '_');

/** The full aria2 status of one download. */
export const toAria2Status = (item: DownloadItem): Record<string, unknown> => {
  const status = aria2StatusOf(item.status);
  const total = item.status === 'completed' && !item.totalBytes ? item.downloadedBytes : item.totalBytes;
  const completed = item.status === 'completed' ? Math.max(item.downloadedBytes, total || 0) : item.downloadedBytes;
  const name = fileName(item);
  const uri = /^(https?|ftps?|ftpes):\/\//i.test(item.url) ? item.url : '';
  const result: Record<string, unknown> = {
    gid: gidFor(item.id),
    status,
    totalLength: whole(total),
    completedLength: whole(completed),
    uploadLength: '0',
    downloadSpeed: status === 'active' ? whole(item.speed) : '0',
    uploadSpeed: '0',
    connections: status === 'active' ? '1' : '0',
    numPieces: '0',
    pieceLength: '0',
    dir: ARIA2_DIR,
    files: [
      {
        index: '1',
        path: `${ARIA2_DIR}/${name}`,
        length: whole(total),
        completedLength: whole(completed),
        selected: 'true',
        uris: uri ? [{uri, status: 'used'}] : [],
      },
    ],
  };
  if (status === 'error') {
    result.errorCode = '1';
    result.errorMessage = item.errorMessage || 'The download failed';
  }
  if (item.sourceType === 'torrent') {
    const hash = item.torrentInfoHash || (typeof item.backendJobId === 'string' ? item.backendJobId : '');
    if (hash) result.infoHash = hash;
    result.numSeeders = '0';
    result.seeder = 'false';
    result.bittorrent = {info: {name}};
  }
  return result;
};

/** Only the asked-for keys, as aria2 does when tellStatus gets a key list. */
export const pickKeys = (status: Record<string, unknown>, keys: unknown): Record<string, unknown> => {
  if (!Array.isArray(keys) || keys.length === 0) return status;
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key === 'string' && key in status) picked[key] = status[key];
  }
  return picked;
};

/** aria2's offset rule: a negative offset counts from the end and the list is returned newest first. */
export const sliceLikeAria2 = <T,>(items: T[], offset: number, count: number): T[] => {
  if (!Number.isInteger(offset) || !Number.isInteger(count) || count <= 0) return [];
  if (offset >= 0) return items.slice(offset, offset + count);
  const end = items.length + offset + 1;
  if (end <= 0) return [];
  return items.slice(Math.max(0, end - count), end).reverse();
};
