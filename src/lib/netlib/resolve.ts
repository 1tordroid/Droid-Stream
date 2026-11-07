import {playbackHeaders} from '../sources/accounts';
import {openSmbStream} from '../sources/smb';
import {listSources, type SavedSource} from '../sources/vault';
import {getSourceSettings, listDeviceSources} from './cache';
import {parseVersionKey} from './ids';
import type {NetlibSource} from './types';

/** The saved sign-in behind a library source; device folders have none. */
export const savedSourceOf = (id: string): SavedSource | undefined => listSources().find(source => source.id === id);

const fromSaved = (source: SavedSource): NetlibSource | undefined =>
  source.kind === 'webdav' || source.kind === 'smb'
    ? {id: source.id, kind: source.kind, name: source.name, root: source.kind === 'webdav' ? source.server : ''}
    : undefined;

/** Every source that can have a library: WebDAV and SMB sources, then device folders. */
export const listNetlibSources = (): NetlibSource[] => [
  ...listSources().map(fromSaved).filter((source): source is NetlibSource => Boolean(source)),
  ...listDeviceSources(),
];

export const findNetlibSource = (id: string): NetlibSource | undefined => listNetlibSources().find(source => source.id === id);

/** Where a scan of this source starts: its settings' folder, else the source root. */
export const scanRootOf = (source: NetlibSource): string => getSourceSettings(source.id).root || source.root;

export interface NetlibStream {
  url: string;
  type: string;
  headers?: Record<string, string>;
  /** A file on this device. */
  local?: boolean;
}

/**
 * The address the player opens for a library file. WebDAV sends the saved
 * sign-in as headers, SMB opens a loopback stream, device files play as they are.
 * Throws a message for the user when the source is gone or cannot play.
 */
export const resolveNetlibStream = async (key: string): Promise<NetlibStream> => {
  const parsed = parseVersionKey(key);
  if (!parsed) throw new Error('This library file link is not valid.');
  const device = listDeviceSources().find(source => source.id === parsed.sourceId);
  if (device) return {url: parsed.path, type: 'local', local: true};
  const saved = savedSourceOf(parsed.sourceId);
  if (!saved) throw new Error('The source of this video was removed.');
  if (saved.kind === 'webdav') {
    const headers = playbackHeaders(saved);
    return {url: parsed.path, type: 'mkv', ...(headers ? {headers} : {})};
  }
  if (saved.kind === 'smb') {
    return {url: await openSmbStream(saved.server, saved.share || '', parsed.path, saved.username, saved.secret), type: 'mkv'};
  }
  throw new Error('This source cannot play library files.');
};
