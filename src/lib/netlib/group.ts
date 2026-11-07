import {naturalCompare} from '../localContent/model';
import {itemId, normalizeTitle, versionKey} from './ids';
import {parseNetlibPath} from './parsePath';
import type {NetlibEpisode, NetlibFile, NetlibItem, NetlibParsed, NetlibVersion} from './types';

const RESOLUTION_RANK: Record<string, number> = {'2160p': 4, '1080p': 3, '720p': 2, '480p': 1};

/** Best quality first; parts of one copy in order. */
export const compareVersions = (a: NetlibVersion, b: NetlibVersion): number =>
  (RESOLUTION_RANK[b.resolution || ''] || 0) - (RESOLUTION_RANK[a.resolution || ''] || 0) ||
  (a.part || 0) - (b.part || 0) ||
  naturalCompare(a.name, b.name);

const toVersion = (sourceId: string, file: NetlibFile, parsed: NetlibParsed): NetlibVersion => ({
  key: versionKey(sourceId, file.path),
  name: file.name,
  ...(file.size !== undefined ? {size: file.size} : {}),
  ...(file.modified !== undefined ? {modified: file.modified} : {}),
  ...(parsed.resolution ? {resolution: parsed.resolution} : {}),
  ...(parsed.part ? {part: parsed.part} : {}),
});

/**
 * Turns scanned files into library titles: one movie per title and year (its
 * files are versions), one show per title with its episodes, and every
 * other video on its own.
 */
export const groupNetlib = (sourceId: string, files: NetlibFile[]): NetlibItem[] => {
  const items = new Map<string, NetlibItem>();
  const episodeMaps = new Map<string, Map<string, NetlibEpisode>>();
  // A show folder found with a year and without one is still one show.
  const showIds = new Map<string, string>();

  for (const file of files) {
    const parsed = parseNetlibPath(file.folders, file.name);
    const version = toVersion(sourceId, file, parsed);
    const added = file.modified || 0;

    if (parsed.kind === 'episode') {
      const norm = normalizeTitle(parsed.title);
      const id = showIds.get(norm) || itemId(sourceId, 'show', parsed.title);
      showIds.set(norm, id);
      let item = items.get(id);
      if (!item) {
        item = {id, sourceId, kind: 'show', title: parsed.title, versions: [], episodes: [], added: 0};
        items.set(id, item);
        episodeMaps.set(id, new Map());
      }
      if (!item.year && parsed.year) item.year = parsed.year;
      if (!item.tmdbId && parsed.tmdbId) item.tmdbId = parsed.tmdbId;
      if (!item.imdbId && parsed.imdbId) item.imdbId = parsed.imdbId;
      item.added = Math.max(item.added, added);
      const map = episodeMaps.get(id)!;
      const key = `${parsed.season}x${parsed.episode}`;
      const episode = map.get(key) || {season: parsed.season!, episode: parsed.episode!, versions: []};
      if (parsed.episodes && parsed.episodes.length > 1) episode.lastEpisode = parsed.episodes[parsed.episodes.length - 1];
      episode.versions.push(version);
      map.set(key, episode);
      continue;
    }

    const kind = parsed.kind === 'movie' ? 'movie' : 'other';
    const id = kind === 'movie' ? itemId(sourceId, 'movie', parsed.title, parsed.year) : itemId(sourceId, 'other', file.path);
    let item = items.get(id);
    if (!item) {
      item = {id, sourceId, kind, title: parsed.title, ...(parsed.year ? {year: parsed.year} : {}), versions: [], episodes: [], added: 0};
      items.set(id, item);
    }
    if (!item.tmdbId && parsed.tmdbId) item.tmdbId = parsed.tmdbId;
    if (!item.imdbId && parsed.imdbId) item.imdbId = parsed.imdbId;
    item.added = Math.max(item.added, added);
    item.versions.push(version);
  }

  for (const item of items.values()) {
    item.versions.sort(compareVersions);
    const map = episodeMaps.get(item.id);
    if (map) {
      item.episodes = [...map.values()]
        .map(episode => ({...episode, versions: episode.versions.sort(compareVersions)}))
        .sort((a, b) => a.season - b.season || a.episode - b.episode);
    }
  }
  return [...items.values()];
};

/** Display name and year of a title: the match when there is one, else the file names. */
export const itemTitle = (item: NetlibItem): string => item.match?.title || item.title;
export const itemYear = (item: NetlibItem): number | undefined => item.match?.year || item.year;

/**
 * The tab a title shows in. A movie with neither a year nor a match is
 * probably a home video, so it waits in Other until it is matched.
 */
export const itemTab = (item: NetlibItem): 'movies' | 'shows' | 'other' => {
  if (item.kind === 'show') return 'shows';
  if (item.kind === 'movie' && (item.match || item.year || item.tmdbId || item.imdbId)) return 'movies';
  return 'other';
};

/** The movie copy or episode to play first: the best quality, part 1. */
export const primaryVersion = (versions: NetlibVersion[]): NetlibVersion | undefined => versions[0];
