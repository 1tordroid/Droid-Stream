import {archiveDirectVideo} from './archive';
import {Clipboard, Linking, Share, ToastAndroid} from 'react-native';
import {
  connectedServices,
  directLink,
  pickVideo,
  readDebridSettings,
  sendToDebrid,
  VIDEO_FILE,
  type DebridFile,
  type DebridId,
  type DebridResolution,
} from '../debrid';
import {queueLink} from '../linkGrabber';
import {readStoredTorrents, writeStoredTorrents} from '../torrent/settings';
import {torrentManager} from '../torrentManager';
import {resolveResult} from './search';
import type {TorrentResult} from './types';

export const sourceOf = (result: TorrentResult): string => result.magnet || result.torrentUrl || '';

export const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.LONG);

/** Adds to the built-in torrent client and remembers it in the Torrents list. */
export const downloadWithClient = async (input: TorrentResult): Promise<void> => {
  const result = await resolveResult(input);
  const archived = await archiveDirectVideo(result.torrentUrl);
  if (archived) {
    await queueLink(archived.url, archived.name);
    toast(`Downloading ${result.title}`);
    return;
  }
  const source = sourceOf(result);
  const added = await torrentManager.enqueue(source);
  const stored = readStoredTorrents().filter(item => item.infoHash !== added.infoHash);
  writeStoredTorrents([{infoHash: added.infoHash, source, name: added.name || result.title}, ...stored]);
  toast(`Downloading ${result.title}`);
};

/** Streams on this device while the torrent downloads (sequential pieces). */
export const streamOnDevice = async (input: TorrentResult, navigation: any): Promise<void> => {
  const result = await resolveResult(input);
  const archived = await archiveDirectVideo(result.torrentUrl);
  if (archived) {
    navigation.navigate('Player', {
      linkIndex: 0,
      episodeList: [{title: archived.name, link: archived.url}],
      directUrl: archived.url,
      type: 'mp4',
      primaryTitle: result.title,
      poster: result.poster ? {poster: result.poster} : {},
      initialStream: {server: 'Internet Archive', link: archived.url, type: 'mp4'},
    });
    return;
  }
  const source = sourceOf(result);
  const added = await torrentManager.addTorrent(source);
  const files = added.files?.length ? added.files : await torrentManager.getFiles(added.infoHash);
  const videos = files.filter(file => VIDEO_FILE.test(file.name) && !/sample/i.test(file.name));
  const video = (videos.length ? videos : files).slice().sort((a: any, b: any) => (b.size || 0) - (a.size || 0))[0];
  if (!video) throw new Error('No playable file in this torrent yet');
  await torrentManager.prepareVideoFile(added.infoHash, video.index, false, false);
  const url = await torrentManager.getStreamUrl(added.infoHash, video.index);
  navigation.navigate('Player', {
    linkIndex: 0,
    episodeList: [{title: video.name, link: source}],
    directUrl: url,
    type: 'torrent',
    primaryTitle: result.title,
    poster: result.poster ? {poster: result.poster} : {},
    initialStream: {server: 'Torrent', link: source, type: 'torrent'},
  });
};

export interface DebridProgress {
  service: string;
  percent: number;
  status: string;
}

/** Gets a debrid service to fetch the torrent, then returns its files. */
export const resolveDebrid = async (
  input: TorrentResult,
  service: DebridId,
  onProgress?: (progress: DebridProgress) => void,
): Promise<DebridResolution> => {
  const result = await resolveResult(input);
  if (!result.magnet && !result.infoHash) throw new Error('This result has no magnet link');
  const magnet = result.magnet || `magnet:?xt=urn:btih:${result.infoHash}`;
  return sendToDebrid(service, magnet, {
    onProgress: transfer => onProgress?.({service, percent: Math.round(transfer.progress * 100), status: transfer.status}),
  });
};

export const playDebridFile = async (resolution: DebridResolution, file: DebridFile, navigation: any, title: string): Promise<void> => {
  const url = await directLink(resolution, file);
  navigation.navigate('Player', {
    linkIndex: 0,
    episodeList: [{title: file.name, link: url}],
    directUrl: url,
    type: 'movie',
    primaryTitle: title,
    poster: {},
    initialStream: {server: resolution.service.name, link: url, type: /\.m3u8/i.test(url) ? 'm3u8' : 'mp4'},
  });
};

/** Saves debrid files with the app's multi-connection HTTP downloader. */
export const downloadDebridFiles = async (resolution: DebridResolution, files: DebridFile[]): Promise<number> => {
  let queued = 0;
  for (const file of files) {
    const url = await directLink(resolution, file);
    if ((await queueLink(url, file.name)) === 'queued') queued += 1;
  }
  return queued;
};

/** Stream at once through the preferred debrid service when it is set. */
export const quickDebridPlay = async (input: TorrentResult, navigation: any, service?: DebridId): Promise<boolean> => {
  const settings = readDebridSettings();
  const chosen = service || connectedServices(settings)[0]?.id;
  if (!chosen) return false;
  const resolution = await resolveDebrid(input, chosen, progress => {
    if (progress.percent > 0 && progress.percent < 100) toast(`${progress.service}: ${progress.percent}%`);
  });
  const file = settings.autoPickVideo ? pickVideo(resolution.files) : resolution.files[0];
  if (!file) throw new Error('No files');
  await playDebridFile(resolution, file, navigation, input.title);
  return true;
};

export const copyMagnet = async (input: TorrentResult): Promise<void> => {
  const result = await resolveResult(input);
  Clipboard.setString(sourceOf(result));
  toast('Magnet copied');
};

export const shareResult = async (input: TorrentResult): Promise<void> => {
  const result = await resolveResult(input);
  await Share.share({message: `${result.title}\n${sourceOf(result)}`, title: result.title});
};

/** Hands the magnet to another installed torrent app. */
export const openExternally = async (input: TorrentResult): Promise<void> => {
  const result = await resolveResult(input);
  try {
    await Linking.openURL(sourceOf(result));
  } catch {
    throw new Error('No other app on this phone opens magnet links');
  }
};

export const openSite = async (result: TorrentResult): Promise<void> => {
  if (!result.detailUrl) throw new Error('This site has no page for the result');
  await Linking.openURL(result.detailUrl);
};
