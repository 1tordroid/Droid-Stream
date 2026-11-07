// World channels in Live TV: country detection, the first list, remembered
// choices, the country list, per-country sources and their playlists.
import {NativeModules} from 'react-native';
import {COUNTRIES, flagOf, normalizeCountryCode, searchCountries, worldPlaylistUrl} from '../src/lib/livetv/countries';
import {detectCountry, pickDetectedCountry, resetDetectedCountryForTests} from '../src/lib/livetv/deviceCountry';
import {DEFAULT_FILTERS} from '../src/lib/livetv/filters';
import {
  getChannelFilters,
  IPTV_ORG_INDIA_URL,
  listSources,
  loadPlaylist,
  NO_FREE_CHANNELS,
  PLAYLIST_MAX_AGE_MS,
  readCachedPlaylist,
  setChannelFilters,
  worldChannelCounts,
} from '../src/lib/livetv/store';
import {
  findSource,
  getSavedLiveView,
  getWorldCountry,
  initialLiveView,
  listRecentCountries,
  pickCountry,
  saveLiveView,
  worldChipCountry,
  worldCountryOf,
  worldSource,
  worldSourceId,
} from '../src/lib/livetv/world';
import {PROFILE_LIVETV_KEYS} from '../src/lib/profiles/profileData';
import {resetActiveProfileCacheForTests, saveActiveProfileId} from '../src/lib/profiles/scope';
import {openStore} from '../src/lib/storage/openStore';

const live = () => openStore('droid-stream-livetv');
const useProfile = (id: string) => {
  saveActiveProfileId(id);
  resetActiveProfileCacheForTests();
};
const clearLive = () => {
  for (const key of live().getAllKeys?.() || []) live().removeItem(key);
};

afterEach(() => {
  useProfile('default');
  clearLive();
  delete (NativeModules as any).VegaDeviceMemory;
  resetDetectedCountryForTests();
});

