import {Buffer} from 'buffer';
import {isSourceAuthStatus, SourceAuthError} from './authErrors';

export interface RemoteFile {
  name: string;
  href: string;
  directory: boolean;
  size?: number;
}

const authHeader = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

export const joinUrl = (base: string, href: string): string => {
  if (/^https?:\/\//i.test(href)) return href.replace(/\/+$/, '');
  const origin = new URL(base);
  const absolute = href.startsWith('/')
    ? `${origin.origin}${href}`
    : new URL(href, base.endsWith('/') ? base : `${base}/`).toString();
  return absolute.replace(/\/+$/, '') || absolute;
};

/** Reads a WebDAV PROPFIND body. Directories are collection responses. */
export const parsePropfind = (xml: string, base: string): RemoteFile[] => {
  const blocks = xml.split(/<D:response|<d:response/i).slice(1);
  const files: Array<RemoteFile | undefined> = blocks.map(block => {
      const href = decodeURIComponent((block.match(/<(?:D|d):href>([^<]+)/) || [])[1] || '');
      if (!href) return undefined;
      const directory = /<(?:D|d):collection\s*\/>/i.test(block);
      const size = Number((block.match(/<(?:D|d):getcontentlength>(\d+)/i) || [])[1]);
      const name = href.replace(/\/+$/, '').split('/').pop() || href;
      return {
        name,
        href: joinUrl(base, href),
        directory,
        size: Number.isFinite(size) ? size : undefined,
      };
    });
  return files.filter((item): item is RemoteFile => Boolean(item?.name));
};

export const listWebDav = async (
  base: string,
  folder: string,
  username: string,
  password: string,
): Promise<RemoteFile[]> => {
  const response = await fetch(folder || base, {
    method: 'PROPFIND',
    headers: {
      Authorization: authHeader(username, password),
      Depth: '1',
      'Content-Type': 'application/xml',
    },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>',
  });
  if (isSourceAuthStatus(response.status)) throw new SourceAuthError('webdav', response.status);
  if (!response.ok) throw new Error(`WebDAV listing failed (${response.status})`);
  const files = parsePropfind(await response.text(), base);
  return files.filter(file => file.href.replace(/\/+$/, '') !== (folder || base).replace(/\/+$/, ''));
};

export const webDavDownloadHeaders = (username: string, password: string, startAt = 0) => ({
  Authorization: authHeader(username, password),
  ...(startAt > 0 ? {Range: `bytes=${startAt}-`} : {}),
});
