import {
  DEFAULT_FILTERS,
  LANGUAGES,
  UNKNOWN_LANGUAGE,
  activeFilterCount,
  applyFilters,
  channelFacets,
  detectLanguages,
  displayChannelName,
  filterCounts,
  guessLanguages,
  hasFilterChoices,
  normalizeLanguage,
  parseResolution,
  qualityBucket,
  resetFilters,
  sanitizeFilters,
  toggleLanguage,
  type ChannelFilters,
  type FilterableChannel,
} from '../src/lib/livetv/filters';
import {parseM3U} from '../src/lib/livetv/m3u';
import {toLiveChannel} from '../src/lib/livetv/jio/channels';

describe('quality', () => {
  it('reads iptv-org style tags from the name', () => {
    expect(parseResolution('DD National (576p)')).toBe('576p');
    expect(parseResolution('Aaj Tak (720p) [Geo-blocked]')).toBe('720p');
    expect(parseResolution('Sony (1080p) [Not 24/7]')).toBe('1080p');
    expect(parseResolution('Nat Geo (2160p)')).toBe('4K');
    expect(parseResolution('Old Feed (480p)')).toBe('480p');
    expect(parseResolution('Broadcast 1080i')).toBe('1080p');
    expect(parseResolution('Star 4K')).toBe('4K');
    expect(parseResolution('Zee UHD')).toBe('4K');
    expect(parseResolution('Colors FHD')).toBe('1080p');
    expect(parseResolution('Colors HD')).toBe('HD');
    expect(parseResolution('DD News')).toBeUndefined();
    // Numbers that are not a resolution.
    expect(parseResolution('Channel 1080')).toBeUndefined();
    expect(parseResolution('9XM')).toBeUndefined();
    expect(parseResolution('HDFC Money')).toBeUndefined();
  });

  it('reads attributes, the iptv-org feed and the Jio HD flag', () => {
    expect(parseResolution('A', {'tvg-resolution': '1920x1080'})).toBe('1080p');
    expect(parseResolution('A', {resolution: '720'})).toBe('720p');
    expect(parseResolution('A', {quality: 'UHD'})).toBe('4K');
    expect(parseResolution('A', {}, 'DDNational.in@SD')).toBe('SD');
    expect(parseResolution('A', {}, 'Zee.in@HD')).toBe('HD');
    expect(parseResolution('A', {hd: 'true'})).toBe('HD');
    // The name wins over attributes and the feed.
    expect(parseResolution('A (576p)', {resolution: '1080p'}, 'A.in@HD')).toBe('576p');
  });

  it('puts labels into filter buckets', () => {
    expect(qualityBucket('4K')).toBe('4k');
    expect(qualityBucket('8K')).toBe('4k');
    expect(qualityBucket('1440p')).toBe('1080');
    expect(qualityBucket('1080p')).toBe('1080');
    expect(qualityBucket('720p')).toBe('720');
    expect(qualityBucket('HD')).toBe('720');
    expect(qualityBucket('576p')).toBe('sd');
    expect(qualityBucket('360p')).toBe('sd');
    expect(qualityBucket('SD')).toBe('sd');
    expect(qualityBucket(undefined)).toBe('unknown');
  });

  it('hides resolution tags in names and keeps the rest', () => {
    expect(displayChannelName('DD National (576p)')).toBe('DD National');
    expect(displayChannelName('Aaj Tak (720p) [Geo-blocked]')).toBe('Aaj Tak [Geo-blocked]');
    expect(displayChannelName('Star [4K]')).toBe('Star');
    expect(displayChannelName('Colors HD')).toBe('Colors HD');
    expect(displayChannelName('(1080p)')).toBe('(1080p)');
  });

  it('is set on playlist channels while the name stays as it was', () => {
    const {channels} = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="DDNational.in@SD" group-title="General",DD National (576p)
https://e/dd.m3u8
#EXTINF:-1 tvg-id="X.in@HD",X
https://e/x.m3u8
#EXTINF:-1,Plain
https://e/p.m3u8
`);
    expect(channels.map(c => [c.name, c.resolution])).toEqual([
      ['DD National (576p)', '576p'],
      ['X', 'HD'],
      ['Plain', undefined],
    ]);
  });

  it('is set on Jio channels', () => {
    expect(toLiveChannel({channel_id: 1, channel_name: 'Sports HD', isHD: true})?.resolution).toBe('HD');
    expect(toLiveChannel({channel_id: 2, channel_name: 'Comedy', isHD: false})?.resolution).toBe('SD');
    expect(toLiveChannel({channel_id: 3, channel_name: 'Movies'})?.resolution).toBeUndefined();
  });

  it('gives Jio channels their language', () => {
    const jio = toLiveChannel({channel_id: 4, channel_name: 'Sun TV', channelLanguageId: 8, channelCategoryId: 5})!;
    expect(channelFacets(jio).languages).toEqual(['Tamil']);
  });
});

describe('language', () => {
  it('normalizes names and codes', () => {
    expect(normalizeLanguage('hin')).toBe('Hindi');
    expect(normalizeLanguage('TAMIL')).toBe('Tamil');
    expect(normalizeLanguage('bn')).toBe('Bengali');
    expect(normalizeLanguage('Bangla')).toBe('Bengali');
    expect(normalizeLanguage('french')).toBe('French');
    expect(normalizeLanguage('old church')).toBe('Old Church');
    expect(normalizeLanguage(' ')).toBeUndefined();
    expect(normalizeLanguage('undefined')).toBeUndefined();
  });

  it('keeps every guess word in one list', () => {
    const names = LANGUAGES.map(item => item.name);
    for (const name of ['Hindi', 'Tamil', 'Telugu', 'Bengali', 'Marathi', 'Kannada', 'Malayalam', 'Punjabi', 'Gujarati', 'English']) {
      expect(names).toContain(name);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('guesses from whole words only', () => {
    expect(guessLanguages('Tamil Movies')).toEqual(['Tamil']);
    expect(guessLanguages('hindi;english')).toEqual(['Hindi', 'English']);
    expect(guessLanguages('Zee Bangla')).toEqual(['Bengali']);
    expect(guessLanguages('Tamilnadu Live')).toEqual([]);
    expect(guessLanguages(undefined)).toEqual([]);
  });

  it('uses tvg-language first, then Jio, then groups, then the name', () => {
    expect(detectLanguages({name: 'Zee Tamil', group: 'Hindi', attrs: {'tvg-language': 'Telugu;English'}})).toEqual(['Telugu', 'English']);
    expect(detectLanguages({name: 'Colors', attrs: {language: 'Kannada'}})).toEqual(['Kannada']);
    expect(detectLanguages({name: 'Zee Tamil', group: 'News;Marathi'})).toEqual(['Marathi']);
    expect(detectLanguages({name: 'Zee Tamil', group: 'Entertainment'})).toEqual(['Tamil']);
    expect(detectLanguages({name: 'DD National', group: 'General'})).toEqual([]);
    expect(detectLanguages({name: 'Saved', languages: ['hin']})).toEqual(['Hindi']);
  });

  it('marks channels without a language as unknown', () => {
    expect(channelFacets({name: 'DD National'}).languages).toEqual([UNKNOWN_LANGUAGE]);
  });
});

const channel = (name: string, group: string, extra: Partial<FilterableChannel> = {}): FilterableChannel => ({name, group, attrs: {}, ...extra});

const LIST = [
  channel('Aaj Tak (720p)', 'News', {attrs: {'tvg-language': 'Hindi'}}),
  channel('NDTV 24x7 (1080p)', 'News', {attrs: {'tvg-language': 'English'}}),
  channel('Sun TV (1080p)', 'Entertainment', {attrs: {'tvg-language': 'Tamil'}}),
  channel('Zee Tamil', 'Entertainment'),
  channel('DD National (576p)', 'General'),
  channel('Star 4K', 'Movies;Entertainment', {attrs: {'tvg-language': 'Hindi;English'}}),
];
const names = (list: FilterableChannel[]) => list.map(item => item.name);
const filters = (value: Partial<ChannelFilters>): ChannelFilters => ({...DEFAULT_FILTERS, ...value});

describe('filters', () => {
  it('shows everything by default', () => {
    expect(applyFilters(LIST, DEFAULT_FILTERS)).toHaveLength(LIST.length);
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
  });

  it('filters by quality', () => {
    expect(names(applyFilters(LIST, filters({resolution: '1080'})))).toEqual(['NDTV 24x7 (1080p)', 'Sun TV (1080p)']);
    expect(names(applyFilters(LIST, filters({resolution: '4k'})))).toEqual(['Star 4K']);
    expect(names(applyFilters(LIST, filters({resolution: 'sd'})))).toEqual(['DD National (576p)']);
    expect(names(applyFilters(LIST, filters({resolution: 'unknown'})))).toEqual(['Zee Tamil']);
  });

  it('matches any picked language', () => {
    expect(names(applyFilters(LIST, filters({languages: ['Tamil']})))).toEqual(['Sun TV (1080p)', 'Zee Tamil']);
    expect(names(applyFilters(LIST, filters({languages: ['Tamil', 'English']})))).toEqual(['NDTV 24x7 (1080p)', 'Sun TV (1080p)', 'Zee Tamil', 'Star 4K']);
    expect(names(applyFilters(LIST, filters({languages: [UNKNOWN_LANGUAGE]})))).toEqual(['DD National (576p)']);
  });

  it('combines group, quality, language and search', () => {
    const picked = filters({group: 'Entertainment', resolution: '1080', languages: ['Tamil', 'Hindi']});
    expect(names(applyFilters(LIST, picked))).toEqual(['Sun TV (1080p)']);
    expect(names(applyFilters(LIST, filters({group: 'Entertainment'}), 'star'))).toEqual(['Star 4K']);
    expect(names(applyFilters(LIST, picked, 'zee'))).toEqual([]);
    expect(activeFilterCount(picked)).toBe(3);
  });

  it('counts each choice with the other filters kept', () => {
    const counts = filterCounts(LIST, filters({languages: ['Hindi']}));
    expect(counts.resolutions.map(option => [option.id, option.count])).toEqual([
      ['all', 2],
      ['4k', 1],
      ['1080', 0],
      ['720', 1],
      ['sd', 0],
      ['unknown', 0],
    ]);
    // Language counts ignore the language pick, so other choices keep their numbers.
    const languages = Object.fromEntries(counts.languages.map(option => [option.label, option.count]));
    expect(languages).toEqual({All: 6, Hindi: 2, English: 2, Tamil: 2, [UNKNOWN_LANGUAGE]: 1});
    expect(counts.languages[counts.languages.length - 1].id).toBe(UNKNOWN_LANGUAGE);
    expect(counts.groups.get('News')).toBe(1);
    expect(counts.groups.get('Entertainment')).toBe(1);
    expect(counts.allGroups).toBe(2);
    expect(hasFilterChoices(counts)).toBe(true);
  });

  it('keeps a saved choice the list no longer has, so it can be cleared', () => {
    const counts = filterCounts([channel('A (720p)', 'News')], filters({languages: ['Odia'], resolution: '4k'}));
    expect(counts.languages.map(option => option.id)).toContain('Odia');
    expect(counts.resolutions.map(option => option.id)).toEqual(['all', '4k', '720']);
  });

  it('has nothing to offer for a list with one quality and no language', () => {
    expect(hasFilterChoices(filterCounts([channel('A', 'News'), channel('B', 'News')], DEFAULT_FILTERS))).toBe(false);
  });

  it('toggles languages and resets everything but the badge setting', () => {
    let value = toggleLanguage(DEFAULT_FILTERS, 'Hindi');
    value = toggleLanguage(value, 'Tamil');
    expect(value.languages).toEqual(['Hindi', 'Tamil']);
    value = toggleLanguage(value, 'Hindi');
    expect(value.languages).toEqual(['Tamil']);
    expect(resetFilters({...value, resolution: '720', group: 'News', qualityBadge: false})).toEqual({...DEFAULT_FILTERS, qualityBadge: false});
  });

  it('cleans saved values', () => {
    expect(sanitizeFilters(undefined)).toEqual(DEFAULT_FILTERS);
    expect(sanitizeFilters('bad')).toEqual(DEFAULT_FILTERS);
    expect(sanitizeFilters({resolution: '999p', languages: ['Hindi', 3, 'Hindi'], group: '  ', qualityBadge: 'yes', extra: 1})).toEqual({...DEFAULT_FILTERS, languages: ['Hindi']});
    expect(sanitizeFilters({resolution: 'sd', languages: [], group: 'News', qualityBadge: false})).toEqual({resolution: 'sd', languages: [], group: 'News', qualityBadge: false});
  });
});
