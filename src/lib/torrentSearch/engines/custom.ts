/**
 * User-defined site adapters. Anyone can point Droid Stream at a site that is
 * not built in: a URL template plus how to read the page. Adapters are plain
 * JSON, so they can be shared and imported.
 */
import * as cheerio from 'cheerio';
import type {TorrentCategory, TorrentEngine, TorrentResult} from '../types';
import {
  absoluteUrl,
  assertNotBlocked,
  buildMagnet,
  fetchText,
  guessCategory,
  infoHashFrom,
  makeResult,
  parseCount,
  parseDate,
  parseSize,
} from '../util';
import {parseTorznab} from './torznab';
import {scrapeMagnetCards} from './html';

export type AdapterType = 'auto' | 'selectors' | 'json' | 'rss';

export interface AdapterSelectors {
  /** Each result row, e.g. "table tbody tr". */
  row: string;
  title: string;
  /** Detail page link; defaults to the title element's href. */
  link?: string;
  magnet?: string;
  torrent?: string;
  size?: string;
  seeders?: string;
  leechers?: string;
  date?: string;
}

export interface AdapterJsonPaths {
  /** Dot path to the result array, empty when the response is the array. */
  list: string;
  title: string;
  magnet?: string;
  hash?: string;
  torrent?: string;
  link?: string;
  size?: string;
  seeders?: string;
  leechers?: string;
  date?: string;
}

export interface SiteAdapter {
  id: string;
  name: string;
  /** Use {query} and {page}; optional {category}. */
  searchUrl: string;
  trendingUrl?: string;
  type: AdapterType;
  /** How spaces are written in {query}. */
  spaces?: '+' | '%20' | '-' | '_';
  /** Number used for the first page. */
  firstPage?: number;
  /** Category values substituted for {category}. */
  categoryMap?: Partial<Record<TorrentCategory, string>>;
  selectors?: AdapterSelectors;
  json?: AdapterJsonPaths;
  /** Open each result's page to find the magnet. */
  detailMagnet?: boolean;
  headers?: Record<string, string>;
  description?: string;
  categories?: TorrentCategory[];
}

const get = (value: any, path?: string): any => {
  if (!path) return value;
  return path.split('.').reduce((current, key) => (current == null ? undefined : current[key]), value);
};

const fillUrl = (template: string, adapter: SiteAdapter, query: string, page: number, category: TorrentCategory): string => {
  const spaces = adapter.spaces || '+';
  const encoded = encodeURIComponent(query.trim()).replace(/%20/g, spaces === '%20' ? '%20' : spaces);
  const pageNumber = page - 1 + (adapter.firstPage ?? 1);
  return template
    .replace(/\{query\}/g, encoded)
    .replace(/\{page\}/g, String(pageNumber))
    .replace(/\{category\}/g, adapter.categoryMap?.[category] ?? adapter.categoryMap?.all ?? '');
};

const origin = (url: string): string => url.match(/^https?:\/\/[^/]+/i)?.[0] || url;

const readSelectors = (html: string, adapter: SiteAdapter, base: string): TorrentResult[] => {
  const $ = cheerio.load(html);
  const s = adapter.selectors!;
  const rows: TorrentResult[] = [];
  $(s.row).each((_, row) => {
    const titleEl = $(row).find(s.title).first();
    const title = titleEl.attr('title')?.trim() || titleEl.text().trim();
    if (!title) return;
    const magnet = s.magnet ? $(row).find(s.magnet).attr('href') : $(row).find('a[href^="magnet:"]').attr('href');
    const href = (s.link ? $(row).find(s.link).attr('href') : titleEl.attr('href') || titleEl.find('a').attr('href')) || '';
    rows.push(
      makeResult({
        engine: `custom:${adapter.id}`,
        title,
        magnet,
        torrentUrl: s.torrent ? absoluteUrl(base, $(row).find(s.torrent).attr('href') || '') || undefined : undefined,
        detailUrl: href ? absoluteUrl(base, href) : undefined,
        sizeBytes: parseSize(s.size ? $(row).find(s.size).text() : $(row).text()),
        seeders: parseCount(s.seeders ? $(row).find(s.seeders).text() : ''),
        leechers: parseCount(s.leechers ? $(row).find(s.leechers).text() : ''),
        uploadedAt: parseDate(s.date ? $(row).find(s.date).text().trim() : ''),
        category: guessCategory('', title),
      }),
    );
  });
  return rows;
};

