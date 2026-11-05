import {directLink, getService} from '../debrid';
import {resolveDebrid, toast} from '../torrentSearch/actions';
import {torrentManager} from '../torrentManager';
import type {WatchMeta} from '../watchMeta';
import {candidateToResult, debridFor, pickEpisodeFile, preloadNext, type Candidate, type WantedVideo} from './finder';
import {VIDEO_FILE} from '../debrid/types';

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

const openPlayer = (navigation: any, want: WantedVideo, url: string, server: string, fileName: string, headers?: Record<string, string>) =>
  navigation.navigate('Player', {
    linkIndex: 0,
    episodeList: [{title: label(want, fileName), link: url}],
    directUrl: url,
    type: want.type,
    primaryTitle: want.title,
    secondaryTitle: want.season !== undefined ? `Season ${want.season}` : undefined,
    poster: want.poster ? {poster: want.poster} : {},
    initialStream: {server, link: url, type: /\.m3u8(\?|$)/i.test(url) ? 'm3u8' : 'mp4', headers},
    meta: metaOf(want),
  });

/**
 * Plays one candidate: direct links open at once; torrents go through a
 * debrid when one has it (or is set for uncached torrents), otherwise the
 * on-device torrent client streams it.
 */
export const playCandidate = async (
  candidate: Candidate,
  want: WantedVideo,
  navigation: any,
  options: {next?: WantedVideo; onStatus?: (text: string) => void; forcePhone?: boolean} = {},
): Promise<void> => {
  const status = options.onStatus || (() => undefined);
  if (candidate.kind === 'direct' && candidate.url) {
    openPlayer(navigation, want, candidate.url, candidate.origin, candidate.title, candidate.headers);
  } else {
    const result = candidateToResult(candidate);
    const service = options.forcePhone ? undefined : debridFor(candidate);
    if (service) {
      status(`Asking ${getService(service).name}…`);
      const resolution = await resolveDebrid(result, service, progress => status(`${getService(service).name}: ${progress.percent}% · ${progress.status}`));
      const file = pickEpisodeFile(resolution.files, want);
      if (!file) throw new Error('No video in this torrent');
      openPlayer(navigation, want, await directLink(resolution, file), resolution.service.name, file.name);
    } else {
      status('Starting the torrent on this phone…');
      const source = candidate.magnet || result.magnet || '';
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
      });
    }
  }
  if (options.next) {
    preloadNext(options.next).catch(() => undefined);
    toast('Preparing the next episode in the background');
  }
};
