import {fileCategory} from '../downloadEngine/planner';
import type {DownloadItem} from '../zustand/downloadsStore';

export type StatusFilter = 'all' | 'downloading' | 'completed' | 'paused' | 'failed';
export type TypeFilter = 'all' | 'video' | 'subtitle' | 'other';
export type SourceFilter = 'all' | 'vega' | 'torrent' | 'webdav' | 'pikpak';
export type DownloadSort = 'name' | 'date' | 'size' | 'progress';

const statusOf = (item: DownloadItem): StatusFilter => {
  if (item.status === 'completed') return 'completed';
  if (item.status === 'paused' || item.status === 'pausing') return 'paused';
  if (item.status === 'error' || item.status === 'interrupted' || item.status === 'missing') return 'failed';
  return 'downloading';
};

const sourceOf = (item: DownloadItem): SourceFilter => {
  const text = `${item.url} ${item.provider || ''} ${item.server || ''}`.toLowerCase();
  if (item.isTorrent || item.sourceType === 'torrent' || text.includes('magnet:')) return 'torrent';
  if (text.includes('webdav')) return 'webdav';
  if (text.includes('pikpak')) return 'pikpak';
  return 'vega';
};

const typeOf = (item: DownloadItem): TypeFilter => {
  if (item.isSubtitle) return 'subtitle';
  const category = fileCategory(item.displayFileName || item.title, item.mimeType || '');
  if (category === 'Subtitles') return 'subtitle';
  if (category === 'Video') return 'video';
  return 'other';
};

export const matchesDownload = (
  item: DownloadItem,
  query: string,
  status: StatusFilter,
  type: TypeFilter,
  source: SourceFilter,
): boolean => {
  const haystack = `${item.title} ${item.showName || ''} ${item.displayFileName || ''} ${item.videoType || ''}`.toLowerCase();
  if (query && !haystack.includes(query.toLowerCase())) return false;
  if (status !== 'all' && statusOf(item) !== status) return false;
  if (type !== 'all' && typeOf(item) !== type) return false;
  if (source !== 'all' && sourceOf(item) !== source) return false;
  return true;
};

export const sortDownloads = (items: DownloadItem[], sort: DownloadSort): DownloadItem[] =>
  [...items].sort((left, right) => {
    if (sort === 'name') return left.title.localeCompare(right.title);
    if (sort === 'size') return right.totalBytes - left.totalBytes;
    if (sort === 'progress') {
      const leftProgress = left.totalBytes ? left.downloadedBytes / left.totalBytes : 0;
      const rightProgress = right.totalBytes ? right.downloadedBytes / right.totalBytes : 0;
      return rightProgress - leftProgress;
    }
    return (right.completedAt || right.updatedAt) - (left.completedAt || left.updatedAt);
  });
