/** Engines backed by public JSON or RSS APIs. */
import type {TorrentCategory, TorrentEngine, TorrentResult} from '../types';
import {
  buildMagnet,
  decodeEntities,
  fetchJson,
  fetchText,
  guessCategory,
  infoHashFrom,
  makeResult,
  parseCount,
  parseDate,
  parseSize,
} from '../util';

const enc = encodeURIComponent;

// ---------------------------------------------------------------- apibay (TPB)
const TPB_CATEGORY: Partial<Record<TorrentCategory, string>> = {
  movies: '201,202,207,209,211',
  tv: '205,208,212',
  music: '100',
  games: '400',
  apps: '300',
  books: '601',
  other: '600',
};

const tpbCategory = (code: string | number): TorrentCategory => {
  const n = Number(code);
  if ([201, 202, 207, 209, 211].includes(n)) return 'movies';
  if ([205, 208, 212].includes(n)) return 'tv';
  if (n >= 100 && n < 200) return 'music';
  if (n >= 300 && n < 400) return 'apps';
  if (n >= 400 && n < 500) return 'games';
  if (n === 601 || n === 102) return 'books';
  if (n >= 200 && n < 300) return 'movies';
  return 'other';
};

const mapTpb = (rows: any[], engine: string): TorrentResult[] =>
  (Array.isArray(rows) ? rows : [])
    .filter(row => row && row.info_hash && !/^0+$/.test(row.info_hash) && row.id !== '0')
    .map(row =>
      makeResult({
        engine,
        title: row.name,
        infoHash: String(row.info_hash).toLowerCase(),
        magnet: buildMagnet(String(row.info_hash).toLowerCase(), row.name),
        sizeBytes: Number(row.size) || 0,
        seeders: parseCount(row.seeders),
        leechers: parseCount(row.leechers),
        uploadedAt: parseDate(Number(row.added)),
        category: tpbCategory(row.category),
        uploader: row.username,
        files: Number(row.num_files) || undefined,
        imdbId: row.imdb || undefined,
        detailUrl: `https://thepiratebay.org/description.php?id=${row.id}`,
      }),
    );

export const apibay: TorrentEngine = {
  id: 'tpb',
  name: 'The Pirate Bay',
  description: 'General index through the apibay JSON API',
  categories: ['all', 'movies', 'tv', 'music', 'games', 'apps', 'books', 'other'],
  mirrors: ['https://apibay.org'],
  enabledByDefault: true,
  async search(query, {category, signal, baseUrl, page}) {
    if (page > 1) return [];
    const cat = TPB_CATEGORY[category] ?? '';
    const rows = await fetchJson<any[]>(`${baseUrl}/q.php?q=${enc(query)}&cat=${cat}`, signal);
    return mapTpb(rows, this.id);
  },
  async trending({category, signal, baseUrl}) {
    const code = {movies: '201', tv: '205', music: '101', games: '400', apps: '300', books: '601'}[category as string];
    const rows = await fetchJson<any[]>(`${baseUrl}/precompiled/data_top100_${code || 'recent'}.json`, signal);
    return mapTpb(rows, this.id);
  },
};

// ---------------------------------------------------------------- YTS
const mapYts = (movies: any[], engine: string, baseUrl: string): TorrentResult[] => {
  const out: TorrentResult[] = [];
  for (const movie of Array.isArray(movies) ? movies : []) {
    for (const torrent of movie.torrents || []) {
      const title = `${movie.title_long || movie.title} [${torrent.quality}] [${torrent.type || 'web'}]${torrent.video_codec ? ` [${torrent.video_codec}]` : ''} YTS`;
      const hash = String(torrent.hash || '').toLowerCase();
      out.push(
        makeResult({
          engine,
          title,
          infoHash: hash || undefined,
          magnet: hash ? buildMagnet(hash, title) : undefined,
          torrentUrl: torrent.url,
          sizeBytes: Number(torrent.size_bytes) || parseSize(torrent.size),
          seeders: parseCount(torrent.seeds),
          leechers: parseCount(torrent.peers),
          uploadedAt: parseDate(Number(torrent.date_uploaded_unix)),
          category: 'movies',
          imdbId: movie.imdb_code,
          poster: movie.medium_cover_image,
          detailUrl: movie.url || `${baseUrl}/movies/${movie.slug}`,
        }),
      );
    }
  }
  return out;
};

