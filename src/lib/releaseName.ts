/**
 * Reads a torrent or scene release name: "Show.Name.S02E05.1080p.WEB-DL.x265-GRP".
 * Original TypeScript written for Droid Stream.
 */

export interface ParsedRelease {
  title: string;
  year?: number;
  season?: number;
  /** First episode; `episodes` has every one for multi-episode packs. */
  episode?: number;
  episodes?: number[];
  /** The release covers a whole season or several. */
  seasonPack?: boolean;
  resolution?: '2160p' | '1080p' | '720p' | '480p';
  source?: string;
  codec?: string;
  hdr?: string;
  audio?: string;
  group?: string;
  language?: string[];
  /** Anime absolute episode numbering, "[Group] Show - 1071 [1080p]". */
  absoluteEpisode?: number;
}

const SOURCE: [RegExp, string][] = [
  [/\b(remux)\b/i, 'Remux'],
  [/\b(blu-?ray|bdrip|brrip|bd)\b/i, 'BluRay'],
  [/\b(web-?dl|webdl)\b/i, 'WEB-DL'],
  [/\b(webrip|web)\b/i, 'WEBRip'],
  [/\b(hdtv)\b/i, 'HDTV'],
  [/\b(dvdrip|dvd)\b/i, 'DVD'],
  [/\b(hdcam|cam|camrip)\b/i, 'CAM'],
  [/\b(hdts|telesync|ts)\b/i, 'TS'],
];
const CODEC: [RegExp, string][] = [
  [/\b(x265|h\.?265|hevc)\b/i, 'HEVC'],
  [/\b(x264|h\.?264|avc)\b/i, 'H.264'],
  [/\b(av1)\b/i, 'AV1'],
  [/\b(xvid)\b/i, 'XviD'],
];
const AUDIO: [RegExp, string][] = [
  [/\batmos\b/i, 'Atmos'],
  [/\b(truehd)\b/i, 'TrueHD'],
  [/\b(dts-?hd(\.?ma)?|dts)\b/i, 'DTS'],
  [/\b(ddp|dd\+|eac3|e-ac-3)\s?(5\.1|7\.1)?\b/i, 'DD+'],
  [/\b(dd|ac3)\s?(5\.1|2\.0)?\b/i, 'DD'],
  [/\b(aac)\b/i, 'AAC'],
  [/\b(flac)\b/i, 'FLAC'],
];
const LANGUAGES: [RegExp, string][] = [
  [/\bhindi\b/i, 'Hindi'],
  [/\btamil\b/i, 'Tamil'],
  [/\btelugu\b/i, 'Telugu'],
  [/\b(multi|dual[ .-]?audio)\b/i, 'Multi'],
  [/\b(french|vff|vostfr)\b/i, 'French'],
  [/\b(german)\b/i, 'German'],
  [/\b(spanish|castellano|latino)\b/i, 'Spanish'],
  [/\b(ita|italian)\b/i, 'Italian'],
  [/\b(rus|russian)\b/i, 'Russian'],
  [/\b(jpn|japanese)\b/i, 'Japanese'],
  [/\b(kor|korean)\b/i, 'Korean'],
];

const first = (text: string, table: [RegExp, string][]): string | undefined => table.find(([pattern]) => pattern.test(text))?.[1];

