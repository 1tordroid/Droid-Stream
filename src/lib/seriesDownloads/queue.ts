/**
 * Finds one episode's stream like the source picked for the show and queues
 * it through the download manager, with its subtitle when the stream has one.
 */
import {createSeriesDownloadId} from '../downloadId';
import {findEpisodeDownload} from '../downloadLibrary';
import type {SkipInterval, Stream} from '../providers/types';
import {queueQuickDownload} from '../quickDownload';
import {providerManager} from '../services/ProviderManager';
import useDownloadsStore, {CURRENT_DOWNLOAD_STATUSES, type DownloadItem} from '../zustand/downloadsStore';
import {episodeFileName, episodeTag, seasonFolderName} from './episodes';
import type {EpisodeDownloadState} from './rolling';
import {pickStream, serverFamily, type SourceChoice} from './sourceChoice';

export interface ShowInfo {
  showTitle: string;
  provider: string;
  /** The title page link. */
  infoUrl: string;
  type: string;
  poster?: string;
  background?: string;
  imdbId?: string;
  synopsis?: string;
}

export interface EpisodeTarget {
  title: string;
  link: string;
  /** Position in the provider's raw list. */
  index: number;
  seasonTitle: string;
  season?: number;
  episode: number;
  skip?: SkipInterval[];
}

/** Same id the episode row's own download button uses, so both see one download. */
export const episodeDownloadId = (show: Pick<ShowInfo, 'showTitle'>, episode: Pick<EpisodeTarget, 'seasonTitle' | 'index'>): string =>
  createSeriesDownloadId(show.showTitle, episode.seasonTitle, episode.index);

export const findExistingEpisodeDownload = (show: ShowInfo, episode: EpisodeTarget): DownloadItem | undefined =>
  findEpisodeDownload(Object.values(useDownloadsStore.getState().downloads), {
    downloadId: episodeDownloadId(show, episode),
    infoUrl: show.infoUrl,
    link: episode.link,
    seasonTitle: episode.seasonTitle,
    episodeName: episode.title,
  });

export const downloadStateOf = (item: DownloadItem | undefined): EpisodeDownloadState => {
  if (!item) return 'none';
  if (item.status === 'completed') return 'completed';
  if (item.status === 'error') return 'failed';
  if (item.status === 'missing') return 'none';
  return CURRENT_DOWNLOAD_STATUSES.has(item.status) ? 'active' : 'none';
};

/** Already downloaded or on its way. */
export const isEpisodeQueued = (show: ShowInfo, episode: EpisodeTarget): boolean => {
  const state = downloadStateOf(findExistingEpisodeDownload(show, episode));
  return state === 'completed' || state === 'active';
};

export const fetchProviderStreams = async (show: ShowInfo, link: string, signal?: AbortSignal): Promise<Stream[]> => {
  const streams = await providerManager.getStream({
    link,
    type: show.type,
    providerValue: show.provider,
    signal: signal ?? new AbortController().signal,
    isDownload: true,
  });
  return Array.isArray(streams) ? streams : [];
};

/**
 * With no provider stream, the stream finder (add-ons, debrid caches): the
 * Play best list, the source closest to the chosen server and quality first.
 */
const finderStream = async (show: ShowInfo, episode: EpisodeTarget, choice?: SourceChoice): Promise<Stream | undefined> => {
  if (!show.imdbId || episode.season === undefined) return undefined;
  const {findSources} = require('../streams/finder') as typeof import('../streams/finder');
  const {planPlayBest, resolveCandidateStream} = require('../streams/play') as typeof import('../streams/play');
  const want = {title: show.showTitle, type: 'series' as const, imdbId: show.imdbId, season: episode.season, episode: episode.episode};
  const ranked = await findSources(want);
  const plan = planPlayBest(ranked, want);
  const family = serverFamily(choice?.server);
  const wantedResolution = choice?.quality ? `${choice.quality}p` : undefined;
  const ordered = [...plan.candidates].sort((a, b) => {
    const score = (candidate: (typeof plan.candidates)[number]) =>
      (family && serverFamily(candidate.origin) === family ? 2 : 0) + (wantedResolution && candidate.resolution === wantedResolution ? 1 : 0);
    return score(b) - score(a);
  });
  for (const candidate of ordered.slice(0, 3)) {
    try {
      return await resolveCandidateStream(candidate, want);
    } catch {
      // Try the next source.
    }
  }
  return undefined;
};

