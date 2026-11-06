/** Jackett, Prowlarr, or any Torznab endpoint the user adds. */
import type {TorrentCategory, TorrentEngine, TorrentResult} from '../types';
import {decodeEntities, fetchText, guessCategory, infoHashFrom, makeResult, parseCount, parseDate} from '../util';

export interface TorznabInstance {
  id: string;
  name: string;
  /** e.g. http://192.168.1.10:9117/api/v2.0/indexers/all/results/torznab */
  url: string;
  apiKey: string;
}

const TORZNAB_CATEGORY: Partial<Record<TorrentCategory, string>> = {
  movies: '2000',
  tv: '5000',
  anime: '5070',
  music: '3000',
  games: '1000,4050',
  apps: '4000',
  books: '7000',
};

const categoryFromCode = (code: number): TorrentCategory => {
  if (code === 5070) return 'anime';
  if (code >= 2000 && code < 3000) return 'movies';
  if (code >= 5000 && code < 6000) return 'tv';
  if (code >= 3000 && code < 4000) return 'music';
  if (code >= 1000 && code < 2000) return 'games';
  if (code === 4050) return 'games';
  if (code >= 4000 && code < 5000) return 'apps';
  if (code >= 7000 && code < 8000) return 'books';
  return 'other';
};

const attr = (item: string, name: string): string | undefined =>
  item.match(new RegExp(`<(?:torznab|newznab):attr[^>]*name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i'))?.[1];

const tag = (item: string, name: string): string | undefined => {
  const match = item.match(new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, 'i'));
  return match ? decodeEntities(match[1].trim()) : undefined;
};

export const parseTorznab = (xml: string, engine: string): TorrentResult[] => {
  const error = xml.match(/<error[^>]*description=["']([^"']+)["']/i)?.[1];
  if (error) throw new Error(error);
  return xml
    .split(/<item\b/i)
    .slice(1)
    .map(item => {
      const title = tag(item, 'title') || '';
      const magnetAttr = attr(item, 'magneturl');
      const link = tag(item, 'link') || item.match(/<enclosure[^>]*url=["']([^"']+)["']/i)?.[1];
      const magnet = magnetAttr || (link?.startsWith('magnet:') ? link : undefined);
      const hash = attr(item, 'infohash')?.toLowerCase() || infoHashFrom(magnet);
      const seeders = parseCount(attr(item, 'seeders'));
      const peers = parseCount(attr(item, 'peers'));
      const code = Number(attr(item, 'category') || tag(item, 'category')?.match(/\d+/)?.[0] || 0);
      return makeResult({
        engine,
        title,
        magnet: magnet ? decodeEntities(magnet) : undefined,
        infoHash: hash,
        torrentUrl: link && !link.startsWith('magnet:') ? decodeEntities(link) : undefined,
        detailUrl: tag(item, 'comments') || tag(item, 'guid'),
        sizeBytes: Number(tag(item, 'size') || attr(item, 'size')) || 0,
        seeders,
        leechers: Math.max(0, peers - seeders),
        uploadedAt: parseDate(tag(item, 'pubDate')),
        category: code ? categoryFromCode(code) : guessCategory(tag(item, 'category'), title),
        uploader: tag(item, 'jackettindexer') || tag(item, 'prowlarrindexer') || undefined,
        imdbId: attr(item, 'imdbid') ? `tt${attr(item, 'imdbid')!.replace(/^tt/, '')}` : undefined,
      });
    })
    .filter(row => row.title);
};

export const torznabEngine = (instance: TorznabInstance): TorrentEngine => ({
  id: `torznab:${instance.id}`,
  name: instance.name || 'Torznab',
  description: 'Your Jackett or Prowlarr server',
  categories: ['all', 'movies', 'tv', 'anime', 'music', 'games', 'apps', 'books'],
  mirrors: [instance.url.replace(/\/+$/, '')],
  enabledByDefault: true,
  async search(query, {signal, baseUrl, category, page}) {
    const cat = TORZNAB_CATEGORY[category];
    const sep = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${sep}t=search&q=${encodeURIComponent(query)}&apikey=${encodeURIComponent(instance.apiKey)}${cat ? `&cat=${cat}` : ''}&offset=${(page - 1) * 100}&limit=100`;
    return parseTorznab(await fetchText(url, signal, {timeoutMs: 30000}), `torznab:${instance.id}`);
  },
});
