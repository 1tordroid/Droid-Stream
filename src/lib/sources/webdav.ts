import {Buffer} from 'buffer';
import {isSourceAuthStatus, SourceAuthError} from './authErrors';

export interface RemoteFile {
  name: string;
  href: string;
  directory: boolean;
  size?: number;
  /** getlastmodified, in ms. */
  modified?: number;
  etag?: string;
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

/** decodeURIComponent that keeps the text as it is when it is not valid percent-encoding. */
export const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const XML_ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
const unescapeXml = (value: string) => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => XML_ENTITIES[name]);

/** Text of the first element with this local name, whatever its namespace prefix (d:, D:, lp1:, none). */
const element = (block: string, name: string): string | undefined => {
  const match = block.match(new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([^<]*)<\\/(?:[\\w.-]+:)?${name}\\s*>`, 'i'));
  return match ? unescapeXml(match[1].trim()) : undefined;
};

/** Reads a WebDAV PROPFIND body. Directories are collection responses. */
export const parsePropfind = (xml: string, base: string): RemoteFile[] => {
  const blocks = xml.split(/<(?:[\w.-]+:)?response[\s>]/i).slice(1);
  const files: Array<RemoteFile | undefined> = blocks.map(block => {
      const href = safeDecode(element(block, 'href') || '');
      if (!href) return undefined;
      const directory = /<(?:[\w.-]+:)?collection\s*\/>|<(?:[\w.-]+:)?collection\s*>/i.test(block);
      const size = Number(element(block, 'getcontentlength'));
      const modified = Date.parse(element(block, 'getlastmodified') || '');
      const etag = element(block, 'getetag');
      const name = href.replace(/\/+$/, '').split('/').pop() || href;
      return {
        name,
        href: joinUrl(base, href),
        directory,
        size: Number.isFinite(size) && element(block, 'getcontentlength') ? size : undefined,
        ...(Number.isFinite(modified) ? {modified} : {}),
        ...(etag ? {etag: etag.replace(/^W\//, '').replace(/"/g, '')} : {}),
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
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>',
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
