/**
 * Runs the "Keep next episodes ready" rules of the profile in use: when the
 * app opens or comes back, after watch progress changes, and every half hour
 * while the app or the download service keeps JavaScript running.
 */
import {AppState} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type {Link} from '../providers/types';
import {providerManager} from '../services/ProviderManager';
import {cacheStorage, watchProgressStorage} from '../storage';
import useDownloadsStore from '../zustand/downloadsStore';
import {nextSeasonTitle, numberEpisodes, parseSeasonNumber, type SeasonEpisode} from './episodes';
import {downloadStateOf, episodeDownloadId, findExistingEpisodeDownload, queueEpisodeDownload, resolveEpisodeStream, type ShowInfo} from './queue';
import {MAX_EPISODE_FAILURES, planRollingStep, type RollingEpisode} from './rolling';
import {readSeriesRules, readSeriesSettings, updateSeriesRule, type SeriesRule} from './rules';

/** Watched at 90% or more, or marked watched. */
export const WATCHED_FRACTION = 0.9;
const GB = 1024 ** 3;
const INTERVAL_MS = 30 * 60 * 1000;
const PROGRESS_DEBOUNCE_MS = 20 * 1000;

export const isWatchedProgress = (progress: {position: number; duration: number} | null | undefined): boolean =>
  Boolean(progress && progress.duration > 0 && progress.position / progress.duration >= WATCHED_FRACTION);

/** An episode counts as watched from its online link or from its downloaded file. */
export const isEpisodeWatched = (show: ShowInfo, episode: Pick<RollingEpisode, 'link' | 'seasonTitle' | 'index' | 'title' | 'episode'>): boolean => {
  if (isWatchedProgress(watchProgressStorage.getProgress(episode.link))) return true;
  const item = findExistingEpisodeDownload(show, {...episode, season: undefined});
  return Boolean(item?.filePath && isWatchedProgress(watchProgressStorage.getProgress(item.filePath)));
};

export interface EpisodeWindowDeps {
  seasonTitles: string[];
  loadSeason: (title: string) => Promise<SeasonEpisode[]>;
  isWatched: (episode: RollingEpisode) => boolean;
}

const toRolling = (show: Pick<ShowInfo, 'showTitle'>, seasonTitle: string, episodes: SeasonEpisode[]): RollingEpisode[] =>
  numberEpisodes(episodes, seasonTitle).map(episode => ({
    link: episode.link,
    title: episode.title,
    index: episode.index,
    seasonTitle,
    season: episode.season,
    episode: episode.episode,
    skip: episode.skip,
    downloadId: episodeDownloadId(show, {seasonTitle, index: episode.index}),
  }));

/** The rule's season in the provider's list now, by title or else by season number. */
export const matchSeasonTitle = (titles: string[], wanted: string): string | undefined => {
  if (titles.includes(wanted)) return wanted;
  const number = parseSeasonNumber(wanted);
  return number === undefined ? undefined : titles.find(title => parseSeasonNumber(title) === number);
};

/**
 * Episodes the rule looks at: the followed season, moved on to the next
 * season when every episode is watched, plus the next season's episodes when
 * the current one has fewer than [keep] left.
 */
export const loadEpisodeWindow = async (
  show: Pick<ShowInfo, 'showTitle'>,
  seasonTitle: string,
  keep: number,
  deps: EpisodeWindowDeps,
): Promise<{seasonTitle: string; episodes: RollingEpisode[]}> => {
  let current = matchSeasonTitle(deps.seasonTitles, seasonTitle) ?? seasonTitle;
  let episodes = toRolling(show, current, await deps.loadSeason(current));
  for (let hops = 0; hops < 3 && episodes.length && episodes.every(deps.isWatched); hops++) {
    const next = nextSeasonTitle(deps.seasonTitles, current);
    if (!next) break;
    const nextEpisodes = toRolling(show, next, await deps.loadSeason(next));
    if (!nextEpisodes.length) break;
    current = next;
    episodes = nextEpisodes;
  }
  let lastWatched = -1;
  episodes.forEach((episode, index) => {
    if (deps.isWatched(episode)) lastWatched = index;
  });
  const left = episodes.slice(lastWatched + 1).filter(episode => !deps.isWatched(episode)).length;
  if (left < keep) {
    const next = nextSeasonTitle(deps.seasonTitles, current);
    if (next) episodes = [...episodes, ...toRolling(show, next, await deps.loadSeason(next).catch(() => []))];
  }
  return {seasonTitle: current, episodes};
};

