import type {SavedSource} from '../../sources/vault';
import {listWebDav} from '../../sources/webdav';
import type {NetlibLister} from './walk';

/** Folder listing of a WebDAV source; paths are file URLs. */
export const webDavLister = (source: SavedSource): NetlibLister => async folder =>
  (await listWebDav(source.server, folder || source.server, source.username, source.secret)).map(file => ({
    path: file.href,
    name: file.name,
    directory: file.directory,
    ...(file.size !== undefined ? {size: file.size} : {}),
    ...(file.modified !== undefined ? {modified: file.modified} : {}),
    ...(file.etag ? {etag: file.etag} : {}),
  }));
