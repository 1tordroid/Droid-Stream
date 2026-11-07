import {parseEpisodeName} from '../localContent/model';
import {parseRelease} from '../releaseName';
import type {NetlibParsed} from './types';

const VIDEO = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|mpeg|mpg|wmv|flv|iso)$/i;

export const isNetlibVideo = (name: string): boolean => VIDEO.test(name) && !name.startsWith('.');

const EXTRA_FOLDER = /^(extras?|featurettes?|behind the scenes|deleted scenes|interviews?|trailers?|samples?|shorts|other)$/i;
const EXTRA_NAME = /(?:^|[ ._-])(sample|trailer|featurette|behindthescenes|deleted[ ._-]?scene)(?:[ ._-]|\.[a-z0-9]+$|$)/i;
const SEASON_FOLDER = /^(?:season|series|staffel|saison|temporada|stagione)[ ._-]*(\d{1,3})\b|^s(\d{1,3})$/i;
const SPECIALS_FOLDER = /^specials?$/i;
/** Folder names that say nothing about the title. */
const GENERIC_FOLDER =
  /^(movies?|films?|tv|tv[ ._-]?shows?|shows?|series|videos?|media|downloads?|complete|anime|kids|library|share|public|dav|files|video_ts|bdmv|stream|\d{1,4})$/i;

/** Phone and camera recordings: VID_20230512_181500.mp4, PXL_..., 20240101_120000.mp4. */
const CAMERA_NAME = /^(?:vid|img|mov|pxl|dsc|dscn|gopr|dji|mvi)[ _-]?\d|(?:^|\D)(?:19|20)\d{6}(?:\D|$)/i;

const TMDB_TAG = /[[{(]tmdb(?:id)?[-= ](\d+)[\]})]/i;
const IMDB_TAG = /[[{(]imdb(?:id)?[-= ](tt\d{5,10})[\]})]|\b(tt\d{7,10})\b/i;

const idTags = (text: string): Pick<NetlibParsed, 'tmdbId' | 'imdbId'> => {
  const tmdb = TMDB_TAG.exec(text);
  const imdb = IMDB_TAG.exec(text);
  return {
    ...(tmdb ? {tmdbId: Number(tmdb[1])} : {}),
    ...(imdb ? {imdbId: (imdb[1] || imdb[2]).toLowerCase()} : {}),
  };
};

const withoutTags = (text: string) => text.replace(TMDB_TAG, ' ').replace(/[[{(]imdb(?:id)?[-= ]tt\d+[\]})]/i, ' ');

const folderTitle = (folder?: string) => {
  if (!folder || GENERIC_FOLDER.test(folder.trim()) || SEASON_FOLDER.test(folder.trim()) || EXTRA_FOLDER.test(folder.trim())) return undefined;
  const parsed = parseRelease(withoutTags(folder));
  return parsed.title ? parsed : undefined;
};

const seasonOf = (folder?: string): number | undefined => {
  if (!folder) return undefined;
  if (SPECIALS_FOLDER.test(folder.trim())) return 0;
  const match = SEASON_FOLDER.exec(folder.trim());
  return match ? Number(match[1] || match[2]) : undefined;
};

/**
 * Reads what a video is from its name and the folders above it (scan root
 * first). Folder names fill in what file names leave out: "Show/Season 2/05.mkv"
 * is episode 5 of season 2 of "Show", and "Inception (2010)/movie.mkv" is that film.
 */
export const parseNetlibPath = (folders: string[], name: string): NetlibParsed => {
  const parent = folders[folders.length - 1];
  const tags = {...idTags(folders.slice(-2).join('/')), ...idTags(name)};
  if (EXTRA_NAME.test(name) || folders.slice(-2).some(folder => EXTRA_FOLDER.test(folder.trim()))) {
    return {kind: 'other', title: name.replace(VIDEO, ''), extra: true};
  }
  const release = parseRelease(withoutTags(name.replace(VIDEO, '')));
  const base = {
    ...(release.resolution ? {resolution: release.resolution} : {}),
    ...(release.part ? {part: release.part} : {}),
    ...tags,
  };

  const folderSeason = seasonOf(parent);
  const showFolder = folderSeason !== undefined ? folderTitle(folders[folders.length - 2]) : folderTitle(parent);
  let season = release.season;
  let episode = release.episode;
  let episodes = release.episodes;
  if (episode === undefined && folderSeason !== undefined) {
    const fromName = parseEpisodeName(name, parent);
    episode = fromName.episode;
    episodes = episode === undefined ? undefined : [episode];
  }
  if (season === undefined && episode !== undefined) season = folderSeason ?? (release.absoluteEpisode !== undefined ? 1 : undefined);

  if (season !== undefined && episode !== undefined) {
    // A show folder names the show more reliably than each file does.
    const title = (folderSeason !== undefined && showFolder?.title) || release.title || showFolder?.title || '';
    if (!title) return {kind: 'other', title: name.replace(VIDEO, ''), ...base};
    return {
      kind: 'episode',
      title,
      ...(showFolder?.year && folderSeason !== undefined ? {year: showFolder.year} : release.year ? {year: release.year} : {}),
      season,
      episode,
      ...(episodes && episodes.length > 1 ? {episodes} : {}),
      ...base,
    };
  }

  // A movie: a file named after the film, or a film folder with a plain file name in it.
  const parentRelease = folderTitle(parent);
  const useFolder = Boolean(parentRelease && (!release.year || !release.title || /^(movie|film|video|main)$/i.test(release.title)) && parentRelease.year);
  const title = useFolder ? parentRelease!.title : release.title;
  const year = useFolder ? parentRelease!.year : release.year ?? parentRelease?.year;
  if (!title || (!year && /^\d+$/.test(title)) || CAMERA_NAME.test(name)) return {kind: 'other', title: name.replace(VIDEO, ''), ...base};
  return {kind: 'movie', title, ...(year ? {year} : {}), ...base};
};
