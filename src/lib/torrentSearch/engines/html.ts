/** Engines that read a site's HTML pages. Domains change often, so every one has mirrors. */
import * as cheerio from 'cheerio';
import type {TorrentCategory, TorrentEngine, TorrentResult} from '../types';
import {
  absoluteUrl,
  assertNotBlocked,
  stripTags,
  buildMagnet,
  fetchText,
  guessCategory,
  infoHashFrom,
  makeResult,
  parseCount,
  parseDate,
  parseSize,
} from '../util';

type Cheerio = ReturnType<typeof cheerio.load>;

const page$ = async (url: string, signal: AbortSignal): Promise<Cheerio> => {
  const html = await fetchText(url, signal, {headers: {Accept: 'text/html,application/xhtml+xml'}});
  assertNotBlocked(html);
  return cheerio.load(html);
};

const slug = (query: string, joiner = '+'): string =>
  encodeURIComponent(query.trim().replace(/\s+/g, ' ')).replace(/%20/g, joiner);

const magnetName = (magnet: string): string => {
  const dn = magnet.match(/[?&]dn=([^&]+)/i)?.[1];
  try {
    return dn ? decodeURIComponent(dn.replace(/\+/g, ' ')) : '';
  } catch {
    return dn || '';
  }
};

/** Opens a detail page and takes the first magnet link from it. */
const resolveFromDetail = async (result: TorrentResult, signal: AbortSignal): Promise<TorrentResult> => {
  if (result.magnet || !result.detailUrl) return result;
  const html = await fetchText(result.detailUrl, signal, {headers: {Accept: 'text/html'}});
  assertNotBlocked(html);
  const magnet = html.match(/magnet:\?xt=urn:btih:[^"'<\s]+/i)?.[0]?.replace(/&amp;/g, '&');
  const hash = infoHashFrom(magnet) || infoHashFrom(html.match(/(?:info ?hash|hash)[^a-f0-9]{0,80}([a-f0-9]{40})/i)?.[1]);
  if (!magnet && !hash) throw new Error('No magnet on the page');
  return {
    ...result,
    magnet: magnet || buildMagnet(hash!, result.title),
    infoHash: hash || result.infoHash,
    id: hash || result.id,
  };
};

/**
 * Generic reader for pages that put a magnet link inside each result card or
 * row. The title comes from the card's link, or the magnet's dn parameter.
 */
export const scrapeMagnetCards = ($: Cheerio, engine: string, baseUrl: string): TorrentResult[] => {
  const seen = new Set<string>();
  const out: TorrentResult[] = [];
  $('a[href^="magnet:"]').each((_, anchor) => {
    const magnet = $(anchor).attr('href') || '';
    const hash = infoHashFrom(magnet);
    if (!hash || seen.has(hash)) return;
    seen.add(hash);
    const card = $(anchor).closest('tr, li, article, .card, .search-result, .tgxtablerow, .torrent, .item').first();
    const scope = card.length ? card : $(anchor).parent().parent();
    const titleLink = scope
      .find('a[href]')
      .filter((__, el) => !/^magnet:|\.torrent(\?|$)/i.test($(el).attr('href') || '') && $(el).text().trim().length > 3)
      .first();
    const title = titleLink.attr('title')?.trim() || titleLink.text().trim() || magnetName(magnet) || hash;
    // Join cells with spaces so "2.1 GB" and "77" in neighbouring cells stay apart.
    const text = stripTags(scope.html() || '');
    const seeders = scope.find('.seeders, .seeds, .text-success, [title*="eeder"], td.s, font[color="green"]').first().text();
    const leechers = scope.find('.leechers, .leeches, .text-danger, [title*="eecher"], td.l, font[color="#ff0000"], font[color="red"]').first().text();
    out.push(
      makeResult({
        engine,
        title,
        magnet,
        infoHash: hash,
        detailUrl: titleLink.attr('href') ? absoluteUrl(baseUrl, titleLink.attr('href')!) : undefined,
        sizeBytes: parseSize(text),
        seeders: parseCount(seeders) || parseCount(text.match(/seed(?:er)?s?\s*:?\s*([\d,]+)/i)?.[1]),
        leechers: parseCount(leechers) || parseCount(text.match(/leech(?:er)?s?\s*:?\s*([\d,]+)/i)?.[1]),
        uploadedAt: parseDate(text.match(/\d+\s*(?:min|hour|day|week|month|year)s?\s*ago|\d{4}-\d{2}-\d{2}/i)?.[0]),
        category: guessCategory(scope.find('[class*="cat"], .category').first().text(), title),
      }),
    );
  });
  return out;
};

// ---------------------------------------------------------------- 1337x
const X1337_CATEGORY: Partial<Record<TorrentCategory, string>> = {
  movies: 'Movies', tv: 'TV', anime: 'Anime', music: 'Music', games: 'Games', apps: 'Apps', books: 'Other',
};

const parse1337 = ($: Cheerio, engine: string, baseUrl: string): TorrentResult[] => {
  const rows: TorrentResult[] = [];
  $('table.table-list tbody tr').each((_, row) => {
    const link = $(row).find('td.name a').filter((__, a) => /\/torrent\//.test($(a).attr('href') || '')).first();
    if (!link.length) return;
    const sizeCell = $(row).find('td.size').clone();
    sizeCell.find('span').remove();
    const icon = $(row).find('td.name a.icon i, td.name a.icon').attr('class') || '';
    rows.push(
      makeResult({
        engine,
        title: link.text().trim(),
        detailUrl: absoluteUrl(baseUrl, link.attr('href') || ''),
        seeders: parseCount($(row).find('td.seeds').text()),
        leechers: parseCount($(row).find('td.leeches').text()),
        sizeBytes: parseSize(sizeCell.text()),
        uploadedAt: parseDate($(row).find('td.coll-date').text()),
        uploader: $(row).find('td.coll-5 a, td.uploader a').text().trim() || undefined,
        category: guessCategory(icon.replace(/flaticon-/, ''), link.text()),
      }),
    );
  });
  return rows;
};

export const x1337: TorrentEngine = {
  id: '1337x',
  name: '1337x',
  description: 'Large general index; magnet is read from the detail page',
  categories: ['all', 'movies', 'tv', 'anime', 'music', 'games', 'apps', 'other'],
  mirrors: ['https://1337x.to', 'https://1337x.st', 'https://x1337x.ws', 'https://1337xx.to', 'https://1337x.gd'],
  enabledByDefault: true,
  lazyMagnet: true,
  async search(query, {category, page, signal, baseUrl}) {
    const cat = X1337_CATEGORY[category];
    const url = cat
      ? `${baseUrl}/sort-category-search/${slug(query)}/${cat}/seeders/desc/${page}/`
      : `${baseUrl}/sort-search/${slug(query)}/seeders/desc/${page}/`;
    return parse1337(await page$(url, signal), this.id, baseUrl);
  },
  async trending({category, signal, baseUrl}) {
    const cat = {movies: 'movies', tv: 'tv', music: 'music', games: 'games', apps: 'apps', anime: 'anime'}[category as string];
    return parse1337(await page$(`${baseUrl}/trending${cat ? `/w/${cat}` : ''}/`, signal), this.id, baseUrl);
  },
  resolve: (result, {signal}) => resolveFromDetail(result, signal),
};

// ---------------------------------------------------------------- TorrentGalaxy
export const torrentGalaxy: TorrentEngine = {
  id: 'tgx',
  name: 'TorrentGalaxy',
  description: 'Movies, TV, and general releases',
  categories: ['all', 'movies', 'tv', 'anime', 'music', 'games', 'apps', 'books'],
  mirrors: ['https://torrentgalaxy.to', 'https://torrentgalaxy.mx', 'https://tgx.sb'],
  enabledByDefault: false,
  async search(query, {page, signal, baseUrl, category}) {
    const cat = {movies: '&c3=1&c46=1&c45=1&c42=1&c4=1&c1=1', tv: '&c41=1&c5=1&c11=1&c6=1&c7=1', anime: '&c28=1', music: '&c22=1&c26=1&c23=1&c25=1&c24=1', games: '&c10=1&c43=1', apps: '&c20=1&c21=1&c18=1', books: '&c13=1&c12=1&c14=1&c15=1'}[category as string] || '';
    const $ = await page$(`${baseUrl}/torrents.php?search=${slug(query)}${cat}&sort=seeders&order=desc&page=${page - 1}`, signal);
    const out: TorrentResult[] = [];
    $('div.tgxtablerow').each((_, row) => {
      const magnet = $(row).find('a[href^="magnet:"]').attr('href');
      const link = $(row).find('a.txlight').first();
      if (!magnet || !link.length) return;
      const counts = $(row).find('span[title="Seeders/Leechers"] b');
      out.push(
        makeResult({
          engine: this.id,
          title: link.attr('title') || link.text().trim(),
          magnet,
          detailUrl: absoluteUrl(baseUrl, link.attr('href') || ''),
          sizeBytes: parseSize($(row).find('span.badge-secondary').first().text()),
          seeders: parseCount(counts.eq(0).text()),
          leechers: parseCount(counts.eq(1).text()),
          uploadedAt: parseDate($(row).find('div.tgxtablecell').last().text()),
          uploader: $(row).find('span.username').text().trim() || undefined,
          category: guessCategory($(row).find('div.tgxtablecell').first().text(), link.text()),
        }),
      );
    });
    return out.length ? out : scrapeMagnetCards($, this.id, baseUrl);
  },
};

// ---------------------------------------------------------------- LimeTorrents
export const limeTorrents: TorrentEngine = {
  id: 'lime',
  name: 'LimeTorrents',
  description: 'Verified general index',
  categories: ['all', 'movies', 'tv', 'anime', 'music', 'games', 'apps', 'other'],
  mirrors: ['https://www.limetorrents.fun', 'https://limetorrents.info', 'https://www.limetorrents.lol'],
  enabledByDefault: true,
  async search(query, {page, signal, baseUrl, category}) {
    const cat = {movies: 'movies', tv: 'tv', anime: 'anime', music: 'music', games: 'games', apps: 'applications', other: 'other'}[category as string] || 'all';
    const $ = await page$(`${baseUrl}/search/${cat}/${slug(query, '-')}/seeds/${page}/`, signal);
    const out: TorrentResult[] = [];
    $('table.table2 tr').each((_, row) => {
      const links = $(row).find('div.tt-name a');
      if (links.length < 2) return;
      const torrentLink = links.eq(0).attr('href') || '';
      const detail = links.eq(1);
      const hash = infoHashFrom(torrentLink.match(/torrent\/([A-F0-9]{40})/i)?.[1]);
      const title = detail.text().trim();
      const info = $(row).find('td.tdnormal');
      out.push(
        makeResult({
          engine: this.id,
          title,
          infoHash: hash,
          magnet: hash ? buildMagnet(hash, title) : undefined,
          torrentUrl: torrentLink.startsWith('http') ? torrentLink : undefined,
          detailUrl: absoluteUrl(baseUrl, detail.attr('href') || ''),
          uploadedAt: parseDate(info.eq(0).text().split('-')[0]),
          sizeBytes: parseSize(info.eq(1).text()),
          seeders: parseCount($(row).find('td.tdseed').text()),
          leechers: parseCount($(row).find('td.tdleech').text()),
          category: guessCategory(info.eq(0).text().split(' in ')[1], title),
        }),
      );
    });
    return out;
  },
  resolve: (result, {signal}) => resolveFromDetail(result, signal),
};

// ---------------------------------------------------------------- Bitsearch
export const bitsearch: TorrentEngine = {
  id: 'bitsearch',
  name: 'BitSearch',
  description: 'DHT search engine with magnets in results',
  categories: ['all', 'movies', 'tv', 'anime', 'music', 'games', 'apps', 'books'],
  mirrors: ['https://bitsearch.to', 'https://solidtorrents.to'],
  enabledByDefault: true,
  async search(query, {page, signal, baseUrl, category}) {
    const cat = {movies: '&category=1&subcat=2', tv: '&category=1&subcat=3', anime: '&category=1&subcat=4', music: '&category=7', games: '&category=6', apps: '&category=5', books: '&category=3'}[category as string] || '';
    const $ = await page$(`${baseUrl}/search?q=${slug(query)}${cat}&sort=seeders&page=${page}`, signal);
    const out: TorrentResult[] = [];
    $('li.search-result, div.search-result').each((_, card) => {
      const magnet = $(card).find('a[href^="magnet:"]').attr('href');
      const link = $(card).find('h5 a, h3 a, .title a').first();
      if (!magnet) return;
      const stats = $(card).find('.stats div, .stats span');
      const title = link.text().trim() || magnetName(magnet);
      out.push(
        makeResult({
          engine: this.id,
          title,
          magnet,
          torrentUrl: $(card).find('a.dl-torrent, a[href$=".torrent"]').attr('href'),
          detailUrl: link.attr('href') ? absoluteUrl(baseUrl, link.attr('href')!) : undefined,
          sizeBytes: parseSize(stats.eq(1).text()) || parseSize($(card).text()),
          seeders: parseCount(stats.eq(2).text()),
          leechers: parseCount(stats.eq(3).text()),
          uploadedAt: parseDate(stats.eq(4).text()),
          category: guessCategory($(card).find('.category, .subcategory').text(), title),
        }),
      );
    });
    return out.length ? out : scrapeMagnetCards($, this.id, baseUrl);
  },
};

// ---------------------------------------------------------------- EZTV
export const eztv: TorrentEngine = {
  id: 'eztv',
  name: 'EZTV',
  description: 'TV episodes',
  categories: ['tv'],
  mirrors: ['https://eztvx.to', 'https://eztv.re', 'https://eztv.wf'],
  enabledByDefault: true,
  async search(query, {signal, baseUrl, page}) {
    if (page > 1) return [];
    const $ = await page$(`${baseUrl}/search/${slug(query, '-')}`, signal);
    return parseEztv($, this.id, baseUrl);
  },
  async trending({signal, baseUrl}) {
    return parseEztv(await page$(`${baseUrl}/`, signal), this.id, baseUrl);
  },
};

const parseEztv = ($: Cheerio, engine: string, baseUrl: string): TorrentResult[] => {
  const out: TorrentResult[] = [];
  $('tr.forum_header_border').each((_, row) => {
    const magnet = $(row).find('a.magnet, a[href^="magnet:"]').attr('href');
    const link = $(row).find('a.epinfo').first();
    if (!magnet && !link.length) return;
    const cells = $(row).find('td');
    out.push(
      makeResult({
        engine,
        title: link.attr('title')?.replace(/\s*\([\d.]+ ?[KMGT]B\)\s*$/i, '') || link.text().trim() || magnetName(magnet || ''),
        magnet,
        torrentUrl: $(row).find('a.download_1, a[href$=".torrent"]').attr('href'),
        detailUrl: link.attr('href') ? absoluteUrl(baseUrl, link.attr('href')!) : undefined,
        sizeBytes: parseSize(cells.eq(3).text()),
        uploadedAt: parseDate(`${cells.eq(4).text()} ago`.replace(/(\d+)([hdwmy])/gi, (m, n, u) => `${n} ${{h: 'hour', d: 'day', w: 'week', m: 'month', y: 'year'}[u.toLowerCase() as 'h']} `)),
        seeders: parseCount(cells.eq(5).text()),
        category: 'tv',
      }),
    );
  });
  return out;
};

// ---------------------------------------------------------------- MagnetDL
export const magnetDl: TorrentEngine = {
  id: 'magnetdl',
  name: 'MagnetDL',
  description: 'Magnet-only index',
  categories: ['all', 'movies', 'tv', 'music', 'games', 'apps', 'books'],
  mirrors: ['https://www.magnetdl.com'],
  enabledByDefault: false,
  async search(query, {page, signal, baseUrl}) {
    const words = query.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!words) return [];
    const $ = await page$(`${baseUrl}/${words[0]}/${words}/se/desc/${page}/`, signal);
    const out: TorrentResult[] = [];
    $('table.download tbody tr').each((_, row) => {
      const magnet = $(row).find('td.m a[href^="magnet:"]').attr('href');
      const link = $(row).find('td.n a').first();
      if (!magnet) return;
      const cells = $(row).find('td');
      out.push(
        makeResult({
          engine: this.id,
          title: link.attr('title') || link.text().trim() || magnetName(magnet),
          magnet,
          detailUrl: link.attr('href') ? absoluteUrl(baseUrl, link.attr('href')!) : undefined,
          uploadedAt: parseDate(`${cells.eq(2).text()}`),
          category: guessCategory(cells.eq(3).text(), link.text()),
          sizeBytes: parseSize(cells.eq(5).text()),
          seeders: parseCount($(row).find('td.s').text()),
          leechers: parseCount($(row).find('td.l').text()),
        }),
      );
    });
    return out;
  },
};

// ---------------------------------------------------------------- Kickass (clone)
export const kickass: TorrentEngine = {
  id: 'kickass',
  name: 'KickassTorrents',
  description: 'Community-run Kickass clone',
  categories: ['all', 'movies', 'tv', 'anime', 'music', 'games', 'apps', 'books'],
  mirrors: ['https://kickasstorrents.to', 'https://katcr.to', 'https://kickass.sx'],
  enabledByDefault: false,
  lazyMagnet: true,
  async search(query, {page, signal, baseUrl}) {
    const $ = await page$(`${baseUrl}/usearch/${slug(query, '%20')}/${page}/?sortby=seeders&sort=desc`, signal);
    const cards = scrapeMagnetCards($, this.id, baseUrl);
    if (cards.length) return cards;
    const out: TorrentResult[] = [];
    $('table.data tr[id], table.data tr.odd, table.data tr.even').each((_, row) => {
      const link = $(row).find('a.cellMainLink').first();
      if (!link.length) return;
      const cells = $(row).find('td');
      out.push(
        makeResult({
          engine: this.id,
          title: link.text().trim(),
          detailUrl: absoluteUrl(baseUrl, link.attr('href') || ''),
          sizeBytes: parseSize(cells.eq(1).text()),
          uploadedAt: parseDate(cells.eq(3).text()),
          seeders: parseCount(cells.eq(4).text()),
          leechers: parseCount(cells.eq(5).text()),
          category: guessCategory('', link.text()),
        }),
      );
    });
    return out;
  },
  resolve: (result, {signal}) => resolveFromDetail(result, signal),
};

// ---------------------------------------------------------------- TorLock
export const torlock: TorrentEngine = {
  id: 'torlock',
  name: 'TorLock',
  description: 'Verified torrents only',
  categories: ['all', 'movies', 'tv', 'anime', 'music', 'games', 'apps', 'books'],
  mirrors: ['https://www.torlock.com'],
  enabledByDefault: false,
  lazyMagnet: true,
  async search(query, {page, signal, baseUrl, category}) {
    const cat = {movies: 'movie', tv: 'television', anime: 'anime', music: 'music', games: 'game', apps: 'software', books: 'ebook'}[category as string] || 'all';
    const $ = await page$(`${baseUrl}/${cat}/torrents/${slug(query, '-')}.html?sort=seeds&page=${page}`, signal);
    const out: TorrentResult[] = [];
    $('table tr').each((_, row) => {
      const link = $(row).find('td a[href^="/torrent/"]').first();
      if (!link.length) return;
      const cells = $(row).find('td');
      out.push(
        makeResult({
          engine: this.id,
          title: link.text().trim(),
          detailUrl: absoluteUrl(baseUrl, link.attr('href') || ''),
          uploadedAt: parseDate(cells.eq(1).text()),
          sizeBytes: parseSize(cells.eq(2).text()),
          seeders: parseCount($(row).find('td.tul').text() || cells.eq(3).text()),
          leechers: parseCount($(row).find('td.tdl').text() || cells.eq(4).text()),
          category: guessCategory('', link.text()),
        }),
      );
    });
    return out;
  },
  resolve: (result, {signal}) => resolveFromDetail(result, signal),
};
