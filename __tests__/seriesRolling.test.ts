import {describe, expect, it, jest} from '@jest/globals';

jest.mock('../src/lib/services/ProviderManager', () => ({providerManager: {}}));
jest.mock('../src/lib/storage', () => ({
  cacheStorage: {getString: () => undefined},
  watchProgressStorage: {getProgress: () => null, subscribe: () => () => undefined},
}));
jest.mock('../src/lib/zustand/downloadsStore', () => ({__esModule: true, default: {getState: () => ({downloads: {}}), subscribe: () => () => undefined}}));
jest.mock('../src/lib/seriesDownloads/queue', () => ({
  episodeDownloadId: (show: {showTitle: string}, episode: {seasonTitle: string; index: number}) => `${show.showTitle}_S${episode.seasonTitle}_E${episode.index + 1}`,
  downloadStateOf: () => 'none',
  findExistingEpisodeDownload: () => undefined,
  queueEpisodeDownload: jest.fn(),
  resolveEpisodeStream: jest.fn(),
}));

import {planRollingStep, rollingStatusText, type EpisodeDownloadState, type RollingEpisode, type RollingGates} from '../src/lib/seriesDownloads/rolling';
import {isWatchedProgress, loadEpisodeWindow, matchSeasonTitle} from '../src/lib/seriesDownloads/runner';

const episodes: RollingEpisode[] = Array.from({length: 6}, (_, index) => ({
  link: `e${index + 1}`,
  downloadId: `d${index + 1}`,
  title: `Episode ${index + 1}`,
  seasonTitle: 'Season 1',
  season: 1,
  episode: index + 1,
  index,
}));

const okGates: RollingGates = {wifiOnly: true, onWifi: true, freeBytes: 50 * 1024 ** 3, minFreeBytes: 2 * 1024 ** 3};

const plan = ({
  watched = [] as string[],
  states = {} as Record<string, EpisodeDownloadState>,
  keep = 2,
  deleteAfterWatching = false,
  paused = false,
  owned = {} as Record<string, string>,
  failures = {} as Record<string, number>,
  gates = okGates,
} = {}) =>
  planRollingStep({
    rule: {keep, deleteAfterWatching, paused, owned, failures},
    episodes,
    isWatched: episode => watched.includes(episode.link),
    downloadState: episode => states[episode.link] || 'none',
    gates,
  });

const links = (list: RollingEpisode[]) => list.map(episode => episode.link);

