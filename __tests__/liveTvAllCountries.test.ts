// All countries: iptv-org's combined playlists read in pieces and joined, the
// country filter, the cache, the country list, and India and JioTV as before.
const files: Record<string, Buffer> = {};
const downloads: Record<string, string> = {};
jest.mock('@dr.pogodin/react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  mkdir: jest.fn(async () => undefined),
  exists: jest.fn(async (path: string) => path in files),
  stat: jest.fn(async (path: string) => ({size: files[path].length})),
  read: jest.fn(async (path: string, length: number, position: number) => files[path].subarray(position, position + length).toString('base64')),
  readFile: jest.fn(async (path: string) => files[path].toString('utf8')),
  writeFile: jest.fn(async (path: string, text: string) => {
    files[path] = Buffer.from(text, 'utf8');
  }),
  unlink: jest.fn(async (path: string) => {
    delete files[path];
  }),
  moveFile: jest.fn(async (from: string, to: string) => {
    files[to] = files[from];
    delete files[from];
  }),
  downloadFile: jest.fn(({fromUrl, toFile}: {fromUrl: string; toFile: string}) => {
    const text = downloads[fromUrl];
    if (text !== undefined) files[toFile] = Buffer.from(text, 'utf8');
    return {jobId: 1, promise: Promise.resolve({statusCode: text === undefined ? 404 : 200, bytesWritten: text?.length || 0})};
  }),
}));

import * as RNFS from '@dr.pogodin/react-native-fs';
import {
  allCountryCounts,
  buildAllCountries,
  loadAllCountries,
  peekAllCountries,
  releaseAllCountries,
  resetAllCountriesForTests,
} from '../src/lib/livetv/allCountries';
import {
  ALL_CATEGORIES_PLAYLIST_URL,
  ALL_COUNTRIES,
  ALL_COUNTRIES_PLAYLIST_URL,
  COUNTRIES,
  countryCodeOfName,
  countryLabel,
  countryPickerRows,
  flagOf,
  INTERNATIONAL,
} from '../src/lib/livetv/countries';
import {activeFilterCount, applyFilters, DEFAULT_FILTERS, filterCounts, resetFilters, sanitizeFilters} from '../src/lib/livetv/filters';
import {JIO_SOURCE_ID} from '../src/lib/livetv/jio/channels';
import {
  getChannelFilters,
  IPTV_ORG_INDIA_URL,
  jioEpgUrl,
  jioPlaylistUrl,
  listFavourites,
  listSources,
  setChannelFilters,
  setJioServer,
  toggleFavourite,
} from '../src/lib/livetv/store';
import {
  findSource,
  getWorldCountry,
  initialLiveView,
  isWorldAll,
  listRecentCountries,
  pickCountry,
  WORLD_ALL_ID,
  worldChipCountry,
  worldCountryOf,
  worldSourceId,
} from '../src/lib/livetv/world';
import {openStore} from '../src/lib/storage/openStore';

const live = () => openStore('droid-stream-livetv');

const entry = (id: string, name: string, group: string, url: string, option = '') =>
  `#EXTINF:-1 tvg-id="${id}" tvg-logo="https://logo.example/${id}.png" group-title="${group}",${name}\n${option}${url}\n`;

// Big enough to be read in many 256 KB pieces.
const COUNT = 3000;
const urlOf = (i: number) => `https://stream.example/channel-${i}/index.m3u8`;
const CATEGORIES =
  '#EXTM3U\n' +
  Array.from({length: COUNT}, (_, i) =>
    entry(`Channel${i}.xx@SD`, `Channel ${i} (720p)`, i % 3 ? 'News' : 'Movies;Kids', urlOf(i), i === 7 ? '#EXTVLCOPT:http-user-agent=Agent/1\n' : ''),
  ).join('');
const COUNTRY_NAMES = ['United Kingdom', 'Germany', 'International', 'India', 'Atlantis'];
const BY_COUNTRY =
  '#EXTM3U\n' +
  Array.from({length: COUNT}, (_, i) => entry(`Channel${i}.xx@SD`, `Channel ${i} (720p)`, COUNTRY_NAMES[i % 5], urlOf(i))).join('') +
  // Channel 0 is also listed by Germany (and twice by the UK); one channel only by country.
  entry('Channel0.xx@SD', 'Channel 0 (720p)', 'Germany', urlOf(0)) +
  entry('Channel0.xx@SD', 'Channel 0 (720p)', 'United Kingdom', urlOf(0)) +
  entry('Only.de@SD', 'Only Germany', 'Germany', 'https://stream.example/only.m3u8');

