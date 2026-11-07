import {directLink, getService} from '../debrid';
import {archiveDirectVideo} from '../torrentSearch/archive';
import {resolveDebrid, toast} from '../torrentSearch/actions';
import {torrentManager} from '../torrentManager';
import type {WatchMeta} from '../watchMeta';
import {candidateToResult, debridFor, pickEpisodeFile, preloadNext, readPrefs, type Candidate, type WantedVideo} from './finder';
import {VIDEO_FILE} from '../debrid/types';
import type {Stream} from '../providers/types';
import {buildFallbackList, DEFAULT_FALLBACK_TIMEOUTS, nextSourceMessage, type FallbackTimeouts} from './fallback';
import {recentFailures, rememberFailure} from './failedSources';

/**
 * Handed to the player with a Play best start: the sources to fall back on,
 * in order, and which one is playing.
 */
export interface PlayBestPlan {
  want: WantedVideo;
  candidates: Candidate[];
  index: number;
  timeouts: FallbackTimeouts;
}

const metaOf = (want: WantedVideo): WatchMeta => ({
  title: want.title,
  type: want.type,
  year: want.year,
  imdbId: want.imdbId,
  season: want.season,
  episode: want.episode,
});

const label = (want: WantedVideo, fileName: string): string =>
  want.type === 'series' && want.season !== undefined && want.episode !== undefined
    ? `S${want.season}:E${want.episode}${fileName ? ` · ${fileName}` : ''}`
    : fileName || want.title;

const streamType = (url: string): string => (/\.m3u8(\?|$)/i.test(url) ? 'm3u8' : 'mp4');

const openPlayer = (navigation: any, want: WantedVideo, url: string, server: string, fileName: string, headers?: Record<string, string>, playBest?: PlayBestPlan) =>
  navigation.navigate('Player', {
    linkIndex: 0,
    episodeList: [{title: label(want, fileName), link: url}],
    directUrl: url,
    type: want.type,
    primaryTitle: want.title,
    secondaryTitle: want.season !== undefined ? `Season ${want.season}` : undefined,
    poster: want.poster ? {poster: want.poster} : {},
    initialStream: {server, link: url, type: streamType(url), headers},
    meta: metaOf(want),
    ...(playBest ? {playBest} : {}),
  });

const finishPlay = (options: {next?: WantedVideo}): void => {
  if (options.next) {
    preloadNext(options.next).catch(() => undefined);
    toast('Preparing the next episode in the background');
  }
};

/**
 * Plays one candidate: direct links open at once; torrents go through a
 * debrid when one has it (or is set for uncached torrents), otherwise the
 * on-device torrent client streams it.
 */
export const playCandidate = async (
  candidate: Candidate,
  want: WantedVideo,
  navigation: any,
  options: {next?: WantedVideo; onStatus?: (text: string) => void; forcePhone?: boolean; playBest?: PlayBestPlan} = {},
): Promise<void> => {
  const status = options.onStatus || (() => undefined);
  const plan = options.playBest;
  if (candidate.kind === 'direct' && candidate.url) {
    openPlayer(navigation, want, candidate.url, candidate.origin, candidate.title, candidate.headers, plan);
    return finishPlay(options);
  }
  const archived = await archiveDirectVideo(candidate.torrentUrl);
  if (archived) {
    openPlayer(navigation, want, archived.url, 'Internet Archive', archived.name, undefined, plan);
  } else {
    const result = candidateToResult(candidate);
    const service = options.forcePhone || !candidate.magnet ? undefined : debridFor(candidate);
    if (service) {
      status(`Asking ${getService(service).name}…`);
      const resolution = await resolveDebrid(result, service, progress => status(`${getService(service).name}: ${progress.percent}% · ${progress.status}`));
      const file = pickEpisodeFile(resolution.files, want);
      if (!file) throw new Error('No video in this torrent');
      openPlayer(navigation, want, await directLink(resolution, file), resolution.service.name, file.name, undefined, plan);
    } else {
      status('Starting the torrent on this phone…');
      const source = candidate.magnet || result.magnet || candidate.torrentUrl || '';
      const added = await torrentManager.addTorrent(source);
      const files = added.files?.length ? added.files : await torrentManager.getFiles(added.infoHash);
      const byIndex = candidate.fileIdx !== undefined ? files.find((file: any) => file.index === candidate.fileIdx) : undefined;
      const video = byIndex || pickEpisodeFile(files.filter((file: any) => VIDEO_FILE.test(file.name)), want) || files[0];
      if (!video) throw new Error('No video in this torrent yet');
      await torrentManager.prepareVideoFile(added.infoHash, video.index, false, false);
      const url = await torrentManager.getStreamUrl(added.infoHash, video.index);
      navigation.navigate('Player', {
        linkIndex: 0,
        episodeList: [{title: label(want, video.name), link: source}],
        directUrl: url,
        type: 'torrent',
        primaryTitle: want.title,
        poster: want.poster ? {poster: want.poster} : {},
        initialStream: {server: 'Torrent', link: source, type: 'torrent'},
        meta: metaOf(want),
        ...(plan ? {playBest: plan} : {}),
      });
    }
  }
  finishPlay(options);
};

