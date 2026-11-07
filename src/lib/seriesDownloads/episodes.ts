/**
 * Episode numbers, ranges and file names for season and rolling downloads.
 * Provider titles vary a lot ("Episode 2", "E02 - Pilot", "S01E02", "2. The
 * Pilot"), so numbers are read from the title when they are there and fall
 * back to the position in the season.
 */
import {sanitizeDownloadFileName} from '../downloadId';
import type {SkipInterval} from '../providers/types';

export interface SeasonEpisode {
  title: string;
  link: string;
  /** Position in the provider's raw list, used for the download id. */
  index: number;
  skip?: SkipInterval[];
}

export interface NumberedEpisode extends SeasonEpisode {
  season?: number;
  episode: number;
}

const SEASON_PATTERNS = [/\bseason\s*[-:.]?\s*(\d{1,3})\b/i, /\bS(\d{1,3})\s*E\d{1,4}\b/i, /\bS(\d{1,3})\b/i, /\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i];

/** Season number in a season title such as "Season 2 [1080p]" or "S02". */
export const parseSeasonNumber = (title?: string): number | undefined => {
  if (!title) return undefined;
  for (const pattern of SEASON_PATTERNS) {
    const match = pattern.exec(title);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return undefined;
};

const EPISODE_PATTERNS = [/\bS\d{1,3}\s*E(\d{1,4})\b/i, /\bep(?:isode)?\.?\s*(?:-|:|#)?\s*(\d{1,4})\b/i, /\bE(\d{1,4})\b/, /^\s*(\d{1,4})\s*[.):-]\s+/];

/** Episode number in an episode title, else its 1-based position. */
export const parseEpisodeNumber = (title: string | undefined, position: number): number => {
  if (title) {
    for (const pattern of EPISODE_PATTERNS) {
      const match = pattern.exec(title);
      if (match) {
        const value = Number(match[1]);
        if (Number.isFinite(value) && value > 0) return value;
      }
    }
  }
  return position + 1;
};

/** Numbers each episode of one season, in season order. */
export const numberEpisodes = (episodes: SeasonEpisode[], seasonTitle?: string): NumberedEpisode[] => {
  const season = parseSeasonNumber(seasonTitle);
  return episodes.map((episode, position) => ({
    ...episode,
    season,
    episode: parseEpisodeNumber(episode.title, position),
  }));
};

/**
 * Episodes from position [from] to [to] (1-based, both included), clamped to
 * the season. Without a range, the whole season.
 */
export const selectEpisodeRange = <T>(episodes: T[], range?: {from: number; to: number}): T[] => {
  if (!range) return episodes.slice();
  const count = episodes.length;
  if (!count) return [];
  let from = Math.max(1, Math.min(count, Math.round(range.from) || 1));
  let to = Math.max(1, Math.min(count, Math.round(range.to) || count));
  if (from > to) [from, to] = [to, from];
  return episodes.slice(from - 1, to);
};

/**
 * The next [count] episodes to watch: those after the last watched one that
 * are not watched yet. With nothing watched, from the first episode.
 */
export const nextUnwatched = <T>(episodes: T[], isWatched: (episode: T) => boolean, count: number): T[] => {
  let last = -1;
  episodes.forEach((episode, index) => {
    if (isWatched(episode)) last = index;
  });
  return episodes.slice(last + 1).filter(episode => !isWatched(episode)).slice(0, Math.max(0, count));
};

const pad = (value: number) => String(value).padStart(2, '0');

/** "S01E02", or "E02" when the season is not known. */
export const episodeTag = (season: number | undefined, episode: number): string =>
  `${season !== undefined ? `S${pad(season)}` : ''}E${pad(episode)}`;

/** The season folder: "Season 01", or the provider's title when it has no number. */
export const seasonFolderName = (seasonTitle: string | undefined): string | undefined => {
  const season = parseSeasonNumber(seasonTitle);
  if (season !== undefined) return `Season ${pad(season)}`;
  return seasonTitle ? sanitizeDownloadFileName(seasonTitle) : undefined;
};

/** What is left of an episode title once its number is taken out. */
export const cleanEpisodeTitle = (title: string | undefined): string => {
  if (!title) return '';
  const cleaned = title
    .replace(/\bS\d{1,3}\s*E\d{1,4}\b/gi, ' ')
    .replace(/\bseason\s*\d{1,3}\b/gi, ' ')
    .replace(/\bep(?:isode)?\.?\s*(?:-|:|#)?\s*\d{1,4}\b/gi, ' ')
    .replace(/^\s*\d{1,4}\s*[.):-]\s+/, ' ')
    .replace(/^[\s\-:|.·–—]+|[\s\-:|.·–—]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
};

/** File name without extension: "S01E02 The Pilot", or "S01E02" for a bare "Episode 2". */
export const episodeFileName = (season: number | undefined, episode: number, title?: string): string => {
  const rest = cleanEpisodeTitle(title);
  return sanitizeDownloadFileName(rest ? `${episodeTag(season, episode)} ${rest}` : episodeTag(season, episode));
};

/**
 * The next season in the provider's list: the one numbered one higher,
 * preferring the same quality tag ("[1080p]") as the current one.
 */
export const nextSeasonTitle = (titles: string[], current: string): string | undefined => {
  const number = parseSeasonNumber(current);
  if (number === undefined) {
    const index = titles.indexOf(current);
    return index >= 0 && index + 1 < titles.length ? titles[index + 1] : undefined;
  }
  const candidates = titles.filter(title => parseSeasonNumber(title) === number + 1);
  if (!candidates.length) return undefined;
  const quality = /(\d{3,4})p/i.exec(current)?.[1];
  return (quality && candidates.find(title => new RegExp(`${quality}p`, 'i').test(title))) || candidates[0];
};