export const yts: TorrentEngine = {
  id: 'yts',
  name: 'YTS',
  description: 'Movies in small encodes, with posters',
  categories: ['movies'],
  mirrors: ['https://yts.gg', 'https://movies-api.accel.li', 'https://yts.lt', 'https://yts.am'],
  enabledByDefault: true,
  async search(query, {signal, baseUrl, page}) {
    const data = await fetchJson<any>(`${baseUrl}/api/v2/list_movies.json?query_term=${enc(query)}&limit=50&page=${page}&sort_by=seeds`, signal);
    return mapYts(data?.data?.movies, this.id, baseUrl);
  },
  async trending({signal, baseUrl}) {
    const data = await fetchJson<any>(`${baseUrl}/api/v2/list_movies.json?limit=30&sort_by=download_count`, signal);
    return mapYts(data?.data?.movies, this.id, baseUrl);
  },
};

// ---------------------------------------------------------------- Nyaa (RSS)
const tag = (xml: string, name: string): string | undefined => {
  const match = xml.match(new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, 'i'));
  return match ? decodeEntities(match[1].trim()) : undefined;
};

export const parseNyaaRss = (xml: string, engine: string): TorrentResult[] =>
  xml
    .split(/<item\b/i)
    .slice(1)
    .map(item => {
      const title = tag(item, 'title') || '';
      const hash = tag(item, 'nyaa:infoHash')?.toLowerCase();
      return makeResult({
        engine,
        title,
        infoHash: hash,
        magnet: hash ? buildMagnet(hash, title, ['http://nyaa.tracker.wf:7777/announce', 'udp://open.stealth.si:80/announce', 'udp://tracker.opentrackr.org:1337/announce']) : undefined,
        torrentUrl: tag(item, 'link'),
        detailUrl: tag(item, 'guid'),
        sizeBytes: parseSize(tag(item, 'nyaa:size')),
        seeders: parseCount(tag(item, 'nyaa:seeders')),
        leechers: parseCount(tag(item, 'nyaa:leechers')),
        uploadedAt: parseDate(tag(item, 'pubDate')),
        category: /anime/i.test(tag(item, 'nyaa:category') || 'anime') ? 'anime' : guessCategory(tag(item, 'nyaa:category'), title),
      });
    })
    .filter(row => row.title);

export const nyaa: TorrentEngine = {
  id: 'nyaa',
  name: 'Nyaa',
  description: 'Anime, manga, and Japanese media',
  categories: ['anime', 'books', 'music'],
  mirrors: ['https://nyaa.si', 'https://nyaa.land'],
  enabledByDefault: true,
  async search(query, {signal, baseUrl, page, category}) {
    const cat = category === 'books' ? '3_0' : category === 'music' ? '2_0' : category === 'anime' ? '1_0' : '0_0';
    const xml = await fetchText(`${baseUrl}/?page=rss&q=${enc(query)}&c=${cat}&f=0&p=${page}`, signal);
    return parseNyaaRss(xml, this.id);
  },
  async trending({signal, baseUrl}) {
    const xml = await fetchText(`${baseUrl}/?page=rss&c=1_2&f=0`, signal);
    return parseNyaaRss(xml, this.id);
  },
};

// ---------------------------------------------------------------- AnimeTosho
export const animetosho: TorrentEngine = {
  id: 'animetosho',
  name: 'AnimeTosho',
  description: 'Anime mirror of Nyaa and others, JSON feed',
  categories: ['anime'],
  mirrors: ['https://feed.animetosho.net', 'https://feed.animetosho.xyz'],
  enabledByDefault: true,
  async search(query, {signal, baseUrl, page}) {
    const rows = await fetchJson<any[]>(`${baseUrl}/json?q=${enc(query)}&page=${page}`, signal);
    return (Array.isArray(rows) ? rows : []).map(row =>
      makeResult({
        engine: this.id,
        title: row.title,
        magnet: row.magnet_uri,
        infoHash: row.info_hash ? String(row.info_hash).toLowerCase() : infoHashFrom(row.magnet_uri),
        torrentUrl: row.torrent_url,
        detailUrl: row.link,
        sizeBytes: Number(row.total_size) || 0,
        seeders: parseCount(row.seeders),
        leechers: parseCount(row.leechers),
        uploadedAt: parseDate(Number(row.timestamp)),
        category: 'anime',
      }),
    );
  },
};

// ---------------------------------------------------------------- Knaben (meta)
const KNABEN_CATEGORY: Partial<Record<TorrentCategory, number[]>> = {
  movies: [3000000],
  tv: [2000000],
  anime: [6000000],
  music: [1000000],
  games: [4001000, 4002000, 4003000, 4004000, 4005000],
  apps: [4000000],
  books: [9000000],
};

