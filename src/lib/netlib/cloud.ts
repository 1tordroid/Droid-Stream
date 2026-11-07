/**
 * Cloud accounts as library sources: the PikPak drive, each signed-in debrid
 * service (its transfers are the folders) and a Tordroid Plus portal (each
 * finished family download is a folder). They list and play through the same
 * poster library as WebDAV and SMB. Original code written for Droid Stream.
 */
import {connectedServices, debridKey, getService, type DebridId, type DebridTransfer} from '../debrid';
import {isPikPakSignedIn, listPikPakFolder, pikpakStreams} from '../pikpak/drive';
import {isTordroidPlusSignedIn, listAllTordroidPlusTasks, tordroidPlusMedia} from '../tordroidPlus/client';
import {safeDecode} from '../sources/webdav';
import type {NetlibLister} from './scan/walk';
import {normalizeTitle, versionKey} from './ids';
import type {NetlibEntry, NetlibItem, NetlibSource, NetlibSourceKind} from './types';

export const PIKPAK_SOURCE_ID = 'cloud:pikpak';
export const TORDROID_PLUS_SOURCE_ID = 'cloud:tdplus';
const DEBRID_PREFIX = 'cloud:debrid:';

export const debridSourceId = (id: DebridId): string => `${DEBRID_PREFIX}${id}`;
export const debridIdOfSource = (sourceId: string): DebridId | undefined =>
  sourceId.startsWith(DEBRID_PREFIX) ? (sourceId.slice(DEBRID_PREFIX.length) as DebridId) : undefined;

export const isCloudKind = (kind: NetlibSourceKind | string): boolean => kind === 'pikpak' || kind === 'debrid' || kind === 'tdplus';
export const isCloudSourceId = (id: string): boolean => id.startsWith('cloud:');

/** PikPak and Tordroid Plus files can have several copies (transcodes); the player lists them all. */
export const hasQualityChoice = (sourceId: string): boolean => sourceId === PIKPAK_SOURCE_ID || sourceId === TORDROID_PLUS_SOURCE_ID;

/** The signed-in cloud accounts, in the order Library shows them. */
export const listCloudSources = (): NetlibSource[] => {
  const out: NetlibSource[] = [];
  if (isPikPakSignedIn()) out.push({id: PIKPAK_SOURCE_ID, kind: 'pikpak', name: 'PikPak', root: ''});
  for (const service of connectedServices()) {
    if (service.id !== 'pikpak' && service.list) out.push({id: debridSourceId(service.id), kind: 'debrid', name: service.name, root: ''});
  }
  if (isTordroidPlusSignedIn()) out.push({id: TORDROID_PLUS_SOURCE_ID, kind: 'tdplus', name: 'Tordroid Plus', root: ''});
  return out;
};

// ------------------------------------------------------------------ paths
// PikPak paths are file ids ('' is the top). Debrid: "t:<transfer>" is a
// transfer folder, "f:<transfer>/<file>" one of its files. Tordroid Plus:
// "d:<file id>" is a finished download, a plain id one of its videos.

const enc = encodeURIComponent;

export const debridTransferPath = (transferId: string): string => `t:${enc(transferId)}`;
export const debridFilePath = (transferId: string, fileId: string): string => `f:${enc(transferId)}/${enc(fileId)}`;

export const parseDebridPath = (path: string): {transferId: string; fileId?: string} | undefined => {
  if (path.startsWith('t:')) return {transferId: safeDecode(path.slice(2))};
  if (path.startsWith('f:')) {
    const [transfer, file] = path.slice(2).split('/');
    if (transfer && file) return {transferId: safeDecode(transfer), fileId: safeDecode(file)};
  }
  return undefined;
};

export const tordroidPlusDownloadPath = (fileId: string): string => `d:${fileId}`;

// ------------------------------------------------------------------ listing

const pikpakLister: NetlibLister = async folder =>
  (await listPikPakFolder(folder)).map(entry => ({
    path: entry.id,
    name: entry.name,
    directory: entry.folder,
    ...(entry.folder ? {} : {size: entry.size}),
    ...(entry.modified !== undefined ? {modified: entry.modified} : {}),
    ...(entry.thumbnail ? {thumbnail: entry.thumbnail} : {}),
    ...(entry.mimeType ? {mimeType: entry.mimeType} : {}),
  }));

/** Transfers from the last listing, so a transfer whose files came with it is not asked for again. */
const transferCache = new Map<string, DebridTransfer>();