const readJson = (text: string, adapter: SiteAdapter): TorrentResult[] => {
  const data = JSON.parse(text);
  const p = adapter.json!;
  const list = get(data, p.list);
  return (Array.isArray(list) ? list : []).map((item: any) => {
    const title = String(get(item, p.title) ?? '');
    const hash = p.hash ? String(get(item, p.hash) || '').toLowerCase() : undefined;
    const magnet = (p.magnet && get(item, p.magnet)) || (hash ? buildMagnet(hash, title) : undefined);
    const size = get(item, p.size);
    return makeResult({
      engine: `custom:${adapter.id}`,
      title,
      magnet,
      infoHash: hash || infoHashFrom(magnet),
      torrentUrl: p.torrent ? get(item, p.torrent) : undefined,
      detailUrl: p.link ? get(item, p.link) : undefined,
      sizeBytes: typeof size === 'number' ? size : Number(size) || parseSize(size),
      seeders: parseCount(get(item, p.seeders)),
      leechers: parseCount(get(item, p.leechers)),
      uploadedAt: parseDate(get(item, p.date)),
      category: guessCategory('', title),
    });
  });
};

export const customEngine = (adapter: SiteAdapter): TorrentEngine => {
  const id = `custom:${adapter.id}`;
  const run = async (template: string, query: string, page: number, category: TorrentCategory, signal: AbortSignal) => {
    const url = fillUrl(template, adapter, query, page, category);
    const text = await fetchText(url, signal, {headers: adapter.headers});
    const base = origin(url);
    if (adapter.type === 'json') return readJson(text, adapter);
    if (adapter.type === 'rss') return parseTorznab(text, id);
    assertNotBlocked(text);
    if (adapter.type === 'selectors' && adapter.selectors?.row) return readSelectors(text, adapter, base);
    const $ = cheerio.load(text);
    const cards = scrapeMagnetCards($, id, base);
    if (cards.length || !adapter.selectors?.row) return cards;
    return readSelectors(text, adapter, base);
  };
  return {
    id,
    name: adapter.name,
    description: adapter.description || 'Your custom site adapter',
    categories: adapter.categories?.length ? adapter.categories : ['all'],
    mirrors: [origin(adapter.searchUrl)],
    enabledByDefault: true,
    lazyMagnet: adapter.detailMagnet,
    search: (query, {page, category, signal}) => run(adapter.searchUrl, query, page, category, signal),
    trending: adapter.trendingUrl
      ? ({page, category, signal}) => run(adapter.trendingUrl!, '', page, category, signal)
      : undefined,
    resolve: async (result, {signal}) => {
      if (result.magnet || !result.detailUrl) return result;
      const html = await fetchText(result.detailUrl, signal);
      const magnet = html.match(/magnet:\?xt=urn:btih:[^"'<\s]+/i)?.[0]?.replace(/&amp;/g, '&');
      const hash = infoHashFrom(magnet) || infoHashFrom(html.match(/\b[a-f0-9]{40}\b/i)?.[0]);
      if (!hash) throw new Error('No magnet on the page');
      return {...result, magnet: magnet || buildMagnet(hash, result.title), infoHash: hash, id: hash};
    },
  };
};

/** Checks and normalizes an adapter typed or imported by the user. */
export const validateAdapter = (input: any): SiteAdapter => {
  if (!input || typeof input !== 'object') throw new Error('Adapter must be a JSON object');
  const name = String(input.name || '').trim();
  const searchUrl = String(input.searchUrl || '').trim();
  if (!name) throw new Error('Give the adapter a name');
  if (!/^https?:\/\//i.test(searchUrl)) throw new Error('searchUrl must start with http:// or https://');
  if (!searchUrl.includes('{query}')) throw new Error('searchUrl needs a {query} placeholder');
  const type: AdapterType = ['auto', 'selectors', 'json', 'rss'].includes(input.type) ? input.type : 'auto';
  if (type === 'json' && !input.json?.title) throw new Error('JSON adapters need json.title (and usually json.list)');
  if (type === 'selectors' && (!input.selectors?.row || !input.selectors?.title)) throw new Error('Selector adapters need selectors.row and selectors.title');
  return {
    ...input,
    id: String(input.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 40),
    name,
    searchUrl,
    type,
  };
};

export const exportAdapters = (adapters: SiteAdapter[]): string => JSON.stringify({droidStreamAdapters: 1, adapters}, null, 2);

/** Accepts one adapter, an array, or an export file. */
export const importAdapters = (text: string): SiteAdapter[] => {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.adapters) ? parsed.adapters : [parsed];
  return list.map(validateAdapter);
};

/**
 * Extra sites that are not built in. They are off until a user adds them from
 * "Add more sites", and each one can be edited like any custom adapter.
 */
export const ADAPTER_CATALOG: SiteAdapter[] = [
  {id: 'bt4g', name: 'BT4G', type: 'rss', searchUrl: 'https://bt4gprx.com/search?q={query}&page=rss&orderby=seeders&p={page}', description: 'DHT index with an RSS feed'},
  {id: 'rargb', name: 'RARBG mirror (rargb)', type: 'auto', detailMagnet: true, searchUrl: 'https://rargb.to/search/{page}/?search={query}&order=seeders&by=DESC', description: 'Community mirror in the old RARBG style',
    selectors: {row: 'table.lista2t tr.lista2', title: 'td:nth-child(2) a', size: 'td:nth-child(5)', seeders: 'td:nth-child(6)', leechers: 'td:nth-child(7)', date: 'td:nth-child(4)'}},
  {id: 'glodls', name: 'GloTorrents', type: 'auto', searchUrl: 'https://glodls.to/search_results.php?search={query}&sort=seeders&order=desc&page={page}', firstPage: 0, description: 'General index'},
  {id: 'torrentdownloads', name: 'TorrentDownloads', type: 'auto', detailMagnet: true, searchUrl: 'https://www.torrentdownloads.pro/search/?search={query}&page={page}', description: 'General index',
    selectors: {row: 'div.grey_bar3', title: 'p a[href*="/torrent/"]', size: 'span:nth-of-type(3)', seeders: 'span:nth-of-type(2)', leechers: 'span:nth-of-type(1)'}},
  {id: 'yourbittorrent', name: 'YourBittorrent', type: 'auto', detailMagnet: true, searchUrl: 'https://yourbittorrent.com/?q={query}&page={page}', description: 'General index',
    selectors: {row: 'table tr.table-default', title: 'td a[href^="/torrent/"]', size: 'td:nth-child(3)', seeders: 'td:nth-child(5)', leechers: 'td:nth-child(6)', date: 'td:nth-child(4)'}},
  {id: 'uindex', name: 'Uindex', type: 'auto', searchUrl: 'https://uindex.org/search.php?search={query}&c=0&sort=seeders&order=DESC', description: 'Magnet-first index'},
  {id: 'btdig', name: 'BTDigg', type: 'auto', searchUrl: 'https://btdig.com/search?q={query}&p={page}&order=0', firstPage: 0, description: 'DHT search engine'},
  {id: 'torrentproject', name: 'TorrentProject', type: 'auto', detailMagnet: true, searchUrl: 'https://torrentproject.cc/?t={query}&p={page}&orderby=seeders', firstPage: 0, description: 'DHT index',
    selectors: {row: 'div.nav > div', title: 'span a', size: 'span:nth-child(5)', seeders: 'span:nth-child(2)', leechers: 'span:nth-child(3)'}},
  {id: 'rutor', name: 'RuTor', type: 'auto', searchUrl: 'http://rutor.info/search/{page}/0/000/2/{query}', firstPage: 0, spaces: '%20', description: 'Russian tracker, many multi-audio releases'},
  {id: 'extratorrent', name: 'ExtraTorrent mirror', type: 'auto', searchUrl: 'https://extratorrent.st/search/?search={query}&page={page}&s_cat=&pp=&srt=seeds&order=desc', description: 'Community mirror'},
  {id: 'ilcorsaronero', name: 'Il Corsaro Nero', type: 'auto', detailMagnet: true, searchUrl: 'https://ilcorsaronero.link/search?q={query}&page={page}&sort=seeders&order=desc', description: 'Italian index',
    selectors: {row: 'table tbody tr', title: 'th a, td a.tab', size: 'td:nth-child(5)', seeders: 'td:nth-child(3)', leechers: 'td:nth-child(4)'}},
  {id: 'tokyotosho', name: 'Tokyo Toshokan', type: 'auto', searchUrl: 'https://www.tokyotosho.info/search.php?terms={query}&page={page}', categories: ['anime'], description: 'Japanese media'},
  {id: 'anirena', name: 'AniRena', type: 'auto', searchUrl: 'https://www.anirena.com/?s={query}', categories: ['anime'], description: 'Anime tracker'},
  {id: 'linuxtracker', name: 'LinuxTracker', type: 'rss', searchUrl: 'https://linuxtracker.org/rss_torrents.php?search={query}', categories: ['apps'], description: 'Linux distributions (legal)'},
  {id: 'academictorrents', name: 'Academic Torrents', type: 'auto', searchUrl: 'https://academictorrents.com/browse.php?search={query}&page={page}', firstPage: 0, categories: ['books', 'other'], description: 'Research datasets and courses (legal)'},
];
