jest.mock('../src/lib/sources/vault', () => ({readPikPakAccount: () => undefined}));
jest.mock('../src/lib/jsPlugins', () => ({readPlugins: () => [], runPlugin: jest.fn()}));
import {defaultPrefs, fromPlugin, fromStremio, pickEpisodeFile, rankCandidates, scoreCandidate, searchQueryFor, type Candidate} from '../src/lib/streams/finder';
import {normalizeAddonUrl, supports, videoId} from '../src/lib/stremio';
import {guessWatchMeta} from '../src/lib/watchMeta';
import {dominantTitle} from '../src/lib/torrentSearch/identify';
import {makeResult} from '../src/lib/torrentSearch/util';

const HASH = 'e'.repeat(40);

describe('Stremio protocol helpers', () => {
  it('normalizes add-on URLs', () => {
    expect(normalizeAddonUrl('stremio://torrentio.strem.fun/abc/manifest.json')).toBe('https://torrentio.strem.fun/abc');
    expect(normalizeAddonUrl('https://x.test/manifest.json')).toBe('https://x.test');
    expect(() => normalizeAddonUrl('ftp://x')).toThrow();
  });

  it('checks resources, types, and id prefixes', () => {
    const manifest = {id: 'a', name: 'A', types: ['movie', 'series'], idPrefixes: ['tt'], resources: ['stream', {name: 'subtitles', types: ['movie']}]};
    expect(supports(manifest, 'stream', 'series', 'tt1:1:2')).toBe(true);
    expect(supports(manifest, 'stream', 'movie', 'kitsu:1')).toBe(false);
    expect(supports(manifest, 'subtitles', 'series', 'tt1')).toBe(false);
    expect(videoId('tt1', 2, 3)).toBe('tt1:2:3');
  });

  it('reads Torrentio-style streams', () => {
    const torrent = fromStremio({name: 'Torrentio\n1080p', title: 'Show.S01E02.1080p.WEB.x265\n👤 152 💾 1.4 GB ⚙️ ThePirateBay', infoHash: HASH.toUpperCase(), fileIdx: 3, sources: ['tracker:udp://t.test:1/announce']}, 'Torrentio')!;
    expect(torrent).toMatchObject({kind: 'torrent', infoHash: HASH, fileIdx: 3, seeders: 152, resolution: '1080p', origin: 'Torrentio · ThePirateBay'});
    expect(torrent.magnet).toContain('t.test');
    const direct = fromStremio({name: '[RD+] Torrentio\n4k', title: 'Movie 2160p\n💾 20 GB', url: 'https://rd.test/x.mkv'}, 'Torrentio')!;
    expect(direct).toMatchObject({kind: 'direct', debridDirect: true, resolution: '2160p'});
  });
});

describe('ranking', () => {
  const base: Candidate = {id: '1', kind: 'torrent', title: 'x', origin: 'o', sizeBytes: 1e9, seeders: 100, cachedOn: [], lowQuality: false, languages: [], resolution: '1080p', infoHash: HASH};

  it('puts debrid-ready and cached sources first, then healthy torrents at the preferred quality', () => {
    const prefs = defaultPrefs();
    const ranked = rankCandidates([
      {...base, id: 'healthy', infoHash: 'a'.repeat(40), seeders: 900},
      {...base, id: 'cached', infoHash: 'b'.repeat(40), seeders: 3, cachedOn: ['torbox']},
      {...base, id: 'ready', kind: 'direct', url: 'https://x', debridDirect: true, infoHash: undefined},
      {...base, id: 'cam', infoHash: 'c'.repeat(40), seeders: 5000, lowQuality: true},
      {...base, id: 'dead', infoHash: 'd'.repeat(40), seeders: 0},
    ], prefs);
    expect(ranked[0].id).toBe('ready');
    expect(ranked[1].id).toBe('cached');
    expect(ranked[2].id).toBe('healthy');
    expect(ranked[ranked.length - 1].id).toBe('cam');
    expect(scoreCandidate({...base, resolution: '2160p'}, prefs)).toBeLessThan(scoreCandidate(base, prefs));
  });

  it('picks the episode file in a season pack', () => {
    const files = [{name: 'Show.S01E01.mkv', size: 5}, {name: 'Show.S01E02.mkv', size: 4}, {name: 'sample.mkv', size: 9}];
    expect(pickEpisodeFile(files, {season: 1, episode: 2})?.name).toBe('Show.S01E02.mkv');
    expect(pickEpisodeFile(files)?.name).toBe('Show.S01E01.mkv');
    expect(searchQueryFor({title: 'Show', type: 'series', season: 1, episode: 2})).toBe('Show S01E02');
  });
});

describe('identity', () => {
  it('guesses what is playing from provider titles', () => {
    expect(guessWatchMeta({primaryTitle: 'Frieren', secondaryTitle: 'Season 1', episodeTitle: 'Episode 7'})).toMatchObject({type: 'series', season: 1, episode: 7});
    expect(guessWatchMeta({primaryTitle: 'Show', episodeTitle: 'S02E05 - Name'})).toMatchObject({season: 2, episode: 5});
    expect(guessWatchMeta({primaryTitle: 'Inception', type: 'movie', episodeTitle: 'Inception 1080p'})).toMatchObject({type: 'movie'});
  });

  it('finds the title most search results agree on', () => {
    const rows = ['Dune.Part.Two.2024.1080p', 'Dune Part Two 2024 2160p', 'Dune.Part.Two.2024.720p', 'Other 2020'].map((title, index) => makeResult({engine: 'x', title, seeders: 50, infoHash: String(index).repeat(40)}));
    expect(dominantTitle(rows)).toMatchObject({title: 'Dune Part Two', year: 2024, type: 'movie'});
  });
});

describe('script plugin streams', () => {
  it('maps a direct stream', () => {
    const candidate = fromPlugin({title: 'Movie 1080p', url: 'https://a.test/v.mp4', size: '1.5 GB', headers: {Referer: 'https://a.test'}}, 'Plugin');
    expect(candidate).toMatchObject({kind: 'direct', url: 'https://a.test/v.mp4', origin: 'Plugin', resolution: '1080p', headers: {Referer: 'https://a.test'}});
    expect(candidate.sizeBytes).toBeGreaterThan(0);
  });

  it('maps a magnet to a torrent and reads 4K', () => {
    const candidate = fromPlugin({name: 'Plugin', quality: '4K', url: `magnet:?xt=urn:btih:${HASH}`}, 'Plugin');
    expect(candidate).toMatchObject({kind: 'torrent', infoHash: HASH, resolution: '2160p'});
    expect(candidate.url).toBeUndefined();
  });
});