const readCachedInfo = (rule: SeriesRule): {linkList?: Link[]} | undefined => {
  try {
    const raw = cacheStorage.getString(`contentInfo:${rule.provider}:${rule.infoUrl}`);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
};

const loadSeasons = async (rule: SeriesRule, signal: AbortSignal): Promise<Link[]> => {
  try {
    const info = await providerManager.getMetaData({link: rule.infoUrl, provider: rule.provider, signal});
    if (Array.isArray(info?.linkList) && info.linkList.length) return info.linkList;
  } catch (error) {
    console.warn('[SeriesDownloads] Could not load the title page', error);
  }
  const cached = readCachedInfo(rule)?.linkList;
  return Array.isArray(cached) ? cached : [];
};

const loadSeasonEpisodes = async (rule: SeriesRule, season: Link | undefined, signal: AbortSignal): Promise<SeasonEpisode[]> => {
  if (!season) return [];
  const raw = season.episodesLink
    ? await providerManager.getEpisodes({url: season.episodesLink, providerValue: rule.provider, signal})
    : season.directLinks || [];
  return (Array.isArray(raw) ? raw : [])
    .map((episode, index) => ({title: episode?.title, link: episode?.link, index, skip: (episode as {skip?: unknown})?.skip}))
    .filter(episode => episode.title && episode.link) as SeasonEpisode[];
};

const freeBytes = async (): Promise<number | undefined> => {
  try {
    const bytes = await FileSystem.getFreeDiskStorageAsync();
    return Number.isFinite(bytes) && bytes > 0 ? bytes : undefined;
  } catch {
    return undefined;
  }
};

const onWifi = async (): Promise<boolean> => {
  try {
    const {torrentManager} = require('../torrentManager') as typeof import('../torrentManager');
    return await torrentManager.isOnWifi();
  } catch {
    return true;
  }
};

const showOf = (rule: SeriesRule): ShowInfo => ({
  showTitle: rule.showTitle,
  provider: rule.provider,
  infoUrl: rule.infoUrl,
  type: rule.type,
  poster: rule.poster,
  background: rule.background,
  imdbId: rule.imdbId,
  synopsis: rule.synopsis,
});

/** One run of one rule. */
export const runSeriesRule = async (rule: SeriesRule, signal = new AbortController().signal): Promise<void> => {
  if (rule.paused) {
    updateSeriesRule(rule.id, {lastStatus: 'paused', lastRunAt: Date.now()});
    return;
  }
  const show = showOf(rule);
  const linkList = await loadSeasons(rule, signal);
  const titles = linkList.map(item => item.title).filter(Boolean);
  const isWatched = (episode: RollingEpisode) => isEpisodeWatched(show, episode);
  const window = await loadEpisodeWindow(show, rule.seasonTitle, rule.keep, {
    seasonTitles: titles,
    isWatched,
    loadSeason: title => loadSeasonEpisodes(rule, linkList.find(item => item.title === title), signal),
  });
  const settings = readSeriesSettings();
  const stateOf = (episode: RollingEpisode) => downloadStateOf(findExistingEpisodeDownload(show, {...episode}));
  const plan = planRollingStep({
    rule,
    episodes: window.episodes,
    isWatched,
    downloadState: stateOf,
    gates: {wifiOnly: settings.wifiOnly, onWifi: await onWifi(), freeBytes: await freeBytes(), minFreeBytes: settings.minFreeGb * GB},
  });

  const owned = {...rule.owned};
  const failures = {...rule.failures};
  if (plan.remove.length) {
    const {deleteDownloadedItemAndSubtitles} = require('../../screens/downloads/utils/deleteDownloadedItem') as typeof import('../../screens/downloads/utils/deleteDownloadedItem');
    for (const episode of plan.remove) {
      const item = findExistingEpisodeDownload(show, {...episode});
      if (!item) continue;
      await deleteDownloadedItemAndSubtitles(item).catch(error => console.warn('[SeriesDownloads] Could not delete a watched episode', error));
      delete owned[episode.downloadId];
    }
  }
  let lastError: string | undefined;
  for (const episode of plan.queue) {
    if (signal.aborted) break;
    try {
      const stream = await resolveEpisodeStream(show, episode, rule.choice, signal);
      if (!stream) throw new Error(`No stream found for ${episode.title}`);
      const id = await queueEpisodeDownload(show, episode, stream, signal);
      owned[id] = episode.link;
      delete failures[episode.link];
    } catch (error) {
      failures[episode.link] = Math.min(MAX_EPISODE_FAILURES, (failures[episode.link] || 0) + 1);
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  updateSeriesRule(rule.id, {
    seasonTitle: window.seasonTitle,
    owned,
    failures,
    lastRunAt: Date.now(),
    lastStatus: plan.status,
    lastReady: plan.target.filter(episode => stateOf(episode) === 'completed').length,
    lastTotal: plan.target.length,
    lastError,
  });
};

let running: Promise<void> | undefined;
let again = false;

/** Runs every rule once; a request during a run starts one more run after it. */
export const runSeriesDownloads = (): Promise<void> => {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      for (const rule of readSeriesRules()) {
        try {
          await runSeriesRule(rule);
        } catch (error) {
          updateSeriesRule(rule.id, {lastRunAt: Date.now(), lastError: error instanceof Error ? error.message : String(error)});
        }
      }
    } while (again);
  })().finally(() => {
    running = undefined;
  });
  return running;
};

let started = false;

/** Starts the triggers once per app launch. Nothing runs without a rule. */
export const startSeriesDownloads = (): (() => void) => {
  if (started) return () => undefined;
  started = true;
  const run = () => {
    if (readSeriesRules().length) runSeriesDownloads().catch(() => undefined);
  };
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribeProgress = watchProgressStorage.subscribe(() => {
    if (progressTimer) clearTimeout(progressTimer);
    progressTimer = setTimeout(run, PROGRESS_DEBOUNCE_MS);
  });
  // A finished download frees a queue slot; a removed one may need replacing.
  let completed = Object.values(useDownloadsStore.getState().downloads).filter(item => item.status === 'completed').length;
  const unsubscribeDownloads = useDownloadsStore.subscribe(state => {
    const now = Object.values(state.downloads).filter(item => item.status === 'completed').length;
    if (now < completed) run();
    completed = now;
  });
  const appState = AppState.addEventListener('change', state => {
    if (state === 'active') run();
  });
  const interval = setInterval(run, INTERVAL_MS);
  const first = setTimeout(run, 8000);
  return () => {
    started = false;
    if (progressTimer) clearTimeout(progressTimer);
    clearTimeout(first);
    clearInterval(interval);
    unsubscribeProgress();
    unsubscribeDownloads();
    appState.remove();
  };
};
