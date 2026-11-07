import {listSmbShare, normalizeSmbPath} from '../../sources/smb';
import type {SavedSource} from '../../sources/vault';
import type {NetlibLister} from './walk';

/** Folder listing of an SMB share; paths are "/folder/file" inside the share. */
export const smbLister = (source: SavedSource): NetlibLister => async folder => {
  const base = folder && folder !== '/' ? normalizeSmbPath(folder) : '';
  return (await listSmbShare(source.server, source.share || '', base, source.username, source.secret)).map(entry => ({
    path: `${base}/${entry.name}`,
    name: entry.name,
    directory: entry.directory,
    ...(entry.directory ? {} : {size: entry.size}),
  }));
};