beforeEach(() => {
  for (const key of Object.keys(files)) delete files[key];
  for (const key of live().getAllKeys?.() || []) live().removeItem(key);
  downloads[ALL_CATEGORIES_PLAYLIST_URL] = CATEGORIES;
  downloads[ALL_COUNTRIES_PLAYLIST_URL] = BY_COUNTRY;
  resetAllCountriesForTests();
  jest.clearAllMocks();
});

describe('reading the combined playlists', () => {
  it('joins categories and countries, reading each file in pieces', async () => {
    files['/a.m3u'] = Buffer.from(CATEGORIES, 'utf8');
    files['/b.m3u'] = Buffer.from(BY_COUNTRY, 'utf8');
    expect(files['/a.m3u'].length).toBeGreaterThan(2 * 256 * 1024);
    const channels = await buildAllCountries('/a.m3u', '/b.m3u');
    // Read in 256 KB pieces, not at once.
    expect((RNFS.read as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(channels).toHaveLength(COUNT + 1);
    expect(channels[0]).toEqual({
      id: urlOf(0),
      name: 'Channel 0 (720p)',
      url: urlOf(0),
      logo: 'https://logo.example/Channel0.xx@SD.png',
      group: 'Movies;Kids',
      tvgId: 'Channel0.xx@SD',
      resolution: '720p',
      countries: ['GB', 'DE'],
      sourceId: WORLD_ALL_ID,
    });
    // Only the fields the grid needs: no raw attributes.
    expect('attrs' in channels[0]).toBe(false);
    expect(channels[1].countries).toEqual(['DE']);
    expect(channels[2].countries).toEqual([INTERNATIONAL]);
    expect(channels[3].countries).toEqual(['IN']);
    // An unknown country name is left out.
    expect(channels[4].countries).toEqual([]);
    expect(channels[7].headers).toEqual({'User-Agent': 'Agent/1'});
    expect(channels[COUNT]).toMatchObject({name: 'Only Germany', countries: ['DE']});
    expect(channels[COUNT].group).toBeUndefined();
  });

  it('knows iptv-org country names', () => {
    expect(countryCodeOfName('United Kingdom')).toBe('GB');
    expect(countryCodeOfName('Turkiye')).toBe('TR');
    expect(countryCodeOfName('Curacao')).toBe('CW');
    expect(countryCodeOfName('International')).toBe(INTERNATIONAL);
    expect(countryCodeOfName('Undefined')).toBeUndefined();
    expect(countryLabel(INTERNATIONAL)).toBe('International');
    expect(countryLabel('GB')).toBe('United Kingdom');
    expect(flagOf(INTERNATIONAL)).toBe('🌐');
    expect(flagOf('GB')).toBe('🇬🇧');
  });
});

describe('loading, cache and memory', () => {
  it('downloads once, caches a compact file and reads it back', async () => {
    const first = await loadAllCountries();
    expect(first.channels).toHaveLength(COUNT + 1);
    expect(RNFS.downloadFile).toHaveBeenCalledTimes(2);
    expect(peekAllCountries()).toBe(first);
    // The raw playlists are deleted; the compact cache is smaller than them.
    expect(Object.keys(files).sort()).toEqual(['/cache/livetv-world/all.json']);
    expect(files['/cache/livetv-world/all.json'].length).toBeLessThan(CATEGORIES.length);
    expect(allCountryCounts()).toMatchObject({GB: 600, DE: 602, INT: 600, IN: 600});

    // Released from memory, then read from the cache without a download.
    releaseAllCountries();
    expect(peekAllCountries()).toBeUndefined();
    const again = await loadAllCountries();
    expect(RNFS.downloadFile).toHaveBeenCalledTimes(2);
    expect(again.channels).toEqual(first.channels);
  });

  it('shares one load and keeps an old cache when the download fails', async () => {
    const [one, two] = await Promise.all([loadAllCountries(), loadAllCountries()]);
    expect(one).toBe(two);
    expect(RNFS.downloadFile).toHaveBeenCalledTimes(2);
    delete downloads[ALL_COUNTRIES_PLAYLIST_URL];
    releaseAllCountries();
    const forced = await loadAllCountries({force: true});
    expect(forced.channels).toHaveLength(COUNT + 1);
    resetAllCountriesForTests();
    for (const key of Object.keys(files)) delete files[key];
    await expect(loadAllCountries({force: true})).rejects.toThrow(/answered 404/);
  });
});

describe('filters', () => {
  it('filters by country with counts per country, kept with the other filters', async () => {
    const {channels} = await loadAllCountries();
    const germany = {...DEFAULT_FILTERS, country: 'DE'};
    expect(applyFilters(channels, germany)).toHaveLength(602);
    expect(applyFilters(channels, {...germany, group: 'Kids'}, 'channel 0 ').map(channel => channel.name)).toEqual(['Channel 0 (720p)']);
    const counts = filterCounts(channels, germany);
    expect(counts.allCountries).toBe(COUNT + 1);
    expect(counts.countries.get('GB')).toBe(600);
    expect(counts.countries.get('DE')).toBe(602);
    // Other counts keep the country.
    expect(counts.allGroups).toBe(602);
    expect(counts.groups.get('Kids')).toBe(201);
    expect(activeFilterCount(germany)).toBe(1);
    expect(resetFilters(germany).country).toBeUndefined();
    expect(sanitizeFilters({country: 'DE'}).country).toBe('DE');
    expect(sanitizeFilters({country: 'nope'}).country).toBeUndefined();
    // Other lists have no countries: the counts stay empty.
    expect(filterCounts([{name: 'x'}], DEFAULT_FILTERS).countries.size).toBe(0);
  });

  it('remembers the country filter per profile and keeps favourites', async () => {
    const {channels} = await loadAllCountries();
    setChannelFilters(WORLD_ALL_ID, {...DEFAULT_FILTERS, country: 'GB'});
    expect(getChannelFilters(WORLD_ALL_ID).country).toBe('GB');
    setChannelFilters(WORLD_ALL_ID, DEFAULT_FILTERS);
    expect(getChannelFilters(WORLD_ALL_ID).country).toBeUndefined();
    toggleFavourite(channels[1], WORLD_ALL_ID);
    // Saved with its countries, so its guide can be found later.
    expect(listFavourites()[0]).toMatchObject({sourceId: WORLD_ALL_ID, id: urlOf(1), countries: ['DE']});
  });
});

describe('the Change country list', () => {
  it('reaches every one of the 250 iptv-org countries', () => {
    expect(COUNTRIES).toHaveLength(250);
    expect(new Set(COUNTRIES.map(country => country.code)).size).toBe(250);
    const rows = countryPickerRows('');
    expect(rows).toHaveLength(251);
    expect(rows[0].code).toBe(ALL_COUNTRIES);
    for (const country of COUNTRIES) {
      expect(countryPickerRows(country.name).some(row => row.code === country.code)).toBe(true);
    }
  });

  it('puts All countries after the detected country', () => {
    const rows = countryPickerRows('', {detected: 'FR', recent: ['DE']});
    expect(rows.slice(0, 3).map(row => row.code)).toEqual(['FR', ALL_COUNTRIES, 'DE']);
    expect(countryPickerRows('all').map(row => row.code)[0]).toBe(ALL_COUNTRIES);
    expect(countryPickerRows('germ').map(row => row.code)).toEqual(['DE']);
  });

  it('opens All countries and remembers it per profile', () => {
    expect(pickCountry('ALL')).toBe(WORLD_ALL_ID);
    expect(getWorldCountry()).toBe(ALL_COUNTRIES);
    expect(worldChipCountry('GB')).toBe(ALL_COUNTRIES);
    expect(listRecentCountries()).toEqual([]);
    expect(worldSourceId('all')).toBe(WORLD_ALL_ID);
    expect(isWorldAll(WORLD_ALL_ID)).toBe(true);
    expect(worldCountryOf(WORLD_ALL_ID)).toBeUndefined();
    expect(findSource(WORLD_ALL_ID)).toEqual({id: WORLD_ALL_ID, kind: 'world', name: 'World: All countries', url: ALL_COUNTRIES_PLAYLIST_URL});
    expect(initialLiveView({saved: WORLD_ALL_ID, validIds: [], hasFavourites: false, detected: 'IN'})).toBe(WORLD_ALL_ID);
  });
});

describe('India and JioTV stay as they are', () => {
  it('keeps the Free Indian channels source and JioTV unchanged', () => {
    expect(IPTV_ORG_INDIA_URL).toBe('https://iptv-org.github.io/iptv/countries/in.m3u');
    expect(listSources()).toEqual([{id: 'iptv-org', kind: 'iptv-org', name: 'Free Indian channels', url: IPTV_ORG_INDIA_URL}]);
    expect(worldSourceId('IN')).toBe('iptv-org');
    expect(pickCountry('IN')).toBe('iptv-org');
    expect(JIO_SOURCE_ID).toBe('jio');
    const server = setJioServer('192.168.1.5', 'high')!;
    expect(jioPlaylistUrl(server)).toBe('http://192.168.1.5:5001/playlist.m3u?q=high');
    expect(jioEpgUrl(server)).toBe('http://192.168.1.5:5001/epg.xml.gz');
    expect(listSources().map(source => source.id)).toEqual(['iptv-org', 'jiotv']);
    setJioServer('');
  });
});
