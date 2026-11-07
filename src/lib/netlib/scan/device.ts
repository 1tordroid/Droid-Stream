import {listLocalFolder} from '../../localContent/files';
import type {NetlibLister} from './walk';

/** Folder listing of a folder on this device; paths are file or content URIs. */
export const deviceLister: NetlibLister = async folder =>
  (await listLocalFolder(folder)).map(entry => ({path: entry.uri, name: entry.name, directory: entry.directory}));
