/**
 * Channel filters for Live TV and the TV guide: picture quality, language,
 * group and search. Pure: no React Native imports.
 *
 * Quality comes from the channel name ("DD National (576p)", "Star 4K"),
 * attributes (tvg-resolution, quality, "1920x1080"), the iptv-org feed in
 * tvg-id ("…@SD", "…@HD") or Jio's HD flag. Language comes from
 * tvg-language (or Jio's language), else a guess from the group names and
 * then the channel name, using LANGUAGES below.
 */

/** Same rule as m3u.ts inGroup (kept here so the two files do not import each other). */
const inGroup = (channel: {group?: string}, group: string): boolean =>
  (channel.group || '').split(';').some(item => item.trim() === group);

export type QualityBucket = '4k' | '1080' | '720' | 'sd' | 'unknown';
export type ResolutionFilter = 'all' | QualityBucket;

export const RESOLUTION_OPTIONS: readonly {id: ResolutionFilter; label: string}[] = [
  {id: 'all', label: 'All'},
  {id: '4k', label: '4K'},
  {id: '1080', label: '1080p'},
  {id: '720', label: '720p'},
  {id: 'sd', label: 'SD'},
  {id: 'unknown', label: 'Unknown'},
];

export interface LanguageInfo {
  name: string;
  /** Whole words that mark the language in a group or channel name. */
  words: string[];
  /** ISO 639 codes a tvg-language value may use. */
  codes: string[];
}

/** The one list of languages Live TV knows by name. Add new ones here. */
export const LANGUAGES: readonly LanguageInfo[] = [
  {name: 'Hindi', words: ['hindi'], codes: ['hi', 'hin']},
  {name: 'English', words: ['english'], codes: ['en', 'eng']},
  {name: 'Tamil', words: ['tamil'], codes: ['ta', 'tam']},
  {name: 'Telugu', words: ['telugu'], codes: ['te', 'tel']},
  {name: 'Bengali', words: ['bengali', 'bangla'], codes: ['bn', 'ben']},
  {name: 'Marathi', words: ['marathi'], codes: ['mr', 'mar']},
  {name: 'Kannada', words: ['kannada'], codes: ['kn', 'kan']},
  {name: 'Malayalam', words: ['malayalam'], codes: ['ml', 'mal']},
  {name: 'Punjabi', words: ['punjabi', 'panjabi'], codes: ['pa', 'pan']},
  {name: 'Gujarati', words: ['gujarati'], codes: ['gu', 'guj']},
  {name: 'Odia', words: ['odia', 'oriya'], codes: ['or', 'ori', 'ory']},
  {name: 'Urdu', words: ['urdu'], codes: ['ur', 'urd']},
  {name: 'Assamese', words: ['assamese'], codes: ['as', 'asm']},
  {name: 'Bhojpuri', words: ['bhojpuri'], codes: ['bho']},
  {name: 'Nepali', words: ['nepali'], codes: ['ne', 'nep']},
];

/** Shown for channels whose language is not known. */
export const UNKNOWN_LANGUAGE = 'Unknown';

/** What the filters read from a channel (a playlist channel or a saved one). */
export interface FilterableChannel {
  name: string;
  group?: string;
  tvgId?: string;
  tvgName?: string;
  attrs?: Record<string, string>;
  /** Quality label set when the playlist was read ("1080p", "4K", "HD", "SD"). */
  resolution?: string;
  /** Languages kept with a saved channel. */
  languages?: string[];
}

// ---- Quality ----

const heightLabel = (height: number): string | undefined => {
  if (!Number.isFinite(height) || height < 140 || height > 4320) return undefined;
  if (height >= 4320) return '8K';
  if (height >= 2160) return '4K';
  return `${height}p`;
};

/** "1080p", "720i", "2160P" as a separate token. */
const NUMERIC_TAG = /(?:^|[^a-z0-9])(\d{3,4})\s?[pi](?![a-z0-9])/i;
/** "1920x1080" style sizes in an attribute. */
const SIZE = /(\d{3,4})\s*[x×]\s*(\d{3,4})/i;