const debridLister = (serviceId: DebridId): NetlibLister => async folder => {
  const service = getService(serviceId);
  const key = debridKey(serviceId);
  if (!key) throw new Error(`Add your ${service.name} key in Torrents > Debrid and cloud first.`);
  const parsed = parseDebridPath(folder);
  if (!parsed) {
    const transfers = (await service.list!(key)).filter(transfer => transfer.ready);
    transfers.forEach(transfer => transferCache.set(`${serviceId}:${transfer.id}`, transfer));
    return transfers.map(transfer => ({path: debridTransferPath(transfer.id), name: transfer.name || 'Transfer', directory: true}));
  }
  const cached = transferCache.get(`${serviceId}:${parsed.transferId}`);
  const transfer = cached?.files.length ? cached : await service.status(key, parsed.transferId);
  return transfer.files.map(file => ({path: debridFilePath(transfer.id, file.id), name: file.name, directory: false, size: file.size}));
};

const tordroidPlusLister: NetlibLister = async folder => {
  if (!folder) {
    const seen = new Set<string>();
    return (await listAllTordroidPlusTasks())
      .filter(task => task.state === 'done' && task.fileId && !seen.has(task.fileId) && seen.add(task.fileId))
      .map(task => ({
        path: tordroidPlusDownloadPath(task.fileId!),
        name: task.name,
        directory: true,
        ...(task.createdAt ? {modified: task.createdAt} : {}),
      }));
  }
  const id = folder.startsWith('d:') ? folder.slice(2) : folder;
  const media = await tordroidPlusMedia(id);
  if (media.type === 'folder') {
    return media.videos.map(video => ({path: video.id, name: video.name, directory: false, size: video.size, ...(video.thumbnail ? {thumbnail: video.thumbnail} : {})}));
  }
  return [{path: media.id || id, name: media.name, directory: false, size: media.size, ...(media.mimeType ? {mimeType: media.mimeType} : {})}];
};

export const cloudLister = (source: NetlibSource): NetlibLister => {
  if (source.kind === 'pikpak') return pikpakLister;
  if (source.kind === 'tdplus') return tordroidPlusLister;
  const serviceId = debridIdOfSource(source.id);
  if (!serviceId) throw new Error('This source was removed.');
  return debridLister(serviceId);
};

// ------------------------------------------------------------------ playing

export interface CloudStream {
  url: string;
  type: string;
  /** Shown in the player's source list, e.g. "PikPak 1080p". */
  label: string;
}

/** Every copy of a cloud file the player can open, best first. */
export const resolveCloudStreams = async (sourceId: string, path: string): Promise<CloudStream[]> => {
  if (sourceId === PIKPAK_SOURCE_ID) {
    if (!isPikPakSignedIn()) throw new Error('Sign in to PikPak again to play this video.');
    return (await pikpakStreams(path)).map(quality => ({url: quality.url, type: quality.type, label: `PikPak ${quality.label}`}));
  }
  if (sourceId === TORDROID_PLUS_SOURCE_ID) {
    const media = await tordroidPlusMedia(path.startsWith('d:') ? path.slice(2) : path);
    if (media.type === 'folder') throw new Error('Open this download and pick a video.');
    if (!media.streams.length) throw new Error('Tordroid Plus has no link for this file yet.');
    return media.streams.map(stream => ({url: stream.url, type: stream.type, label: `Tordroid Plus ${stream.label}`}));
  }
  const serviceId = debridIdOfSource(sourceId);
  const parsed = parseDebridPath(path);
  if (!serviceId || !parsed?.fileId) throw new Error('This library file link is not valid.');
  const service = getService(serviceId);
  const key = debridKey(serviceId);
  if (!key) throw new Error(`Add your ${service.name} key again to play this video.`);
  const transfer = await service.status(key, parsed.transferId);
  const file = transfer.files.find(item => item.id === parsed.fileId);
  if (!file) throw new Error(`This file is no longer in ${service.name}.`);
  const url = await service.fileLink(key, transfer, file);
  return [{url, type: /\.m3u8(\?|$)/i.test(url) ? 'm3u8' : 'mkv', label: service.name}];
};

/** Lets a folder listing show pictures beside videos. */
export const isCloudEntryImage = (entry: NetlibEntry): boolean =>
  !entry.directory && (Boolean(entry.mimeType?.startsWith('image/')) || /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(entry.name));

/**
 * A library title for one cloud file that is not (yet) in a scanned library,
 * so it plays through the library player with its quality choices.
 */
export const looseCloudItem = (sourceId: string, path: string, name: string): NetlibItem => ({
  id: `${sourceId}|other|${normalizeTitle(path)}|`,
  sourceId,
  kind: 'other',
  title: name,
  versions: [{key: versionKey(sourceId, path), name}],
  episodes: [],
  added: 0,
});
