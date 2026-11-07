// The free TV guide for World countries: which file each country uses, and
// how guide channels are matched to iptv-org channels whose ids differ.
import {DAY, HOUR} from '../src/lib/livetv/guide';
import {guideBackMs, mergeGuides, planGuideLoads} from '../src/lib/livetv/guideSources';
import {programmesFor} from '../src/lib/livetv/guideLoader';
import {
  AUTO_GUIDE_MAX_BYTES,
  autoGuideCountry,
  autoGuideUrls,
  countriesWithGuide,
  countryGuideFiles,
  guideSiteOf,
  isLowMemoryRam,
  LOW_MEMORY_XML_MB,
  NO_COUNTRY_GUIDE,
} from '../src/lib/livetv/worldGuides';
import {COUNTRIES} from '../src/lib/livetv/countries';
import {channelIdKey, channelNameKeys, normalizeChannelName, parseXmltv} from '../src/lib/livetv/xmltv';

describe('guide file for each country', () => {
  it('uses the best matching free file', () => {
    expect(countryGuideFiles('GB').map(file => file.url)).toEqual(['https://www.open-epg.com/files/unitedkingdom.xml.gz']);
    expect(countryGuideFiles('uk')[0].site).toBe('open-epg');
    expect(countryGuideFiles('IT').map(file => file.url)).toEqual(['https://epgshare01.online/epgshare01/epg_ripper_IT1.xml.gz']);
    expect(countryGuideFiles('IN')[0].url).toBe('https://www.open-epg.com/files/india.xml.gz');
    // A second file only where it fills gaps.
    expect(countryGuideFiles('US')).toHaveLength(2);
  });

  it('has no guide for countries without a free one', () => {
    expect(countryGuideFiles('JP')).toEqual([]);
    expect(countryGuideFiles('RU')).toEqual([]);
    expect(countryGuideFiles('ZZ')).toEqual([]);
    expect(countryGuideFiles(undefined)).toEqual([]);
    expect(NO_COUNTRY_GUIDE).toBe('No guide available for this country.');
  });

  it('keeps to one small file on devices with little memory', () => {
    expect(isLowMemoryRam(2048)).toBe(true);
    expect(isLowMemoryRam(1536)).toBe(true);
    expect(isLowMemoryRam(4096)).toBe(false);
    expect(countryGuideFiles('US', {lowMemory: true})).toHaveLength(1);
    // The Czech first file is large; the smaller second one is used instead.
    expect(countryGuideFiles('CZ', {lowMemory: true}).map(file => file.url)).toEqual(['https://www.open-epg.com/files/czech1.xml.gz']);
    // Only large files: no guide rather than a slow one.
    expect(countryGuideFiles('LU', {lowMemory: true})).toEqual([]);
  });

  it('lists only real countries, with files that fit the size limits', () => {
    const codes = new Set(COUNTRIES.map(country => country.code));
    for (const code of countriesWithGuide()) {
      expect(codes.has(code)).toBe(true);
      const files = countryGuideFiles(code);
      expect(files.length).toBeGreaterThan(0);
      expect(files.length).toBeLessThanOrEqual(2);
      for (const file of files) {
        expect(file.url).toMatch(/^https:\/\/(www\.open-epg\.com\/files\/|epgshare01\.online\/epgshare01\/epg_ripper_)[A-Za-z0-9]+\.xml\.gz$/);
        expect(file.gzKB * 1024).toBeLessThan(AUTO_GUIDE_MAX_BYTES);
        expect(guideSiteOf(file.url)).toBe(file.site);
      }
      if (files[1]) expect(files[1].xmlMB).toBeLessThanOrEqual(LOW_MEMORY_XML_MB * 2);
    }
    expect(countriesWithGuide().length).toBeGreaterThan(60);
  });

  it('picks the country of each source', () => {
    expect(autoGuideCountry('world:gb')).toBe('GB');
    expect(autoGuideCountry('world:fr')).toBe('FR');
    // Free Indian channels fill their guide from India's file; the channels do not change.
    expect(autoGuideCountry('iptv-org')).toBe('IN');
    expect(autoGuideCountry('world:all')).toBeUndefined();
    expect(autoGuideCountry('world:all', 'DE')).toBe('DE');
    // JioTV, the JioTV Go server and your own playlists keep their own guides.
    expect(autoGuideCountry('jio')).toBeUndefined();
    expect(autoGuideCountry('jiotv')).toBeUndefined();
    expect(autoGuideCountry('pl-abc')).toBeUndefined();
    expect(autoGuideUrls('world:de')).toEqual(['https://www.open-epg.com/files/germany.xml.gz']);
    expect(autoGuideUrls('world:all', {country: 'GB'})).toEqual(['https://www.open-epg.com/files/unitedkingdom.xml.gz']);
    expect(autoGuideUrls('world:all')).toEqual([]);
    expect(autoGuideUrls('jio')).toEqual([]);
    expect(guideSiteOf('https://example.com/guide.xml')).toBeUndefined();
  });
});

