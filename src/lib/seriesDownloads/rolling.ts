/**
 * "Keep next episodes ready": one step of a show's rule. Given the episodes in
 * order, which are watched and which are downloaded, it says what to delete,
 * what to queue and what to show. No side effects, so the runner and the tests
 * share it.
 */
import type {SkipInterval} from '../providers/types';

export type EpisodeDownloadState = 'none' | 'active' | 'completed' | 'failed';

export type RollingStatus =
  | 'paused'
  | 'waiting-wifi'
  | 'low-storage'
  | 'downloading'
  | 'ready'
  | 'caught-up';

export interface RollingEpisode {
  /** The episode link: also the watch progress key. */
  link: string;
  downloadId: string;
  title: string;
  seasonTitle: string;
  season?: number;
  episode: number;
  index: number;
  skip?: SkipInterval[];
}

export interface RollingRuleState {
  keep: number;
  deleteAfterWatching: boolean;
  paused: boolean;
  /** Downloads this rule queued (download id → episode link). Only these are deleted. */
  owned: Record<string, string>;
  /** Failed attempts per episode link. */
  failures: Record<string, number>;
}

export interface RollingGates {
  wifiOnly: boolean;
  onWifi: boolean;
  /** Free bytes on the device, when known. */
  freeBytes?: number;
  minFreeBytes: number;
}

export interface RollingInput {
  rule: RollingRuleState;
  episodes: RollingEpisode[];
  isWatched: (episode: RollingEpisode) => boolean;
  downloadState: (episode: RollingEpisode) => EpisodeDownloadState;
  gates: RollingGates;
}

export interface RollingPlan {
  status: RollingStatus;
  /** Watched episodes whose download goes. */
  remove: RollingEpisode[];
  /** Episodes to queue now. */
  queue: RollingEpisode[];
  /** The episodes the rule keeps ready. */
  target: RollingEpisode[];
  /** How many of the target are downloaded. */
  ready: number;
}

/** After this many failed tries an episode is skipped. */
export const MAX_EPISODE_FAILURES = 2;
export const MIN_KEEP = 1;
export const MAX_KEEP = 5;

export const clampKeep = (value: number): number => Math.max(MIN_KEEP, Math.min(MAX_KEEP, Math.round(value) || MIN_KEEP));

export const planRollingStep = ({rule, episodes, isWatched, downloadState, gates}: RollingInput): RollingPlan => {
  const keep = clampKeep(rule.keep);
  const remove = rule.deleteAfterWatching
    ? episodes.filter(episode => rule.owned[episode.downloadId] !== undefined && isWatched(episode) && downloadState(episode) === 'completed')
    : [];

  let lastWatched = -1;
  episodes.forEach((episode, index) => {
    if (isWatched(episode)) lastWatched = index;
  });
  const skipped = (episode: RollingEpisode) =>
    (rule.failures[episode.link] || 0) >= MAX_EPISODE_FAILURES && downloadState(episode) !== 'completed' && downloadState(episode) !== 'active';
  const target = episodes
    .slice(lastWatched + 1)
    .filter(episode => !isWatched(episode) && !skipped(episode))
    .slice(0, keep);
  const states = target.map(downloadState);
  const ready = states.filter(state => state === 'completed').length;
  const missing = target.filter((_, index) => states[index] === 'none' || states[index] === 'failed');

  const result = (status: RollingStatus, queue: RollingEpisode[] = []): RollingPlan => ({status, remove, queue, target, ready});
  // A paused rule changes nothing, deletions included.
  if (rule.paused) return {status: 'paused', remove: [], queue: [], target, ready};
  if (!target.length) return result('caught-up');
  if (!missing.length) return result(ready === target.length ? 'ready' : 'downloading');
  if (gates.wifiOnly && !gates.onWifi) return result('waiting-wifi');
  if (gates.freeBytes !== undefined && gates.freeBytes < gates.minFreeBytes) return result('low-storage');
  return result('downloading', missing);
};

/** Short status line for the rule's card. */
export const rollingStatusText = (status: RollingStatus | undefined, ready: number, total: number): string => {
  switch (status) {
    case 'paused':
      return 'Paused';
    case 'waiting-wifi':
      return 'Waiting for Wi-Fi';
    case 'low-storage':
      return 'Stopped: low storage';
    case 'caught-up':
      return 'Up to date. Waiting for new episodes';
    case 'ready':
      return `${ready} of ${total} ready`;
    case 'downloading':
      return `${ready} of ${total} ready, downloading`;
    default:
      return 'Not checked yet';
  }
};