/** Words that end the title part of a release name. */
const TITLE_STOP =
  /(\b(19|20)\d{2}\b|\bS\d{1,2}(E\d{1,4})?\b|\b\d{1,2}x\d{1,3}\b|\bseason\s?\d|\b(2160|1080|720|480|576)[pi]\b|\b4k\b|\buhd\b|\b(blu-?ray|web-?dl|webrip|hdtv|dvdrip|bdrip|brrip|remux|hdcam|x26[45]|hevc)\b|\bcomplete\b|\[|\(|\s-\s\d{1,4}\b)/i;

export const parseRelease = (name: string): ParsedRelease => {
  const raw = name.replace(/\.(mkv|mp4|avi|m4v|ts|webm)$/i, '');
  // Dots and underscores separate words in scene names; keep decimals like 5.1.
  const text = raw
    .replace(/[._]/g, (char, offset: number, all: string) =>
      char === '.' && /\d/.test(all[offset - 1] || '') && /\d/.test(all[offset + 1] || '') ? '.' : ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  const result: ParsedRelease = {title: ''};

  const groupTag = raw.match(/^\[([^\]]+)\]/);
  const body = groupTag ? text.replace(/^\[[^\]]+\]\s*/, '') : text;
  result.group = groupTag?.[1] || raw.match(/-([A-Za-z0-9]+)(?:\[[^\]]+\])?$/)?.[1];

  const se = body.match(/\bS(\d{1,2})[ .-]?E(\d{1,4})(?:[ .-]?-?E?(\d{1,4}))*/i);
  const x = body.match(/\b(\d{1,2})x(\d{1,3})\b/);
  if (se) {
    result.season = Number(se[1]);
    const numbers = Array.from(se[0].matchAll(/E(\d{1,4})/gi)).map(match => Number(match[1]));
    const range = se[0].match(/E(\d{1,4})-E?(\d{1,4})/i);
    result.episodes = range
      ? Array.from({length: Number(range[2]) - Number(range[1]) + 1}, (_, index) => Number(range[1]) + index)
      : numbers;
    result.episode = result.episodes[0];
  } else if (x) {
    result.season = Number(x[1]);
    result.episode = Number(x[2]);
    result.episodes = [result.episode];
  } else {
    const seasonOnly = body.match(/\bS(\d{1,2})\b(?!E)|\bseason[ .]?(\d{1,2})\b/i);
    const seasons = body.match(/\bS(\d{1,2})\s?-\s?S?(\d{1,2})\b/i);
    if (seasons || seasonOnly || /\bcomplete\b/i.test(body)) {
      result.seasonPack = true;
      if (seasonOnly) result.season = Number(seasonOnly[1] || seasonOnly[2]);
      if (seasons) result.season = Number(seasons[1]);
    }
    const absolute = body.match(/\s-\s(\d{1,4})(?:v\d)?(?:\s|$|\[|\()/);
    if (absolute) {
      result.absoluteEpisode = Number(absolute[1]);
      result.episode = result.absoluteEpisode;
    }
  }

  const years = Array.from(body.matchAll(/\b(19[2-9]\d|20[0-4]\d)\b/g)).map(match => Number(match[1]));
  // A year at the very start is usually part of the title ("2001 A Space Odyssey 1968").
  if (years.length) result.year = years.length > 1 && body.startsWith(String(years[0])) ? years[1] : years[0];

  if (/\b(2160p|4k|uhd)\b/i.test(body)) result.resolution = '2160p';
  else if (/\b1080[pi]\b/i.test(body)) result.resolution = '1080p';
  else if (/\b720p\b/i.test(body)) result.resolution = '720p';
  else if (/\b(480p|576p)\b/i.test(body)) result.resolution = '480p';

  result.source = first(body, SOURCE);
  result.codec = first(body, CODEC);
  result.audio = first(body, AUDIO);
  if (/\b(dv|dovi|dolby[ .]?vision)\b/i.test(body)) result.hdr = 'DV';
  else if (/\bhdr10\+/i.test(body)) result.hdr = 'HDR10+';
  else if (/\bhdr(10)?\b/i.test(body)) result.hdr = 'HDR';
  const languages = LANGUAGES.filter(([pattern]) => pattern.test(body)).map(([, label]) => label);
  if (languages.length) result.language = languages;

  let titlePart = body;
  const leadingYear = result.year && body.startsWith(String(result.year)) && years.length > 1;
  const searchFrom = leadingYear ? 5 : 0;
  const stop = titlePart.slice(searchFrom).search(TITLE_STOP);
  if (stop > 0) titlePart = titlePart.slice(0, stop + searchFrom);
  result.title = titlePart.replace(/[\s\-–:]+$/, '').replace(/\s+/g, ' ').trim() || body;
  return result;
};

const normalize = (value: string): string =>
  value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

/** True when a release is for this title (and episode, when given). */
export const releaseMatches = (
  release: string,
  want: {title: string; year?: number; season?: number; episode?: number},
): boolean => {
  const parsed = parseRelease(release);
  const a = normalize(parsed.title);
  const b = normalize(want.title);
  if (!a || !b) return false;
  const titleOk = a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `) || a.replace(/^the /, '') === b.replace(/^the /, '');
  if (!titleOk) return false;
  if (want.year && parsed.year && Math.abs(parsed.year - want.year) > 1 && want.season === undefined) return false;
  if (want.season !== undefined) {
    if (parsed.season !== undefined && parsed.season !== want.season) return false;
    if (want.episode !== undefined && parsed.episodes?.length && !parsed.episodes.includes(want.episode)) return false;
    if (want.episode !== undefined && !parsed.episodes?.length && !parsed.seasonPack && parsed.absoluteEpisode === undefined) return false;
  }
  return true;
};

export const episodeTag = (season: number, episode: number): string =>
  `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
