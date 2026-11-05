/**
 * Internet Archive items are plain web files, so they can play at once over
 * HTTPS. The torrent for an item bundles every format and starts far slower.
 */
const ITEM_FROM_TORRENT = /archive\.org\/download\/([^/]+)\/[^/]+_archive\.torrent/i;
const VIDEO = /\.(mp4|m4v|webm|mkv|ogv|avi)$/i;
const FORMAT_ORDER = ['mp4', 'm4v', 'webm', 'mkv', 'ogv', 'avi'];

export interface ArchiveFile {
  name: string;
  size?: string | number;
}

export const archiveItemId = (torrentUrl?: string): string | undefined =>
  torrentUrl?.match(ITEM_FROM_TORRENT)?.[1];

/** Best file to stream: the widest supported format first, then the largest. */
export const pickArchiveVideo = (files: ArchiveFile[]): ArchiveFile | undefined =>
  files
    .filter(file => VIDEO.test(file.name) && !/sample|trailer/i.test(file.name))
    .sort((left, right) => {
      const format = (file: ArchiveFile) => FORMAT_ORDER.indexOf(file.name.split('.').pop()!.toLowerCase());
      return format(left) - format(right) || Number(right.size || 0) - Number(left.size || 0);
    })[0];

export const archiveFileUrl = (id: string, name: string): string =>
  `https://archive.org/download/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`;

/** Direct link for an Internet Archive result, or undefined for anything else. */
export const archiveDirectVideo = async (torrentUrl?: string): Promise<{url: string; name: string} | undefined> => {
  const id = archiveItemId(torrentUrl);
  if (!id) return undefined;
  try {
    const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}/files`);
    if (!response.ok) return undefined;
    const data = await response.json();
    const file = pickArchiveVideo(Array.isArray(data?.result) ? data.result : []);
    return file ? {url: archiveFileUrl(id, file.name), name: file.name} : undefined;
  } catch {
    return undefined;
  }
};
