/**
 * The few WebDAV calls backup sync needs: make the folder, list it, upload,
 * download and delete one file. Works with any WebDAV server (Nextcloud,
 * a NAS, PikPak WebDAV and others).
 */
import {Buffer} from 'buffer';
import {parsePropfind, type RemoteFile} from '../sources/webdav';

export interface WebDavTarget {
  /** Server address, e.g. https://cloud.example.com/remote.php/dav/files/me */
  server: string;
  username: string;
  password: string;
  /** Folder under the server address, e.g. "Droid Stream/Backups". */
  folder: string;
}

const TIMEOUT_MS = 60_000;

export class WebDavError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'WebDavError';
  }
}

const auth = (target: WebDavTarget): Record<string, string> =>
  target.username || target.password
    ? {Authorization: `Basic ${Buffer.from(`${target.username}:${target.password}`).toString('base64')}`}
    : {};

export const folderSegments = (folder: string): string[] =>
  folder
    .split('/')
    .map(part => part.trim())
    .filter(part => part && part !== '.' && part !== '..');

/** The folder's address, ending in "/". */
export const folderUrl = (target: WebDavTarget, segments = folderSegments(target.folder)): string => {
  const base = target.server.trim().replace(/\/+$/, '');
  const path = segments.map(encodeURIComponent).join('/');
  return `${base}/${path ? `${path}/` : ''}`;
};

export const fileUrl = (target: WebDavTarget, name: string): string => `${folderUrl(target)}${encodeURIComponent(name)}`;

export const isUsableServer = (server: string): boolean => /^https?:\/\/[^\s/]+/i.test(server.trim());

const request = async (url: string, init: RequestInit & {headers?: Record<string, string>}): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {...init, signal: controller.signal});
  } catch {
    throw new WebDavError(
      controller.signal.aborted ? 'The WebDAV server did not answer in time' : 'Could not reach the WebDAV server',
    );
  } finally {
    clearTimeout(timer);
  }
};

const fail = (response: Response, what: string): never => {
  if (response.status === 401 || response.status === 403) {
    throw new WebDavError('The WebDAV server refused the user name or password', response.status);
  }
  if (response.status === 507) throw new WebDavError('The WebDAV server is full', response.status);
  throw new WebDavError(`${what} failed (${response.status})`, response.status);
};

/** Makes the folder and its parents. Folders that exist are fine. */
export const ensureFolder = async (target: WebDavTarget): Promise<void> => {
  if (!isUsableServer(target.server)) throw new WebDavError('Enter a WebDAV address that starts with http:// or https://');
  const segments = folderSegments(target.folder);
  for (let index = 1; index <= segments.length; index += 1) {
    const response = await request(folderUrl(target, segments.slice(0, index)), {method: 'MKCOL', headers: auth(target)});
    // 405: it exists. 301/302: some servers redirect an existing folder.
    if (response.ok || response.status === 405 || response.status === 301 || response.status === 302) continue;
    fail(response, 'Making the folder');
  }
};

const PROPFIND_BODY =
  '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>';

export const listFolder = async (target: WebDavTarget): Promise<RemoteFile[]> => {
  const url = folderUrl(target);
  const response = await request(url, {
    method: 'PROPFIND',
    headers: {...auth(target), Depth: '1', 'Content-Type': 'application/xml'},
    body: PROPFIND_BODY,
  });
  if (response.status === 404) return [];
  if (!response.ok) fail(response, 'Listing the folder');
  const self = url.replace(/\/+$/, '');
  return parsePropfind(await response.text(), url).filter(file => file.href.replace(/\/+$/, '') !== self);
};

export const uploadFile = async (target: WebDavTarget, name: string, text: string): Promise<void> => {
  const response = await request(fileUrl(target, name), {
    method: 'PUT',
    headers: {...auth(target), 'Content-Type': 'application/json'},
    body: text,
  });
  if (!response.ok) fail(response, 'Uploading the backup');
};

export const downloadFile = async (target: WebDavTarget, name: string): Promise<string> => {
  const response = await request(fileUrl(target, name), {method: 'GET', headers: auth(target)});
  if (!response.ok) fail(response, 'Downloading the backup');
  return response.text();
};

export const deleteFile = async (target: WebDavTarget, name: string): Promise<void> => {
  const response = await request(fileUrl(target, name), {method: 'DELETE', headers: auth(target)});
  if (!response.ok && response.status !== 404) fail(response, 'Removing an old backup');
};
