import {itemTitle} from './group';
import {historyFor, isWatchedProgress, type NetlibHistoryEntry} from './history';
import {NETLIB_PROVIDER, netlibLink} from './ids';
import {episodeLabel} from './playback';
import type {NetlibEpisode, NetlibItem} from './types';

type ReadProgress = (key: string) => {position: number; duration: number} | undefined;

interface Step {
  key: string;
  /** Every file of this step: an episode can be in several qualities. */
  keys: string[];
  episode?: NetlibEpisode;
}

/** The order a title plays in: seasons, then specials; or a movie's parts. */
export const playOrder = (item: NetlibItem): Step[] => {
  if (item.kind === 'show') {
    const episodes = [...item.episodes].sort(
      (a, b) => (a.season === 0 ? 1 : 0) - (b.season === 0 ? 1 : 0) || a.season - b.season || a.episode - b.episode,
    );
    return episodes.map(episode => ({key: episode.versions[0].key, keys: episode.versions.map(version => version.key), episode}));
  }
  const first = item.versions[0];
  if (!first) return [];
  if (!first.part) return [{key: first.key, keys: item.versions.map(version => version.key)}];
  return item.versions
    .filter(version => version.part && version.resolution === first.resolution)
    .map(version => ({key: version.key, keys: [version.key]}));
};

export interface NetlibResume {
  mode: 'start' | 'resume' | 'next';
  key: string;
  episode?: NetlibEpisode;
  position: number;
  duration: number;
  progress?: number;
  remainingSeconds?: number;
  updatedAt: number;
  /** Everything was watched; Play starts over. */
  finished?: boolean;
}

/**
 * Where a library title picks up: the file last played (from library
 * history, else saved progress), the next episode or part once that one is
 * 85% watched, or the start.
 */
export const netlibResume = (
  item: NetlibItem,
  readProgress: ReadProgress,
  history: NetlibHistoryEntry | undefined = historyFor(item.id),
): NetlibResume | undefined => {
  const steps = playOrder(item);
  if (!steps.length) return undefined;
  const progressOf = (step: Step, key = step.key) => {
    if (history && step.keys.includes(history.key) && key === history.key) return {position: history.position, duration: history.duration};
    const saved = readProgress(key);
    return saved && saved.duration > 0 ? saved : undefined;
  };
  let index = history ? steps.findIndex(step => step.keys.includes(history.key)) : -1;
  // Progress saved before library history existed can still give a resume point.
  if (index < 0) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const saved = progressOf(steps[i]);
      if (saved && saved.position > 0) {
        index = i;
        break;
      }
    }
  }
  const updatedAt = history?.updatedAt || 0;
  if (index < 0) return {mode: 'start', key: steps[0].key, episode: steps[0].episode, position: 0, duration: 0, updatedAt};
  const key = history && steps[index].keys.includes(history.key) ? history.key : steps[index].key;
  let progress = progressOf(steps[index], key);
  if (!progress || !isWatchedProgress(progress.position, progress.duration)) {
    return {
      mode: progress && progress.position > 0 ? 'resume' : 'start',
      key,
      episode: steps[index].episode,
      position: progress?.position || 0,
      duration: progress?.duration || 0,
      ...(progress ? {progress: progress.position / progress.duration, remainingSeconds: Math.max(0, progress.duration - progress.position)} : {}),
      updatedAt,
    };
  }
  let next = index + 1;
  while (next < steps.length) {
    const seen = progressOf(steps[next]);
    if (!seen || !isWatchedProgress(seen.position, seen.duration)) break;
    next += 1;
  }
  if (next >= steps.length) return {mode: 'start', key: steps[0].key, episode: steps[0].episode, position: 0, duration: 0, updatedAt, finished: true};
  progress = progressOf(steps[next]);
  return {
    mode: progress && progress.position > 0 ? 'resume' : 'next',
    key: steps[next].key,
    episode: steps[next].episode,
    position: progress?.position || 0,
    duration: progress?.duration || 0,
    ...(progress ? {progress: progress.position / progress.duration, remainingSeconds: Math.max(0, progress.duration - progress.position)} : {}),
    updatedAt,
  };
};

/** A Continue Watching row, the same shape the provider rows use. */
export interface NetlibContinueRow {
  id: string;
  title: string;
  episodeTitle?: string;
  seasonTitle?: string;
  episode: {id: string; link: string; title: string};
  type: string;
  poster?: string;
  background?: string;
  providerValue: string;
  infoUrl: string;
  position: number;
  duration: number;
  updatedAt: number;
}

/**
 * Continue Watching rows for library titles, from library history: the file
 * left part way, or the next episode or part once one is watched. Finished
 * titles, removed rows and titles no longer in a library are left out.
 */
export const netlibContinueWatchingRows = (
  entries: NetlibHistoryEntry[],
  findItem: (id: string) => NetlibItem | undefined,
  readProgress: ReadProgress,
): NetlibContinueRow[] =>
  entries.flatMap(entry => {
    if (entry.hidden) return [];
    const item = findItem(entry.itemId);
    if (!item) return [];
    const target = netlibResume(item, readProgress, entry);
    if (!target || target.finished || target.mode === 'start') return [];
    const link = netlibLink(item.id);
    const label = target.episode ? episodeLabel(target.episode) : itemTitle(item);
    return [
      {
        id: link,
        infoUrl: link,
        providerValue: NETLIB_PROVIDER,
        title: itemTitle(item),
        ...(target.episode ? {episodeTitle: label, seasonTitle: target.episode.season === 0 ? 'Specials' : `Season ${target.episode.season}`} : {}),
        episode: {id: target.key, link: target.key, title: label},
        type: item.kind === 'show' ? 'series' : 'movie',
        ...(item.match?.poster ? {poster: item.match.poster} : {}),
        ...(item.match?.background ? {background: item.match.background} : {}),
        position: target.position,
        duration: target.duration,
        updatedAt: entry.updatedAt,
      },
    ];
  });
