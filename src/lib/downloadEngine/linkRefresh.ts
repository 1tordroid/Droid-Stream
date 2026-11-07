/**
 * Fresh links for downloads whose link expired: the provider is asked again
 * (as the player does when a stream link expires), or a debrid service makes
 * a new link for the same file.
 */
import {canRefreshDownloadSource, refreshDownloadSource} from '../downloadSourceRefresh';
import type {Stream} from '../providers/types';
import type {DownloadItem} from '../zustand/downloadsStore';
import {getEngineOptions} from './engineStore';

export const hasDebridSource = (record: Pick<DownloadItem, 'id'>): boolean => Boolean(getEngineOptions(record.id).debrid);

export const canRefreshLink = (record: DownloadItem): boolean => canRefreshDownloadSource(record) || hasDebridSource(record);

const refreshDebridLink = async (record: DownloadItem): Promise<Pick<DownloadItem, 'url' | 'headers'> | undefined> => {
  const source = getEngineOptions(record.id).debrid;
  if (!source) return undefined;
  const {debridKey, getService} = require('../debrid') as typeof import('../debrid');
  const service = getService(source.service as never);
  if (!service) return undefined;
  try {
    const url = await service.fileLink(
      debridKey(service.id),
      {id: source.transfer.id, name: source.transfer.name, progress: 1, ready: true, files: [], status: source.transfer.status || 'downloaded'},
      source.file,
    );
    return url ? {url, headers: record.headers} : undefined;
  } catch (error) {
    console.warn(`Unable to refresh the debrid link of download ${record.id}:`, error);
    return undefined;
  }
};

export const refreshLink = async (
  record: DownloadItem,
  signal?: AbortSignal,
  onStreams?: (streams: Stream[] | undefined) => void,
): Promise<Pick<DownloadItem, 'url' | 'headers'> | undefined> => {
  if (hasDebridSource(record)) {
    const fresh = await refreshDebridLink(record);
    return signal?.aborted ? undefined : fresh;
  }
  return refreshDownloadSource(record, signal, onStreams);
};
