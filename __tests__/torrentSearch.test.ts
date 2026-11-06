import {parseNyaaRss} from '../src/lib/torrentSearch/engines/api';
import {customEngine, importAdapters, validateAdapter, exportAdapters} from '../src/lib/torrentSearch/engines/custom';
import {parseTorznab} from '../src/lib/torrentSearch/engines/torznab';
import {applyFilters, dedupe, qualityOf, sortResults, suggestions, titleMatch} from '../src/lib/torrentSearch/rank';
import {searchAll} from '../src/lib/torrentSearch/search';
import {defaultFilters, type TorrentEngine} from '../src/lib/torrentSearch/types';
import {assertNotBlocked, engineErrorText, buildMagnet, formatBytes, infoHashFrom, makeResult, parseDate, parseSize} from '../src/lib/torrentSearch/util';

const HASH = 'a'.repeat(40);
const HASH2 = 'b'.repeat(40);

describe('torrent search utilities', () => {
  it('parses sizes in many formats', () => {
    expect(parseSize('1.5 GB')).toBe(Math.round(1.5 * 1024 ** 3));
    expect(parseSize('700MiB')).toBe(700 * 1024 ** 2);
    expect(parseSize('3,2 GB')).toBe(Math.round(3.2 * 1024 ** 3));
    expect(parseSize('nothing')).toBe(0);
    expect(formatBytes(1024 ** 3)).toBe('1.00 GB');
  });

  it('parses relative and absolute dates', () => {
    const now = Date.UTC(2026, 0, 10);
    expect(parseDate('2 days ago', now)).toBe(now - 2 * 864e5);
    expect(parseDate(1700000000)).toBe(1700000000000);
    expect(parseDate('2024-05-01')).toBe(Date.parse('2024-05-01'));
    expect(parseDate('')).toBe(0);
  });

  it('reads info hashes and builds magnets', () => {
    const magnet = buildMagnet(HASH, 'My File');
    expect(magnet).toContain(`btih:${HASH}`);
    expect(magnet).toContain('dn=My%20File');
    expect(infoHashFrom(magnet)).toBe(HASH);
    expect(infoHashFrom(`hash ${HASH2.toUpperCase()} here`)).toBe(HASH2);
  });

  it('detects release quality', () => {
    expect(qualityOf('Movie.2024.2160p.WEB-DL.DV.HDR.x265').resolution).toBe('2160p');
    expect(qualityOf('Movie 2024 1080p BluRay x264').tags).toEqual(expect.arrayContaining(['BluRay', 'H.264']));
    expect(qualityOf('Movie 2024 HDCAM').lowQuality).toBe(true);
  });
});

describe('blocked page detection', () => {
  it('accepts a normal page that carries the Cloudflare script', () => {
    const html = "<title>ubuntu Torrents</title><table></table><script>var u='/cdn-cgi/challenge-platform/scripts/jsd/main.js';</script>";
    expect(() => assertNotBlocked(html)).not.toThrow();
  });

  it('rejects real browser check pages', () => {
    expect(() => assertNotBlocked('<html><head><title>Just a moment...</title></head></html>')).toThrow('browser check');
    expect(() => assertNotBlocked('<script>window._cf_chl_opt={}</script>')).toThrow('browser check');
  });
});

describe('site error text', () => {
  it('explains blocks, missing sites, and outages', () => {
    expect(engineErrorText('HTTP 403')).toContain('browser check');
    expect(engineErrorText('fetch failed: java.net.UnknownHostException: Unable to resolve host')).toContain('site not found');
    expect(engineErrorText('HTTP 522')).toContain('down');
    expect(engineErrorText('Timed out')).toBe('Timed out');
  });
});

