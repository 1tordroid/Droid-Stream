/**
 * eD2k links:
 *   ed2k://|file|NAME|SIZE|MD4HASH|[h=AICH|][p=PART:PART:...|]/[|sources,HOST:PORT,...|/]
 *   ed2k://|server|HOST|PORT|/
 *   ed2k://|serverlist|URL-OF-SERVER.MET|/
 */

export interface Ed2kFileLink {
  kind: 'file';
  name: string;
  size: number;
  /** Lowercase hex MD4 file hash. */
  hash: string;
  /** AICH root hash (base32), kept for reference; parts are checked with MD4. */
  aich?: string;
  /** Lowercase hex MD4 part hashes, when the link carries them. */
  partHashes?: string[];
  /** HOST:PORT peers given in the link. */
  sources: string[];
}

export interface Ed2kServerLink {
  kind: 'server';
  host: string;
  port: number;
}

export interface Ed2kServerListLink {
  kind: 'serverlist';
  url: string;
}

export type Ed2kLink = Ed2kFileLink | Ed2kServerLink | Ed2kServerListLink;

/** Largest file eD2k supports (256 GiB). */
const MAX_FILE_SIZE = 2 ** 38;
const HASH = /^[0-9a-f]{32}$/i;
const HOST = /^[a-z0-9.-]+$/i;

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const validPort = (value: number): boolean =>
  Number.isInteger(value) && value > 0 && value < 65536;

const parseEndpoint = (value: string): string | undefined => {
  const match = value.trim().match(/^([^:\s]+):(\d{1,5})$/);
  if (!match || !HOST.test(match[1]) || !validPort(Number(match[2]))) {
    return undefined;
  }
  return `${match[1]}:${Number(match[2])}`;
};

export const isEd2kLink = (value: string): boolean =>
  /^ed2k:\/\/(\||%7c)/i.test(value.trim());

/**
 * Browsers and chat apps sometimes percent-encode every separator. Only then
 * are encoded bars turned back, so a "|" encoded inside a name stays there.
 */
export const normalizeEd2kLink = (value: string): string => {
  const text = value.trim();
  return /^ed2k:\/\/%7c/i.test(text) ? text.replace(/%7c/gi, '|') : text;
};

/** Reads an eD2k link, or returns null when it is not a valid one. */
export const parseEd2kLink = (value: string): Ed2kLink | null => {
  if (!isEd2kLink(value)) {
    return null;
  }
  const text = normalizeEd2kLink(value);
  const body = text.slice('ed2k://'.length);
  const segments = body.split('|/');
  const main = segments[0].split('|').slice(1);
  const type = main[0]?.toLowerCase();

  if (type === 'server') {
    const host = main[1]?.trim() || '';
    const port = Number(main[2]);
    return HOST.test(host) && validPort(port)
      ? {kind: 'server', host, port}
      : null;
  }

  if (type === 'serverlist') {
    const url = decode(main.slice(1).join('|').trim());
    return /^https?:\/\/\S+$/i.test(url) ? {kind: 'serverlist', url} : null;
  }

  if (type !== 'file') {
    return null;
  }
  const name = decode(main[1] || '').trim();
  const sizeText = main[2] || '';
  const hash = (main[3] || '').toLowerCase();
  const size = Number(sizeText);
  if (
    !name ||
    !/^\d+$/.test(sizeText) ||
    !(size > 0) ||
    size > MAX_FILE_SIZE ||
    !HASH.test(hash)
  ) {
    return null;
  }
  const link: Ed2kFileLink = {kind: 'file', name, size, hash, sources: []};
  for (const field of main.slice(4)) {
    if (/^h=/i.test(field)) {
      const aich = field.slice(2).toUpperCase();
      if (/^[A-Z2-7]{32}$/.test(aich)) link.aich = aich;
    } else if (/^p=/i.test(field)) {
      const parts = field.slice(2).toLowerCase().split(':');
      if (parts.length > 0 && parts.every(part => HASH.test(part))) {
        link.partHashes = parts;
      }
    }
  }
  for (const segment of segments.slice(1)) {
    const extra = segment.replace(/^\|/, '');
    if (/^sources,/i.test(extra)) {
      for (const item of extra.slice('sources,'.length).split(',')) {
        const endpoint = parseEndpoint(item);
        if (endpoint && !link.sources.includes(endpoint)) {
          link.sources.push(endpoint);
        }
      }
    }
  }
  return link;
};

/** eD2k links inside a block of text, such as a copied forum post. */
export const ed2kLinksIn = (text: string): string[] =>
  Array.from(
    text.matchAll(
      /ed2k:\/\/(?:\||%7c)(?:file|server|serverlist)(?:\||%7c)[^\n"'<>]*?(?:\||%7c)\/(?:(?:\||%7c)sources,[^\s|"'<>]*(?:\||%7c)\/)?/gi,
    ),
  ).map(match => match[0]);

export const ed2kFileLink = (file: {name: string; size: number; hash: string}): string =>
  `ed2k://|file|${encodeURIComponent(file.name)}|${file.size}|${file.hash.toLowerCase()}|/`;