describe('rolling downloads', () => {
  it('queues the next episodes when nothing is watched', () => {
    const result = plan();
    expect(links(result.queue)).toEqual(['e1', 'e2']);
    expect(result.status).toBe('downloading');
  });

  it('watched episode: deletes it (when asked) and queues the next one', () => {
    const result = plan({
      watched: ['e1'],
      states: {e1: 'completed', e2: 'completed'},
      deleteAfterWatching: true,
      owned: {d1: 'e1', d2: 'e2'},
    });
    expect(links(result.remove)).toEqual(['e1']);
    expect(links(result.target)).toEqual(['e2', 'e3']);
    expect(links(result.queue)).toEqual(['e3']);
  });

  it('keeps watched downloads when delete after watching is off', () => {
    const result = plan({watched: ['e1'], states: {e1: 'completed'}, owned: {d1: 'e1'}});
    expect(result.remove).toEqual([]);
  });

  it('never deletes a download the rule did not make', () => {
    const result = plan({watched: ['e1'], states: {e1: 'completed'}, deleteAfterWatching: true});
    expect(result.remove).toEqual([]);
  });

  it('does not queue twice what is downloading or done', () => {
    const result = plan({states: {e1: 'active', e2: 'completed'}});
    expect(result.queue).toEqual([]);
    expect(result.status).toBe('downloading');
    expect(result.ready).toBe(1);
    expect(plan({states: {e1: 'completed', e2: 'completed'}}).status).toBe('ready');
  });

  it('waits for Wi-Fi', () => {
    const result = plan({gates: {...okGates, onWifi: false}});
    expect(result.queue).toEqual([]);
    expect(result.status).toBe('waiting-wifi');
    expect(plan({gates: {...okGates, onWifi: false, wifiOnly: false}}).queue).toHaveLength(2);
  });

  it('stops below the free space limit but still deletes watched episodes', () => {
    const result = plan({
      watched: ['e1'],
      states: {e1: 'completed'},
      deleteAfterWatching: true,
      owned: {d1: 'e1'},
      gates: {...okGates, freeBytes: 1024 ** 3},
    });
    expect(result.status).toBe('low-storage');
    expect(result.queue).toEqual([]);
    expect(links(result.remove)).toEqual(['e1']);
  });

  it('does nothing while paused', () => {
    const result = plan({paused: true, watched: ['e1'], states: {e1: 'completed'}, deleteAfterWatching: true, owned: {d1: 'e1'}});
    expect(result).toMatchObject({status: 'paused', queue: [], remove: []});
  });

  it('retries a failed episode, then skips it after two failures', () => {
    expect(links(plan({states: {e1: 'failed'}, failures: {e1: 1}}).queue)).toEqual(['e1', 'e2']);
    expect(links(plan({failures: {e1: 2}}).queue)).toEqual(['e2', 'e3']);
  });

  it('is caught up when every episode is watched', () => {
    expect(plan({watched: links(episodes)}).status).toBe('caught-up');
  });

  it('clamps keep to 1–5', () => {
    expect(plan({keep: 9}).queue).toHaveLength(5);
    expect(plan({keep: 0}).queue).toHaveLength(1);
  });

  it('has short status lines', () => {
    expect(rollingStatusText('ready', 2, 2)).toBe('2 of 2 ready');
    expect(rollingStatusText('waiting-wifi', 0, 2)).toBe('Waiting for Wi-Fi');
    expect(rollingStatusText(undefined, 0, 0)).toBe('Not checked yet');
  });
});

describe('rolling episode window', () => {
  const seasonData: Record<string, {title: string; link: string; index: number}[]> = {
    'Season 1': [1, 2, 3].map(n => ({title: `Episode ${n}`, link: `s1e${n}`, index: n - 1})),
    'Season 2': [1, 2, 3].map(n => ({title: `Episode ${n}`, link: `s2e${n}`, index: n - 1})),
  };
  const deps = (watched: string[]) => ({
    seasonTitles: ['Season 1', 'Season 2'],
    loadSeason: async (title: string) => seasonData[title] || [],
    isWatched: (episode: RollingEpisode) => watched.includes(episode.link),
  });

  it('adds the next season when the current one runs short', async () => {
    const window = await loadEpisodeWindow({showTitle: 'Show'}, 'Season 1', 2, deps(['s1e1', 's1e2']));
    expect(window.seasonTitle).toBe('Season 1');
    expect(window.episodes.map(episode => episode.link)).toEqual(['s1e1', 's1e2', 's1e3', 's2e1', 's2e2', 's2e3']);
    expect(window.episodes[3]).toMatchObject({season: 2, episode: 1, downloadId: 'Show_SSeason 2_E1'});
  });

  it('moves to the next season once the current one is watched', async () => {
    const window = await loadEpisodeWindow({showTitle: 'Show'}, 'Season 1', 1, deps(['s1e1', 's1e2', 's1e3']));
    expect(window.seasonTitle).toBe('Season 2');
    expect(window.episodes[0].link).toBe('s2e1');
  });

  it('finds a renamed season by its number', () => {
    expect(matchSeasonTitle(['Season 1 [1080p]', 'Season 2 [1080p]'], 'Season 2')).toBe('Season 2 [1080p]');
    expect(matchSeasonTitle(['Specials'], 'Season 2')).toBeUndefined();
  });

  it('counts 90% as watched', () => {
    expect(isWatchedProgress({position: 90, duration: 100})).toBe(true);
    expect(isWatchedProgress({position: 1, duration: 1})).toBe(true);
    expect(isWatchedProgress({position: 80, duration: 100})).toBe(false);
    expect(isWatchedProgress(null)).toBe(false);
  });
});