describe('ranking and filters', () => {
  const rows = [
    makeResult({engine: 'a', title: 'Big Buck Bunny 1080p', infoHash: HASH, seeders: 10, sizeBytes: 2e9}),
    makeResult({engine: 'b', title: 'Big Buck Bunny 1080p x265', infoHash: HASH, seeders: 50, sizeBytes: 0}),
    makeResult({engine: 'c', title: 'Other thing 720p CAM', infoHash: HASH2, seeders: 900, sizeBytes: 5e8}),
  ];

  it('merges the same info hash from different sites', () => {
    const merged = dedupe(rows);
    expect(merged).toHaveLength(2);
    const bunny = merged.find(row => row.infoHash === HASH)!;
    expect(bunny.seeders).toBe(50);
    expect(bunny.sizeBytes).toBe(2e9);
    expect(bunny.engines.sort()).toEqual(['a', 'b']);
  });

  it('ranks title matches above raw seeders for relevance', () => {
    const sorted = sortResults(dedupe(rows), 'relevance', 'big buck bunny');
    expect(sorted[0].infoHash).toBe(HASH);
    expect(sortResults(dedupe(rows), 'seeders', '')[0].infoHash).toBe(HASH2);
    expect(titleMatch('big buck', 'Big.Buck.Bunny')).toBe(1);
  });

  it('applies filters', () => {
    const merged = dedupe(rows);
    expect(applyFilters(merged, {...defaultFilters(), qualities: ['720p']})).toHaveLength(1);
    expect(applyFilters(merged, {...defaultFilters(), exclude: 'cam'})).toHaveLength(1);
    expect(applyFilters(merged, {...defaultFilters(), minSeeders: 100})).toHaveLength(1);
    expect(applyFilters(merged, {...defaultFilters(), maxSizeMb: 1000})).toHaveLength(1);
    expect(applyFilters(merged, {...defaultFilters(), within: 'bunny'})).toHaveLength(1);
  });

  it('suggests from history', () => {
    expect(suggestions('dun', ['Dune Part Two', 'Other'])[0]).toBe('Dune Part Two');
    expect(suggestions('', ['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('feed parsers', () => {
  it('reads a Torznab feed from Jackett or Prowlarr', () => {
    const xml = `<rss><channel><item><title>Ubuntu 24.04</title><link>http://jackett/dl/1.torrent</link>
      <size>4000000000</size><pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
      <torznab:attr name="seeders" value="120"/><torznab:attr name="peers" value="150"/>
      <torznab:attr name="infohash" value="${HASH.toUpperCase()}"/><torznab:attr name="category" value="4000"/>
      </item></channel></rss>`;
    const [row] = parseTorznab(xml, 'torznab:x');
    expect(row).toMatchObject({title: 'Ubuntu 24.04', seeders: 120, leechers: 30, infoHash: HASH, category: 'apps', sizeBytes: 4e9});
    expect(() => parseTorznab('<error code="100" description="Invalid API Key"/>', 'x')).toThrow('Invalid API Key');
  });

  it('reads the Nyaa RSS feed', () => {
    const xml = `<rss><channel><item><title>[Group] Show - 01 [1080p].mkv</title><link>https://nyaa.si/download/1.torrent</link>
      <guid>https://nyaa.si/view/1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 -0000</pubDate>
      <nyaa:seeders>42</nyaa:seeders><nyaa:leechers>3</nyaa:leechers><nyaa:infoHash>${HASH}</nyaa:infoHash>
      <nyaa:category>Anime - English-translated</nyaa:category><nyaa:size>1.3 GiB</nyaa:size></item></channel></rss>`;
    const [row] = parseNyaaRss(xml, 'nyaa');
    expect(row).toMatchObject({seeders: 42, leechers: 3, infoHash: HASH, category: 'anime'});
    expect(row.magnet).toContain(HASH);
  });
});

describe('custom site adapters', () => {
  afterEach(() => jest.restoreAllMocks());

  it('validates, exports, and imports adapters', () => {
    expect(() => validateAdapter({name: 'X', searchUrl: 'https://x.test/'})).toThrow('{query}');
    const adapter = validateAdapter({name: 'My Site', searchUrl: 'https://x.test/s/{query}/{page}'});
    expect(adapter.id).toBe('my-site');
    expect(importAdapters(exportAdapters([adapter]))[0].searchUrl).toBe(adapter.searchUrl);
  });

  it('finds magnets on a page in auto mode', async () => {
    const html = `<table><tr><td><a href="/t/1">Cool Linux ISO</a></td><td>2.1 GB</td><td class="seeds">77</td>
      <td><a href="magnet:?xt=urn:btih:${HASH}&dn=Cool">m</a></td></tr></table>`;
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ok: true, status: 200, text: async () => html} as any);
    const engine = customEngine(validateAdapter({name: 'Auto', searchUrl: 'https://x.test/search?q={query}&p={page}'}));
    const rows = await engine.search('cool linux', {category: 'all', page: 1, signal: new AbortController().signal, baseUrl: ''});
    expect(fetchMock.mock.calls[0][0]).toBe('https://x.test/search?q=cool+linux&p=1');
    expect(rows[0]).toMatchObject({title: 'Cool Linux ISO', seeders: 77, infoHash: HASH, sizeBytes: parseSize('2.1 GB')});
    expect(rows[0].detailUrl).toBe('https://x.test/t/1');
  });

  it('reads JSON APIs by field path', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ok: true, status: 200,
      text: async () => JSON.stringify({data: {items: [{name: 'Thing', hash: HASH, bytes: 100, s: 5}]}})} as any);
    const engine = customEngine(validateAdapter({name: 'J', type: 'json', searchUrl: 'https://j.test/api?q={query}',
      json: {list: 'data.items', title: 'name', hash: 'hash', size: 'bytes', seeders: 's'}}));
    const [row] = await engine.search('x', {category: 'all', page: 1, signal: new AbortController().signal, baseUrl: ''});
    expect(row).toMatchObject({title: 'Thing', infoHash: HASH, sizeBytes: 100, seeders: 5});
    expect(row.magnet).toContain(HASH);
  });
});

describe('searchAll', () => {
  const engine = (id: string, impl: () => Promise<any[]>): TorrentEngine => ({
    id, name: id, description: '', categories: ['all'], mirrors: ['https://x.test'], enabledByDefault: true, search: impl,
  });

  it('streams results as sites answer and keeps going when one fails', async () => {
    const updates: number[] = [];
    const run = searchAll('ubuntu', {
      category: 'all',
      engines: [
        engine('ok', async () => [makeResult({engine: 'ok', title: 'Ubuntu', infoHash: HASH, seeders: 3})]),
        engine('dup', async () => [makeResult({engine: 'dup', title: 'Ubuntu ISO', infoHash: HASH, seeders: 9})]),
        engine('bad', async () => { throw new Error('HTTP 503'); }),
      ],
      onUpdate: rows => updates.push(rows.length),
    });
    const rows = await run.promise;
    expect(rows).toHaveLength(1);
    expect(rows[0].seeders).toBe(9);
    expect(rows[0].engines.sort()).toEqual(['dup', 'ok']);
    expect(updates[0]).toBe(0);
  });
});