export const knaben: TorrentEngine = {
  id: 'knaben',
  name: 'Knaben',
  description: 'Meta-search across dozens of public trackers',
  categories: ['all', 'movies', 'tv', 'anime', 'music', 'games', 'apps', 'books'],
  mirrors: ['https://api.knaben.org'],
  enabledByDefault: true,
  async search(query, {signal, baseUrl, page, category}) {
    const body: Record<string, unknown> = {
      search_type: '100%',
      search_field: 'title',
      query,
      order_by: 'seeders',
      order_direction: 'desc',
      from: (page - 1) * 50,
      size: 50,
      hide_unsafe: true,
      hide_xxx: true,
    };
    if (KNABEN_CATEGORY[category]) body.categories = KNABEN_CATEGORY[category];
    const data = await fetchJson<any>(`${baseUrl}/v1`, signal, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    return (data?.hits || []).map((row: any) =>
      makeResult({
        engine: this.id,
        title: row.title,
        magnet: row.magnetUrl || (row.hash ? buildMagnet(String(row.hash).toLowerCase(), row.title) : undefined),
        infoHash: row.hash ? String(row.hash).toLowerCase() : infoHashFrom(row.magnetUrl),
        torrentUrl: row.link && /\.torrent/i.test(row.link) ? row.link : undefined,
        detailUrl: row.details || row.link,
        sizeBytes: Number(row.bytes) || 0,
        seeders: parseCount(row.seeders),
        leechers: parseCount(row.peers),
        uploadedAt: parseDate(row.date),
        category: guessCategory(Array.isArray(row.category) ? row.category.join(' ') : row.category, row.title),
        uploader: row.tracker,
      }),
    );
  },
};

// ---------------------------------------------------------------- Torrents-CSV
export const torrentsCsv: TorrentEngine = {
  id: 'torrentscsv',
  name: 'Torrents-CSV',
  description: 'Open dataset of DHT-seen torrents',
  categories: ['all'],
  mirrors: ['https://torrents-csv.com'],
  enabledByDefault: true,
  async search(query, {signal, baseUrl}) {
    const data = await fetchJson<any>(`${baseUrl}/service/search?q=${enc(query)}&size=50`, signal);
    const rows = Array.isArray(data) ? data : data?.torrents || [];
    return rows.map((row: any) =>
      makeResult({
        engine: this.id,
        title: row.name,
        infoHash: String(row.infohash).toLowerCase(),
        magnet: buildMagnet(String(row.infohash).toLowerCase(), row.name),
        sizeBytes: Number(row.size_bytes) || 0,
        seeders: parseCount(row.seeders),
        leechers: parseCount(row.leechers),
        uploadedAt: parseDate(Number(row.created_unix)),
        category: guessCategory('', row.name),
      }),
    );
  },
};

// ---------------------------------------------------------------- Internet Archive
const ARCHIVE_TYPES: Partial<Record<TorrentCategory, string>> = {
  movies: 'movies',
  tv: 'movies',
  music: 'audio',
  books: 'texts',
  apps: 'software',
  games: 'software',
};

export const internetArchive: TorrentEngine = {
  id: 'archive',
  name: 'Internet Archive',
  description: 'Public-domain and openly licensed media, web seeded',
  categories: ['all', 'movies', 'music', 'books', 'apps', 'games'],
  mirrors: ['https://archive.org'],
  enabledByDefault: true,
  async search(query, {signal, baseUrl, page, category}) {
    const type = ARCHIVE_TYPES[category];
    const q = `(${query})${type ? ` AND mediatype:(${type})` : ' AND mediatype:(movies OR audio OR texts OR software)'}`;
    const url = `${baseUrl}/advancedsearch.php?q=${enc(q)}&fl[]=identifier&fl[]=title&fl[]=item_size&fl[]=downloads&fl[]=publicdate&fl[]=mediatype&rows=40&page=${page}&output=json`;
    const data = await fetchJson<any>(url, signal);
    return (data?.response?.docs || []).map((doc: any) =>
      makeResult({
        engine: this.id,
        title: Array.isArray(doc.title) ? doc.title[0] : doc.title || doc.identifier,
        torrentUrl: `${baseUrl}/download/${doc.identifier}/${doc.identifier}_archive.torrent`,
        detailUrl: `${baseUrl}/details/${doc.identifier}`,
        sizeBytes: Number(doc.item_size) || 0,
        seeders: 0,
        leechers: 0,
        uploadedAt: parseDate(doc.publicdate),
        category: doc.mediatype === 'audio' ? 'music' : doc.mediatype === 'texts' ? 'books' : doc.mediatype === 'software' ? 'apps' : 'movies',
        uploader: `${parseCount(doc.downloads)} downloads · web seed`,
        webSeeded: true,
      }),
    );
  },
};
