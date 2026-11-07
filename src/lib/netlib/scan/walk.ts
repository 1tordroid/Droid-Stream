import {isNetlibVideo} from '../parsePath';
import type {NetlibEntry, NetlibFile} from '../types';

export type NetlibLister = (folder: string) => Promise<NetlibEntry[]>;

export const MAX_DEPTH = 8;
export const MAX_FILES = 5000;

const SKIP_FOLDER = /^(\.|@eaDir$|#recycle$|\$recycle\.bin$|lost\+found$|system volume information$|\.trash)/i;

/**
 * Lists folders one at a time from the root down and keeps the videos, with
 * the folder names above each one. Stops at MAX_DEPTH folders deep and
 * MAX_FILES videos. A folder that fails to list is skipped.
 */
export const walkVideos = async (
  root: string,
  list: NetlibLister,
  options: {signal?: AbortSignal; onProgress?: (found: number) => void} = {},
): Promise<{files: NetlibFile[]; truncated: boolean}> => {
  const files: NetlibFile[] = [];
  const pending: {path: string; folders: string[]}[] = [{path: root, folders: []}];
  let truncated = false;
  let first = true;
  while (pending.length) {
    if (options.signal?.aborted) throw new Error('Scan cancelled');
    const folder = pending.shift()!;
    let entries: NetlibEntry[];
    try {
      entries = await list(folder.path);
    } catch (error) {
      // The root itself failing means the source is unreachable.
      if (first) throw error;
      continue;
    } finally {
      first = false;
    }
    for (const entry of entries) {
      if (entry.directory) {
        if (folder.folders.length < MAX_DEPTH && !SKIP_FOLDER.test(entry.name)) {
          pending.push({path: entry.path, folders: [...folder.folders, entry.name]});
        }
      } else if (isNetlibVideo(entry.name)) {
        if (files.length >= MAX_FILES) {
          truncated = true;
          break;
        }
        const {directory: _directory, ...file} = entry;
        files.push({...file, folders: folder.folders});
      }
    }
    options.onProgress?.(files.length);
    if (truncated) break;
  }
  return {files, truncated};
};