/** The episode's stream most like [choice]: provider streams first, then the stream finder. */
export const resolveEpisodeStream = async (
  show: ShowInfo,
  episode: EpisodeTarget,
  choice?: SourceChoice,
  signal?: AbortSignal,
  known?: Stream[],
): Promise<Stream | undefined> => {
  const streams = known ?? (await fetchProviderStreams(show, episode.link, signal).catch(() => [] as Stream[]));
  if (signal?.aborted) return undefined;
  const picked = pickStream(streams, choice);
  if (picked) return picked;
  return finderStream(show, episode, choice).catch(() => undefined);
};

/** Queues the episode with names like "Show/Season 01/S01E02 Title.mp4". */
export const queueEpisodeDownload = async (show: ShowInfo, episode: EpisodeTarget, stream: Stream, signal?: AbortSignal): Promise<string> => {
  const downloadId = episodeDownloadId(show, episode);
  const tag = episodeTag(episode.season, episode.episode);
  await queueQuickDownload(
    {
      downloadId,
      title: `${show.showTitle} ${tag}`,
      showName: show.showTitle,
      episodeName: episode.title,
      seasonTitle: seasonFolderName(episode.seasonTitle),
      episodeIndex: episode.index,
      mediaType: 'series',
      imdbId: show.imdbId,
      poster: show.poster,
      background: show.background,
      synopsis: show.synopsis,
      provider: show.provider,
      infoUrl: show.infoUrl,
      sourceLink: episode.link,
      skip: episode.skip,
      fileName: episodeFileName(episode.season, episode.episode, episode.title),
      deleteDownload: () => undefined,
    },
    stream,
    signal,
  );
  return downloadId;
};

export interface BatchResult {
  queued: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
}

/**
 * Queues several episodes one after another. The first episode can reuse the
 * streams already loaded for the source picker.
 */
export const queueEpisodes = async (
  show: ShowInfo,
  episodes: EpisodeTarget[],
  choice: SourceChoice | undefined,
  options: {signal?: AbortSignal; onProgress?: (done: number, total: number) => void; known?: {link: string; streams: Stream[]}} = {},
): Promise<BatchResult> => {
  const result: BatchResult = {queued: 0, skipped: 0, failed: 0, cancelled: false};
  for (let index = 0; index < episodes.length; index++) {
    if (options.signal?.aborted) return {...result, cancelled: true};
    options.onProgress?.(index + 1, episodes.length);
    const episode = episodes[index];
    if (isEpisodeQueued(show, episode)) {
      result.skipped++;
      continue;
    }
    try {
      const known = options.known?.link === episode.link ? options.known.streams : undefined;
      const stream = await resolveEpisodeStream(show, episode, choice, options.signal, known);
      if (options.signal?.aborted) return {...result, cancelled: true};
      if (!stream) {
        result.failed++;
        continue;
      }
      await queueEpisodeDownload(show, episode, stream, options.signal);
      result.queued++;
    } catch (error) {
      if (options.signal?.aborted) return {...result, cancelled: true};
      console.warn('[SeriesDownloads] Could not queue episode', error);
      result.failed++;
    }
  }
  return result;
};

export const batchMessage = ({queued, skipped, failed}: BatchResult): string => {
  const parts = [`Queued ${queued} episode${queued === 1 ? '' : 's'}`];
  if (skipped) parts.push(`${skipped} already downloaded`);
  if (failed) parts.push(`${failed} not found`);
  return parts.join(', ');
};
