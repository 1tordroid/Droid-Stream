import type {TorrentCategory, TorrentResult} from './types';

export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://explodie.org:6969/announce',
];

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  kib: 1024,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
  tb: 1024 ** 4,
  tib: 1024 ** 4,
};

/** "1.4 GB", "700MiB", "3,2 GB" → bytes. Unknown text → 0. */
export const parseSize = (text: string | undefined | null): number => {
  if (!text) return 0;
  const match = String(text).replace(/ /g, ' ').match(/([\d.,]+)\s*([kmgt]i?b|b|bytes)(?![a-z])/i);
  if (!match) return 0;
  const raw = match[1].includes(',') && !match[1].includes('.') ? match[1].replace(',', '.') : match[1].replace(/,/g, '');
  const value = Number(raw);
  const unit = match[2].toLowerCase() === 'bytes' ? 'b' : match[2].toLowerCase();
  return Number.isFinite(value) ? Math.round(value * (UNITS[unit] || 1)) : 0;
};

export const parseCount = (text: string | number | undefined | null): number => {
  if (typeof text === 'number') return Number.isFinite(text) ? text : 0;
  const value = Number(String(text ?? '').replace(/[^\d]/g, ''));
  return Number.isFinite(value) ? value : 0;
};

export const formatBytes = (bytes: number): string => {
  if (!bytes) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`;
};

const AGO = /(\d+)\s*(sec|second|min|minute|hour|hr|day|week|wk|month|mo|year|yr)s?\.?\s*ago/i;
const AGO_MS: Record<string, number> = {
  sec: 1e3, second: 1e3, min: 6e4, minute: 6e4, hour: 36e5, hr: 36e5,
  day: 864e5, week: 6048e5, wk: 6048e5, month: 2592e6, mo: 2592e6, year: 31536e6, yr: 31536e6,
};

/** Parses ISO dates, unix seconds, and "3 days ago" style text. */
export const parseDate = (value: string | number | undefined | null, now = Date.now()): number => {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number' || /^\d{9,13}$/.test(String(value))) {
    const n = Number(value);
    return n < 1e12 ? n * 1000 : n;
  }
  const text = String(value).trim();
  if (/^(today|just now)/i.test(text)) return now;
  if (/^yesterday/i.test(text)) return now - 864e5;
  const ago = text.match(AGO);
  if (ago) return now - Number(ago[1]) * AGO_MS[ago[2].toLowerCase()];
  // "Y-day" and "Today 12:30" forms from TPB style sites
  if (/^y-?day/i.test(text)) return now - 864e5;
  const normalized = text.replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/'(\d{2})\b/, '20$1');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatAge = (ms: number, now = Date.now()): string => {
  if (!ms) return '';
  const diff = Math.max(0, now - ms);
  const day = 864e5;
  if (diff < 36e5) return `${Math.max(1, Math.round(diff / 6e4))}m ago`;
  if (diff < day) return `${Math.round(diff / 36e5)}h ago`;
  if (diff < 30 * day) return `${Math.round(diff / day)}d ago`;
  if (diff < 365 * day) return `${Math.round(diff / (30 * day))}mo ago`;
  return `${Math.round(diff / (365 * day))}y ago`;
};

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'"};

export const decodeEntities = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z0-9#]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);

export const stripTags = (value: string): string =>
  decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Extracts a btih info hash from a magnet link or any text containing one. */
export const infoHashFrom = (value: string | undefined | null): string | undefined => {
  if (!value) return undefined;
  const match = value.match(/urn:btih:([a-z0-9]{40}|[a-z2-7]{32})/i) || value.match(/\b([a-f0-9]{40})\b/i);
  return match ? match[1].toLowerCase() : undefined;
};

export const buildMagnet = (infoHash: string, name: string, trackers: string[] = PUBLIC_TRACKERS): string =>
  `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}${trackers
    .map(tracker => `&tr=${encodeURIComponent(tracker)}`)
    .join('')}`;

export const absoluteUrl = (base: string, href: string): string => {
  if (!href) return '';
  if (/^(https?:|magnet:)/i.test(href)) return href;
  if (href.startsWith('//')) return `https:${href}`;
  return `${base.replace(/\/+$/, '')}/${href.replace(/^\/+/, '')}`;
};

/** Guesses a category from a site's own category label. */
export const guessCategory = (label: string | undefined | null, title = ''): TorrentCategory => {
  const text = `${label || ''}`.toLowerCase();
  if (/anime/.test(text)) return 'anime';
  if (/\b(tv|series|episode|show)/.test(text)) return 'tv';
  if (/movie|film|video/.test(text)) return 'movies';
  if (/music|audio|flac|mp3|album/.test(text)) return 'music';
  if (/game|pc ?games|console/.test(text)) return 'games';
  if (/app|software|application|program|android/.test(text)) return 'apps';
  if (/book|comic|manga|audiobook|ebook/.test(text)) return 'books';
  if (/S\d{1,2}E\d{1,3}|\bseason\b/i.test(title)) return 'tv';
  return text ? 'other' : 'other';
};

export const makeResult = (partial: Partial<TorrentResult> & {title: string; engine: string}): TorrentResult => {
  const infoHash = partial.infoHash || infoHashFrom(partial.magnet);
  const link = partial.magnet || partial.torrentUrl || partial.detailUrl || partial.title;
  return {
    sizeBytes: 0,
    seeders: 0,
    leechers: 0,
    uploadedAt: 0,
    category: 'other',
    ...partial,
    title: partial.title.trim(),
    infoHash,
    id: infoHash || `${partial.engine}:${link}`,
    engines: partial.engines || [partial.engine],
  };
};

/** fetch() with a timeout, a browser user agent, and a readable error. */
export const fetchText = async (
  url: string,
  signal: AbortSignal,
  init: RequestInit & {timeoutMs?: number} = {},
): Promise<string> => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener?.('abort', abort);
  const timer = setTimeout(abort, init.timeoutMs ?? 15000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {'User-Agent': DESKTOP_UA, Accept: '*/*', ...(init.headers as Record<string, string> | undefined)},
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error: any) {
    if (signal.aborted) throw new Error('Cancelled');
    if (error?.name === 'AbortError') throw new Error('Timed out');
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
    signal.removeEventListener?.('abort', abort);
  }
};

export const fetchJson = async <T = any>(url: string, signal: AbortSignal, init: RequestInit & {timeoutMs?: number} = {}): Promise<T> => {
  const text = await fetchText(url, signal, {...init, headers: {Accept: 'application/json', ...(init.headers as any)}});
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('The site did not return JSON (it may be blocked on this network)');
  }
};

/** Detects Cloudflare and similar walls so the UI can say so. */
export const assertNotBlocked = (html: string): void => {
  // Cloudflare also injects a /challenge-platform/ script into normal pages, so
  // that path alone does not mean the page is blocked.
  if (/cf-browser-verification|_cf_chl_opt|<title>\s*Just a moment|Attention Required! \| Cloudflare|ddos-guard/i.test(html)) {
    throw new Error('Blocked by a browser check. Try another mirror or a VPN.');
  }
};