/**
 * Turns a fallback source into a stream the open player can switch to. Cached
 * torrents go through the debrid that holds them; other torrents stream on the
 * phone, which the player starts itself, since waiting on an uncached debrid
 * download would stall the fallback.
 */
export const resolveCandidateStream = async (candidate: Candidate, want: WantedVideo): Promise<Stream> => {
  if (candidate.kind === 'direct' && candidate.url) {
    return {server: candidate.origin, link: candidate.url, type: streamType(candidate.url), ...(candidate.headers ? {headers: candidate.headers} : {})};
  }
  const archived = await archiveDirectVideo(candidate.torrentUrl);
  if (archived) return {server: 'Internet Archive', link: archived.url, type: streamType(archived.url)};
  const service = candidate.magnet ? debridFor(candidate) : undefined;
  if (service && candidate.cachedOn.includes(service)) {
    const resolution = await resolveDebrid(candidateToResult(candidate), service);
    const file = pickEpisodeFile(resolution.files, want);
    if (!file) throw new Error('No video in this torrent');
    const url = await directLink(resolution, file);
    return {server: resolution.service.name, link: url, type: streamType(url)};
  }
  const source = candidate.magnet || candidateToResult(candidate).magnet || candidate.torrentUrl;
  if (!source) throw new Error('This source has no link');
  return {server: 'Torrent', link: source, type: 'torrent'};
};

/** The fallback list and timeouts Play best uses for this ranked list. */
export const planPlayBest = (ranked: Candidate[], want: WantedVideo, prefs = readPrefs()): PlayBestPlan => {
  const list = buildFallbackList(ranked, {filters: prefs.playBestFilters, failedIds: recentFailures(want), max: prefs.autoFallback ? undefined : 1});
  return {
    want,
    // Nothing looked playable: still try the top source, as Play best always did.
    candidates: list.length ? list : ranked.slice(0, 1),
    index: 0,
    timeouts: {
      ...DEFAULT_FALLBACK_TIMEOUTS,
      firstFrameMs: Math.max(5, prefs.fallbackFirstFrameSec || 15) * 1000,
      startStallMs: Math.max(5, prefs.fallbackStallSec || 20) * 1000,
    },
  };
};

/**
 * Play best: opens the first source of the fallback list that resolves, and
 * hands the list to the player so it can move on by itself if that source
 * does not play.
 */
export const playBest = async (
  ranked: Candidate[],
  want: WantedVideo,
  navigation: any,
  options: {next?: WantedVideo; onStatus?: (text: string) => void} = {},
): Promise<void> => {
  const plan = planPlayBest(ranked, want);
  if (!plan.candidates.length) throw new Error('No playable source found');
  let lastError: unknown;
  for (let index = 0; index < plan.candidates.length; index++) {
    if (index > 0) {
      toast(nextSourceMessage(index, plan.candidates.length));
      options.onStatus?.(nextSourceMessage(index, plan.candidates.length));
    }
    try {
      await playCandidate(plan.candidates[index], want, navigation, {...options, playBest: plan.candidates.length > 1 ? {...plan, index} : undefined});
      return;
    } catch (error) {
      lastError = error;
      rememberFailure(want, plan.candidates[index].id);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No source could be played');
};