const wordLabel = (text: string): string | undefined => {
  if (/(?:^|[^a-z0-9])8k(?![a-z0-9])/i.test(text)) return '8K';
  if (/(?:^|[^a-z0-9])(?:4k|uhd|ultra\s?hd)(?![a-z0-9])/i.test(text)) return '4K';
  if (/(?:^|[^a-z0-9])(?:fhd|full\s?hd)(?![a-z0-9])/i.test(text)) return '1080p';
  if (/(?:^|[^a-z0-9])hd(?![a-z0-9])/i.test(text)) return 'HD';
  if (/(?:^|[^a-z0-9])sd(?![a-z0-9])/i.test(text)) return 'SD';
  return undefined;
};

const numericLabel = (text: string): string | undefined => {
  const size = SIZE.exec(text);
  if (size) return heightLabel(Math.min(Number(size[1]), Number(size[2])));
  const tag = NUMERIC_TAG.exec(text);
  return tag ? heightLabel(Number(tag[1])) : undefined;
};

const QUALITY_ATTRS = ['tvg-resolution', 'resolution', 'video-resolution', 'tvg-quality', 'quality'];

/**
 * The quality label for a channel: "4K", "1080p", "720p", "576p", "HD",
 * "SD" and so on, or undefined when nothing says.
 */
export const parseResolution = (name: string, attrs: Record<string, string> = {}, tvgId?: string): string | undefined => {
  const fromName = numericLabel(name);
  if (fromName) return fromName;
  for (const key of QUALITY_ATTRS) {
    const value = attrs[key];
    if (!value) continue;
    const label = numericLabel(value) || wordLabel(value) || (/^\d{3,4}$/.test(value.trim()) ? heightLabel(Number(value)) : undefined);
    if (label) return label;
  }
  const word = wordLabel(name);
  if (word) return word;
  // iptv-org feeds: "Channel.in@SD", "Channel.in@HD".
  const feed = /@([a-z0-9]+)$/i.exec(tvgId || '')?.[1];
  if (feed) {
    const label = numericLabel(feed) || wordLabel(feed);
    if (label) return label;
  }
  // Jio marks HD channels.
  if (attrs.hd === 'true') return 'HD';
  return undefined;
};

/** Which filter a quality label falls in. "HD" alone counts as 720p. */
export const qualityBucket = (label: string | undefined): QualityBucket => {
  if (!label) return 'unknown';
  if (label === '4K' || label === '8K') return '4k';
  if (label === 'HD') return '720';
  if (label === 'SD') return 'sd';
  const height = parseInt(label, 10);
  if (!Number.isFinite(height)) return 'unknown';
  if (height >= 2160) return '4k';
  if (height >= 1080) return '1080';
  if (height >= 720) return '720';
  return 'sd';
};

const BRACKET_TAG = /\s*[([]\s*(?:\d{3,4}\s?[pi]|4k|8k|uhd|fhd)\s*[)\]]/gi;

/** The name without "(1080p)"-style tags, for tiles that show a quality badge. */
export const displayChannelName = (name: string): string => {
  const clean = name.replace(BRACKET_TAG, '').replace(/\s{2,}/g, ' ').trim();
  return clean || name;
};

// ---- Language ----

const byLookup = new Map<string, string>();
for (const language of LANGUAGES) {
  byLookup.set(language.name.toLowerCase(), language.name);
  for (const word of language.words) byLookup.set(word, language.name);
  for (const code of language.codes) byLookup.set(code, language.name);
}