describe('matching guide channels to iptv-org channels', () => {
  it('reads ids as names', () => {
    expect(channelIdKey('BBCOne.uk@SD')).toBe('bbcone');
    expect(channelIdKey('BBC.One.HD.uk')).toBe('bbcone');
    expect(channelIdKey('5USA +1.uk')).toBe(channelIdKey('5USAPlus1.uk@SD').replace('plus', ''));
    expect(channelIdKey('Das Erste.de')).toBe('daserste');
    expect(channelNameKeys({name: 'BBC One (1080p) [Geo-blocked]', tvgId: 'BBCOne.uk@SD'})).toEqual(['bbcone1080pgeoblocked', 'bbcone']);
    expect(channelNameKeys({name: 'Alpha', tvgName: 'Alpha TV'})).toEqual(['alphatv', 'alpha']);
  });

  const now = Date.UTC(2026, 10, 7, 12);
  const stamp = (time: number) => new Date(time).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
  const programme = (channel: string, title: string) =>
    `<programme start="${stamp(now - HOUR)}" stop="${stamp(now + HOUR)}" channel="${channel}"><title>${title}</title></programme>`;
  const XML = `<tv>
    <channel id="BBC.One.HD.uk"><display-name>BBC One HD</display-name></channel>
    <channel id="ITV1.uk"><display-name>ITV</display-name></channel>
    <channel id="Film4.uk"><display-name>Film 4</display-name></channel>
    ${programme('BBC.One.HD.uk', 'News at One')}${programme('ITV1.uk', 'Loose Women')}${programme('Film4.uk', 'A Film')}
  </tv>`;

  it('finds programmes for channels whose ids are not the guide ids', () => {
    const channels = [
      {sourceId: 'world:gb', url: 'https://s/1', name: 'BBC One (1080p)', tvgId: 'BBCOne.uk@SD'},
      {sourceId: 'world:gb', url: 'https://s/2', name: 'ITV1 [Geo-blocked]', tvgId: 'ITV1.uk@SD'},
      {sourceId: 'world:gb', url: 'https://s/3', name: 'Other', tvgId: 'Other.uk@SD'},
    ];
    const [load] = planGuideLoads(channels, () => countryGuideFiles('GB').map(file => file.url), normalizeChannelName);
    const guide = parseXmltv(XML, {from: now - DAY, to: now + DAY, ids: new Set(load.ids), names: new Set(load.names)});
    // Film 4 is not in the playlist, so it is not kept.
    expect(Object.keys(guide.programmes).sort()).toEqual(['BBC.One.HD.uk', 'ITV1.uk']);
    expect(programmesFor(guide, channels[0], normalizeChannelName)?.[0].title).toBe('News at One');
    expect(programmesFor(guide, channels[1], normalizeChannelName)?.[0].title).toBe('Loose Women');
    expect(programmesFor(guide, channels[2], normalizeChannelName)).toBeUndefined();
  });

  it('loads every guide of a source and merges them, first file first', () => {
    const channels = [
      {sourceId: 'world:us', url: 'https://s/1', name: 'One'},
      {sourceId: 'world:all', url: 'https://s/2', name: 'Two', countries: ['DE', 'AT']},
      {sourceId: 'world:all', url: 'https://s/3', name: 'Three', countries: ['GB']},
    ];
    const loads = planGuideLoads(
      channels,
      (id, channel) => autoGuideUrls(id, {country: channel.countries?.[0]}),
      normalizeChannelName,
      channel => (channel.countries ? `${channel.sourceId}|${channel.countries[0]}` : channel.sourceId),
    );
    expect(loads.map(load => [load.url.replace(/^.*\//, ''), load.sourceIds])).toEqual([
      ['unitedstates9.xml.gz', ['world:us']],
      ['unitedstates7.xml.gz', ['world:us']],
      ['germany.xml.gz', ['world:all|DE']],
      ['unitedkingdom.xml.gz', ['world:all|GB']],
    ]);
    const first = {programmes: {a: [{start: 1, stop: 2, title: 'First'}]}, names: {one: 'a'}};
    const second = {programmes: {a: [{start: 1, stop: 2, title: 'Second'}], b: [{start: 1, stop: 2, title: 'Gap'}]}, names: {one: 'b', two: 'b'}};
    expect(mergeGuides(first, second)).toEqual({
      programmes: {a: [{start: 1, stop: 2, title: 'First'}], b: [{start: 1, stop: 2, title: 'Gap'}]},
      names: {one: 'a', two: 'b'},
    });
    expect(mergeGuides(undefined, second)).toBe(second);
  });

  it('keeps two hours back unless a channel has catch-up', () => {
    expect(guideBackMs([{url: 'https://s/1'}])).toBe(2 * HOUR);
    expect(guideBackMs([{url: 'https://s/1', attrs: {catchup: 'shift', 'catchup-days': '3'}}])).toBe(3 * DAY);
    expect(guideBackMs([{url: 'https://s/1', attrs: {catchup: 'shift', 'catchup-days': '14'}}])).toBe(7 * DAY);
  });
});