describe('country detection', () => {
  it('uses the SIM, then the network, then the language region', () => {
    expect(pickDetectedCountry({simCountry: 'gb', networkCountry: 'fr', localeCountry: 'us'})).toMatchObject({code: 'GB', name: 'United Kingdom', from: 'sim'});
    expect(pickDetectedCountry({simCountry: '', networkCountry: 'fr', localeCountry: 'us'})).toMatchObject({code: 'FR', from: 'network'});
    expect(pickDetectedCountry({simCountry: 'zz', networkCountry: '', localeCountry: 'de'})).toMatchObject({code: 'DE', from: 'locale'});
    expect(pickDetectedCountry({simCountry: '', networkCountry: '', localeCountry: ''})).toBeUndefined();
    expect(pickDetectedCountry(undefined)).toBeUndefined();
  });

  it('reads the hints from the native module once, without the network', () => {
    const fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;
    (NativeModules as any).VegaDeviceMemory = {getConstants: () => ({heapLimitMB: 512, simCountry: '', networkCountry: 'br', localeCountry: 'us'})};
    expect(detectCountry()).toMatchObject({code: 'BR', from: 'network'});
    (NativeModules as any).VegaDeviceMemory = {getConstants: () => ({simCountry: 'jp'})};
    expect(detectCountry()?.code).toBe('BR');
    resetDetectedCountryForTests();
    (NativeModules as any).VegaDeviceMemory = {getConstants: () => ({}), getCountryHints: () => ({simCountry: 'jp', networkCountry: '', localeCountry: ''})};
    expect(detectCountry()).toMatchObject({code: 'JP', from: 'sim'});
    resetDetectedCountryForTests();
    delete (NativeModules as any).VegaDeviceMemory;
    expect(detectCountry()).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('first list and remembered choice', () => {
  const base = {saved: undefined, validIds: ['favourites', 'recent', 'jio', 'iptv-org'], hasFavourites: false};

  it('opens Free Indian channels for India or no country, and the World list for others', () => {
    expect(initialLiveView({...base, detected: 'IN'})).toBe('iptv-org');
    expect(initialLiveView({...base, detected: undefined})).toBe('iptv-org');
    expect(initialLiveView({...base, detected: 'GB'})).toBe('world:gb');
    expect(initialLiveView({...base, detected: 'us'})).toBe('world:us');
    // Favourites still come first, as before.
    expect(initialLiveView({...base, hasFavourites: true, detected: 'GB'})).toBe('favourites');
  });

  it('keeps a saved choice while it still exists', () => {
    expect(initialLiveView({...base, saved: 'recent', detected: 'GB'})).toBe('recent');
    expect(initialLiveView({...base, saved: 'world:fr', detected: 'IN'})).toBe('world:fr');
    expect(initialLiveView({...base, saved: 'iptv-org', hasFavourites: true, detected: 'GB'})).toBe('iptv-org');
    // A removed playlist or a bad id falls back.
    expect(initialLiveView({...base, saved: 'pl-gone', detected: 'GB'})).toBe('world:gb');
    expect(initialLiveView({...base, saved: 'world:in', detected: undefined})).toBe('iptv-org');
    expect(initialLiveView({...base, saved: 'world:zz', detected: undefined})).toBe('iptv-org');
  });

  it('remembers the choice per profile', () => {
    expect(getSavedLiveView()).toBeUndefined();
    saveLiveView('world:fr');
    expect(getSavedLiveView()).toBe('world:fr');
    useProfile('kid1');
    expect(getSavedLiveView()).toBeUndefined();
    saveLiveView('recent');
    expect(pickCountry('JP')).toBe('world:jp');
    expect(live().getString('p.kid1.liveView')).toBe('"recent"');
    useProfile('default');
    expect(getSavedLiveView()).toBe('world:fr');
    expect(getWorldCountry()).toBeUndefined();
    expect(PROFILE_LIVETV_KEYS).toEqual(expect.arrayContaining(['liveView', 'liveCountry', 'liveCountries']));
  });

  it('keeps picked countries; India opens the existing source', () => {
    expect(pickCountry('fr')).toBe('world:fr');
    expect(pickCountry('UK')).toBe('world:gb');
    expect(pickCountry('IN')).toBe('iptv-org');
    expect(pickCountry('nope')).toBeUndefined();
    expect(getWorldCountry()).toBe('GB');
    expect(listRecentCountries()).toEqual(['IN', 'GB', 'FR']);
    for (const code of ['DE', 'ES', 'IT', 'PT']) pickCountry(code);
    expect(listRecentCountries()).toEqual(['PT', 'IT', 'ES', 'DE', 'IN']);
  });

  it('opens the World chip on the picked country, else a detected one that is not India', () => {
    expect(worldChipCountry('IN')).toBeUndefined();
    expect(worldChipCountry(undefined)).toBeUndefined();
    expect(worldChipCountry('CA')).toBe('CA');
    pickCountry('MX');
    expect(worldChipCountry('CA')).toBe('MX');
  });
});

describe('country list', () => {
  it('has every iptv-org country with a flag', () => {
    expect(COUNTRIES.length).toBeGreaterThan(240);
    expect(new Set(COUNTRIES.map(c => c.code)).size).toBe(COUNTRIES.length);
    expect(COUNTRIES.every(c => /^[A-Z]{2}$/.test(c.code) && c.name)).toBe(true);
    expect(flagOf('GB')).toBe('🇬🇧');
    expect(flagOf('in')).toBe('🇮🇳');
    expect(normalizeCountryCode(' uk ')).toBe('GB');
  });

  it('pins the detected country, then recent picks, then the rest by name', () => {
    const list = searchCountries('', {detected: 'GB', recent: ['FR', 'GB', 'DE']});
    expect(list.slice(0, 4).map(c => c.code)).toEqual(['GB', 'FR', 'DE', 'AF']);
    expect(list).toHaveLength(COUNTRIES.length);
    expect(searchCountries('').slice(0, 2).map(c => c.name)).toEqual(['Afghanistan', 'Aland']);
  });

  it('searches names and codes, ignoring case and accents', () => {
    expect(searchCountries('kingdom').map(c => c.code)).toEqual(['GB']);
    expect(searchCountries('UK')[0].code).toBe('GB');
    expect(searchCountries('de', {detected: 'FR'}).map(c => c.code)).toContain('DE');
    expect(searchCountries('de', {detected: 'FR'}).map(c => c.code)).not.toContain('FR');
    expect(searchCountries('barthelemy').map(c => c.code)).toEqual(['BL']);
    expect(searchCountries('zzzz')).toEqual([]);
  });
});

describe('World sources', () => {
  const M3U = '#EXTM3U\n#EXTINF:-1 tvg-id="bbc.uk",BBC (1080p)\nhttp://x/bbc.m3u8\n#EXTINF:-1 tvg-id="itv.uk",ITV (576p)\nhttp://x/itv.m3u8\n';
  const ok = (text: string) => ({ok: true, status: 200, text: async () => text}) as any;

  it('gives each country its own source id and iptv-org playlist', () => {
    expect(worldSourceId('gb')).toBe('world:gb');
    expect(worldSourceId('IN')).toBe('iptv-org');
    expect(worldSourceId('xx')).toBeUndefined();
    expect(worldCountryOf('world:gb')).toBe('GB');
    expect(worldCountryOf('world:in')).toBeUndefined();
    expect(worldCountryOf('iptv-org')).toBeUndefined();
    expect(worldSource('GB')).toEqual({id: 'world:gb', kind: 'world', name: 'World: United Kingdom', url: 'https://iptv-org.github.io/iptv/countries/uk.m3u'});
    expect(worldPlaylistUrl('DE')).toBe('https://iptv-org.github.io/iptv/countries/de.m3u');
    expect(worldSource('IN')).toBeUndefined();
    expect(findSource('world:fr')?.url).toBe('https://iptv-org.github.io/iptv/countries/fr.m3u');
    expect(findSource('iptv-org')?.name).toBe('Free Indian channels');
    expect(findSource('world:in')).toBeUndefined();
  });

  it('keeps filters per country', () => {
    setChannelFilters('world:gb', {...DEFAULT_FILTERS, resolution: '1080', languages: ['English']});
    expect(getChannelFilters('world:gb')).toEqual({...DEFAULT_FILTERS, resolution: '1080', languages: ['English']});
    expect(getChannelFilters('world:fr')).toEqual(DEFAULT_FILTERS);
    expect(getChannelFilters('iptv-org')).toEqual(DEFAULT_FILTERS);
    setChannelFilters('world:gb', DEFAULT_FILTERS);
  });

  it('caches a country playlist and keeps its channel count', async () => {
    const source = worldSource('GB')!;
    const fetcher = jest.fn().mockResolvedValue(ok(M3U));
    const first = await loadPlaylist(source, {fetcher});
    expect(fetcher).toHaveBeenCalledWith('https://iptv-org.github.io/iptv/countries/uk.m3u', expect.anything());
    expect(first.playlist.channels.map(c => c.name)).toEqual(['BBC (1080p)', 'ITV (576p)']);
    expect(worldChannelCounts()['world:gb']).toBe(2);
    await loadPlaylist(source, {fetcher});
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Offline after the cache went stale: the cached list still shows.
    const stale = JSON.parse(live().getString('cache:world:gb')!);
    live().setString('cache:world:gb', JSON.stringify({...stale, fetchedAt: Date.now() - PLAYLIST_MAX_AGE_MS - 1}));
    const offline = await loadPlaylist(source, {fetcher: jest.fn().mockRejectedValue(new Error('offline'))});
    expect(offline.playlist.channels).toHaveLength(2);
  });

  it('says so when a country has no free channels', async () => {
    const notFound = jest.fn().mockResolvedValue({ok: false, status: 404, text: async () => ''});
    await expect(loadPlaylist(worldSource('AQ')!, {fetcher: notFound})).rejects.toThrow(NO_FREE_CHANNELS);
    expect(worldChannelCounts()['world:aq']).toBe(0);
    await expect(loadPlaylist(worldSource('BV')!, {fetcher: jest.fn().mockResolvedValue(ok('#EXTM3U\n'))})).rejects.toThrow(NO_FREE_CHANNELS);
    await expect(loadPlaylist(worldSource('FR')!, {fetcher: jest.fn().mockRejectedValue(new Error('offline'))})).rejects.toThrow('Check your connection');
  });

  it('keeps only the newest country playlists cached', async () => {
    const fetcher = jest.fn().mockResolvedValue(ok(M3U));
    const codes = ['FR', 'DE', 'ES', 'IT', 'PT', 'NL', 'BE'];
    for (const code of codes) await loadPlaylist(worldSource(code)!, {fetcher});
    expect(readCachedPlaylist(worldSource('FR')!)).toBeUndefined();
    expect(readCachedPlaylist(worldSource('DE')!)).toBeDefined();
    expect(readCachedPlaylist(worldSource('BE')!)).toBeDefined();
    expect(worldChannelCounts()['world:fr']).toBe(2);
  });

  it('leaves the Free Indian channels source as it was', async () => {
    expect(IPTV_ORG_INDIA_URL).toBe('https://iptv-org.github.io/iptv/countries/in.m3u');
    expect(listSources()[0]).toEqual({id: 'iptv-org', kind: 'iptv-org', name: 'Free Indian channels', url: IPTV_ORG_INDIA_URL});
    expect(listSources().some(s => s.kind === 'world')).toBe(false);
    const notFound = jest.fn().mockResolvedValue({ok: false, status: 404, text: async () => ''});
    await expect(loadPlaylist(listSources()[0], {fetcher: notFound})).rejects.toThrow('The playlist server answered 404.');
    await expect(loadPlaylist(listSources()[0], {fetcher: jest.fn().mockResolvedValue(ok('#EXTM3U\n'))})).rejects.toThrow('No channels found in this playlist.');
    expect(worldChannelCounts()).toEqual({});
  });
});