const titleCase = (value: string) =>
  value
    .toLowerCase()
    .split(/(\s+|-)/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

/** "hin", "HINDI" and "Hindi" all become "Hindi". Unknown names are kept, title-cased. */
export const normalizeLanguage = (value: string): string | undefined => {
  const clean = value.trim();
  if (!clean || /^(?:undefined|unknown|none|null|-)$/i.test(clean)) return undefined;
  return byLookup.get(clean.toLowerCase()) || titleCase(clean);
};

const LANGUAGE_ATTRS = ['tvg-language', 'language', 'tvg-lang'];

const wordPatterns = LANGUAGES.map(language => ({
  name: language.name,
  pattern: new RegExp(`(?:^|[^a-z])(?:${language.words.join('|')})(?![a-z])`, 'i'),
}));

/** Languages named as whole words in a text, in LANGUAGES order. */
export const guessLanguages = (text: string | undefined): string[] =>
  text ? wordPatterns.filter(item => item.pattern.test(text)).map(item => item.name) : [];

const unique = (values: (string | undefined)[]): string[] => {
  const out: string[] = [];
  for (const value of values) if (value && !out.includes(value)) out.push(value);
  return out;
};

/** A channel's languages: tvg-language or Jio's, else a guess from the groups, then the name. */
export const detectLanguages = (channel: FilterableChannel): string[] => {
  if (channel.languages?.length) return unique(channel.languages.map(normalizeLanguage));
  const attrs = channel.attrs || {};
  for (const key of LANGUAGE_ATTRS) {
    if (!attrs[key]) continue;
    const found = unique(attrs[key].split(/[;,|/]/).map(normalizeLanguage));
    if (found.length) return found;
  }
  const fromGroups = unique((channel.group || '').split(';').flatMap(guessLanguages));
  if (fromGroups.length) return fromGroups;
  return guessLanguages(channel.name);
};

// ---- Facets (cached per channel object) ----

export interface ChannelFacets {
  /** Quality label for the badge, when known. */
  quality?: string;
  bucket: QualityBucket;
  /** Known languages, or [UNKNOWN_LANGUAGE]. */
  languages: string[];
  /** Lower-cased text the search box looks in. */
  search: string;
}

const facetCache = new WeakMap<object, ChannelFacets>();

export const channelFacets = (channel: FilterableChannel): ChannelFacets => {
  const cached = facetCache.get(channel);
  if (cached) return cached;
  const quality = channel.resolution || parseResolution(channel.name, channel.attrs, channel.tvgId);
  const languages = detectLanguages(channel);
  const facets: ChannelFacets = {
    quality,
    bucket: qualityBucket(quality),
    languages: languages.length ? languages : [UNKNOWN_LANGUAGE],
    search: `${channel.name} ${channel.group || ''} ${channel.tvgName || ''}`.toLowerCase(),
  };
  facetCache.set(channel, facets);
  return facets;
};

// ---- Filters ----

export interface ChannelFilters {
  resolution: ResolutionFilter;
  /** Any of these languages; empty means all. */
  languages: string[];
  group?: string;
  /** Hide "(1080p)" in names and show a quality badge instead. */
  qualityBadge: boolean;
}

export const DEFAULT_FILTERS: ChannelFilters = {resolution: 'all', languages: [], qualityBadge: true};

const RESOLUTION_IDS = new Set<string>(RESOLUTION_OPTIONS.map(option => option.id));

/** A saved value made safe to use: unknown fields dropped, defaults filled in. */
export const sanitizeFilters = (value: unknown): ChannelFilters => {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const resolution = typeof raw.resolution === 'string' && RESOLUTION_IDS.has(raw.resolution) ? (raw.resolution as ResolutionFilter) : 'all';
  const languages = Array.isArray(raw.languages) ? unique(raw.languages.filter((item): item is string => typeof item === 'string').map(item => item.trim())) : [];
  const group = typeof raw.group === 'string' && raw.group.trim() ? raw.group : undefined;
  return {
    resolution,
    languages,
    ...(group ? {group} : {}),
    qualityBadge: typeof raw.qualityBadge === 'boolean' ? raw.qualityBadge : DEFAULT_FILTERS.qualityBadge,
  };
};

/** Filters that narrow the list (the badge setting does not count). */
export const activeFilterCount = (filters: ChannelFilters): number =>
  (filters.resolution !== 'all' ? 1 : 0) + (filters.languages.length ? 1 : 0) + (filters.group ? 1 : 0);

/** Clears what narrows the list; keeps the badge setting. */
export const resetFilters = (filters: ChannelFilters): ChannelFilters => ({...DEFAULT_FILTERS, qualityBadge: filters.qualityBadge});

export const toggleLanguage = (filters: ChannelFilters, language: string): ChannelFilters => ({
  ...filters,
  languages: filters.languages.includes(language) ? filters.languages.filter(item => item !== language) : [...filters.languages, language],
});

type Skip = 'resolution' | 'language' | 'group';

const matches = (channel: FilterableChannel, filters: ChannelFilters, query: string, skip?: Skip): boolean => {
  const facets = channelFacets(channel);
  if (skip !== 'group' && filters.group && !inGroup(channel, filters.group)) return false;
  if (skip !== 'resolution' && filters.resolution !== 'all' && facets.bucket !== filters.resolution) return false;
  if (skip !== 'language' && filters.languages.length && !facets.languages.some(language => filters.languages.includes(language))) return false;
  return !query || facets.search.includes(query);
};

/** Channels that pass the group, quality, language and search filters. */
export const applyFilters = <T extends FilterableChannel>(channels: T[], filters: ChannelFilters, query = ''): T[] => {
  const q = query.trim().toLowerCase();
  return channels.filter(channel => matches(channel, filters, q));
};

export interface FilterOption<T extends string = string> {
  id: T;
  label: string;
  /** Channels this choice would show with the other filters kept. */
  count: number;
}

export interface FilterCounts {
  resolutions: FilterOption<ResolutionFilter>[];
  languages: FilterOption[];
  /** Channels per group with the other filters kept. */
  groups: Map<string, number>;
  /** Channels with every filter but the group (for the "All" group chip). */
  allGroups: number;
}

/**
 * Choices to show with their counts. Each count keeps the other filters, so
 * a choice shows what picking it would give. Choices come from the whole
 * list, so they do not move while filters change; a saved choice the list
 * no longer has stays so it can be cleared.
 */
export const filterCounts = (channels: FilterableChannel[], filters: ChannelFilters, query = ''): FilterCounts => {
  const q = query.trim().toLowerCase();
  const buckets = new Map<QualityBucket, number>();
  const present = new Set<QualityBucket>();
  const languageCounts = new Map<string, number>();
  const languageTotals = new Map<string, number>();
  const groups = new Map<string, number>();
  let allGroups = 0;
  let allResolutions = 0;
  let allLanguages = 0;

  for (const channel of channels) {
    const facets = channelFacets(channel);
    present.add(facets.bucket);
    for (const language of facets.languages) languageTotals.set(language, (languageTotals.get(language) || 0) + 1);
    if (matches(channel, filters, q, 'resolution')) {
      allResolutions++;
      buckets.set(facets.bucket, (buckets.get(facets.bucket) || 0) + 1);
    }
    if (matches(channel, filters, q, 'language')) {
      allLanguages++;
      for (const language of facets.languages) languageCounts.set(language, (languageCounts.get(language) || 0) + 1);
    }
    if (matches(channel, filters, q, 'group')) {
      allGroups++;
      for (const group of (channel.group || '').split(';')) {
        const name = group.trim();
        if (name) groups.set(name, (groups.get(name) || 0) + 1);
      }
    }
  }

  const resolutions: FilterOption<ResolutionFilter>[] = RESOLUTION_OPTIONS.filter(
    option => option.id === 'all' || present.has(option.id as QualityBucket) || option.id === filters.resolution,
  ).map(option => ({
    ...option,
    count: option.id === 'all' ? allResolutions : buckets.get(option.id as QualityBucket) || 0,
  }));

  const names = [...languageTotals.keys()];
  for (const selected of filters.languages) if (!names.includes(selected)) names.push(selected);
  names.sort((a, b) => {
    if (a === UNKNOWN_LANGUAGE || b === UNKNOWN_LANGUAGE) return a === UNKNOWN_LANGUAGE ? 1 : -1;
    return (languageTotals.get(b) || 0) - (languageTotals.get(a) || 0) || a.localeCompare(b);
  });
  const languages: FilterOption[] = [
    {id: '', label: 'All', count: allLanguages},
    ...names.map(name => ({id: name, label: name, count: languageCounts.get(name) || 0})),
  ];

  return {resolutions, languages, groups, allGroups};
};

/** Whether the language and quality choices are worth showing for this list. */
export const hasFilterChoices = (counts: FilterCounts): boolean => counts.resolutions.length > 2 || counts.languages.length > 2;
