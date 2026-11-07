import {Linking, Share, ToastAndroid} from 'react-native';
import {downloadManager} from '../downloader';
import {findDuplicate, parseDashRepresentations, parseHlsVariants} from '../downloadEngine/planner';
import {qualityChoices} from '../linkGrabber';
import {getCookieHeader} from '../services/cookieManager';
import {downloadWithClient, streamOnDevice} from '../torrentSearch/actions';
import {infoHashFrom, makeResult} from '../torrentSearch/util';
import {ytdlSaveCookies, ytdlSupported} from '../ytdl/native';
import {showAppDialog} from '../zustand/appDialogStore';
import useDownloadsStore from '../zustand/downloadsStore';
import {classifyMedia, fileNameOf, isSocialSite, type MediaItem} from './media';
import {hostOf} from './url';

/**
 * Where the browser sends what it found: the download manager (with the
 * page's cookies, Referer and user agent), the stream downloader, the yt-dlp
 * sheet, Torrents, the player, cast, and the photo downloader when that
 * screen is part of the app.
 */

export type Navigate = (screen: string, params?: object) => void;

export interface PageContext {
  pageUrl: string;
  userAgent: string;
  /** A private tab: nothing is written to the yt-dlp cookie file. */
  isPrivate: boolean;
}

const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.SHORT);

/** Headers that make a download look like the page's own request. */
export const requestHeaders = async (url: string, context: PageContext): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {};
  if (context.userAgent) headers['User-Agent'] = context.userAgent;
  if (/^https?:\/\//i.test(context.pageUrl)) headers.Referer = context.pageUrl;
  const cookie = await getCookieHeader(url).catch(() => '');
  if (cookie) headers.Cookie = cookie;
  return headers;
};

const extensionOf = (name: string, mime = ''): string => {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  const fromMime: Record<string, string> = {'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'application/zip': 'zip', 'application/vnd.android.package-archive': 'apk'};
  return fromMime[mime.split(';')[0].trim().toLowerCase()] || 'bin';
};

/** Adds a file to Downloads. Returns false when it was already there. */
export const downloadFile = async (
  input: {url: string; fileName?: string; mime?: string; title?: string; poster?: string; headers?: Record<string, string>},
  context: PageContext,
  type?: 'm3u8',
): Promise<boolean> => {
  const name = (input.fileName || fileNameOf(input.url)).replace(/[\\/:*?"<>|]+/g, '_');
  const existing = Object.values(useDownloadsStore.getState().downloads).map(item => ({url: item.url, fileName: item.displayFileName, size: item.totalBytes}));
  if (findDuplicate(existing, {url: input.url})) {
    toast('Already in Downloads');
    return false;
  }
  const extension = type === 'm3u8' ? 'm3u8' : extensionOf(name, input.mime);
  const base = name.replace(/\.[^.]+$/, '') || hostOf(context.pageUrl) || 'download';
  await downloadManager({
    downloadId: `browser-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    title: input.title?.trim() || base,
    mediaType: 'movie',
    url: input.url,
    fileName: base,
    fileType: extension,
    headers: {...(await requestHeaders(input.url, context)), ...(input.headers || {})},
    poster: input.poster,
    provider: 'Browser',
    sourceLink: context.pageUrl,
    deleteDownload: () => undefined,
  });
  toast('Added to Downloads');
  return true;
};

const fetchText = async (url: string, context: PageContext): Promise<string> => {
  const response = await fetch(url, {headers: await requestHeaders(url, context)});
  if (!response.ok) throw new Error(`The stream answered ${response.status}`);
  return response.text();
};

/** Opens the yt-dlp sheet, first giving yt-dlp this site's sign-in (not from private tabs). */
export const openInYtdl = async (url: string, context: PageContext, navigate: Navigate): Promise<void> => {
  if (!context.isPrivate && /^https?:\/\//i.test(context.pageUrl)) {
    const cookie = await getCookieHeader(context.pageUrl).catch(() => '');
    if (cookie) await ytdlSaveCookies(context.pageUrl).catch(() => undefined);
  }
  navigate('YtdlDownload', {url});
};

/** HLS through the stream downloader with a quality choice; DASH through yt-dlp when it is there. */
export const downloadStream = async (item: MediaItem, context: PageContext, navigate: Navigate): Promise<void> => {
  const title = item.title || hostOf(context.pageUrl) || 'video';
  if (item.kind === 'dash') {
    if (ytdlSupported()) {
      await openInYtdl(item.url, context, navigate);
      return;
    }
    const variants = parseDashRepresentations(await fetchText(item.url, context), item.url).filter(entry => entry.kind === 'video');
    const best = variants.sort((left, right) => (right.height || 0) - (left.height || 0))[0];
    if (!best) throw new Error('This stream has no single-file quality to save');
    await downloadFile({url: best.url, fileName: `${title} ${best.label}.mp4`, title}, context);
    return;
  }
  const choices = qualityChoices(parseHlsVariants(await fetchText(item.url, context), item.url).map(entry => ({url: entry.url, label: entry.label, kind: entry.kind})));
  const save = (url: string, label?: string) => downloadFile({url, fileName: `${title}${label ? ` ${label}` : ''}.m3u8`, title, poster: item.poster}, context, 'm3u8');
  if (choices.length < 2) {
    await save(choices[0]?.url || item.url, choices[0]?.label);
    return;
  }
  showAppDialog({
    title: 'Choose a quality',
    message: title,
    actions: [
      {label: 'Not now'},
      ...choices.slice(1).map(choice => ({label: choice.label, onPress: () => save(choice.url, choice.label).catch(error => toast(error.message))})),
      {label: choices[0].label, variant: 'primary' as const, onPress: () => save(choices[0].url, choices[0].label).catch(error => toast(error.message))},
    ],
  });
};

/** A magnet or .torrent link: download or stream it with the torrent client. */
export const openTorrent = (url: string, navigate: Navigate, title?: string): void => {
  const magnet = /^magnet:/i.test(url);
  const result = makeResult({engine: 'browser', title: title || (magnet ? decodeURIComponent(/[?&]dn=([^&]+)/i.exec(url)?.[1] || 'Torrent').replace(/\+/g, ' ') : fileNameOf(url, 'Torrent')), magnet: magnet ? url : undefined, torrentUrl: magnet ? undefined : url, infoHash: infoHashFrom(url)});
  showAppDialog({
    title: magnet ? 'Open magnet' : 'Open torrent',
    message: result.title,
    actions: [
      {label: 'Not now'},
      {label: 'Download', onPress: () => downloadWithClient(result).catch(error => toast(error.message))},
      {label: 'Stream', variant: 'primary', onPress: () => streamOnDevice(result, {navigate}).catch(error => toast(error.message))},
    ],
  });
};

/** Plays in the app's player, or casts with the player's cast mode. */
export const playMedia = async (item: MediaItem, context: PageContext, navigate: Navigate, cast = false): Promise<void> => {
  const headers = await requestHeaders(item.url, context);
  const type = item.kind === 'hls' ? 'm3u8' : item.kind === 'dash' ? 'mpd' : 'mp4';
  const title = item.title || fileNameOf(item.url, 'Video');
  navigate('Player', {
    linkIndex: 0,
    episodeList: [{title, link: item.url}],
    directUrl: item.url,
    type: 'movie',
    primaryTitle: title,
    poster: item.poster ? {poster: item.poster} : {},
    initialStream: {server: 'Browser', link: item.url, type, headers},
    alwaysCast: cast,
  });
};

/**
 * The photo and post downloader (src/screens/social, built separately).
 * Opens it only when its route is part of this build, so the browser works
 * with and without it.
 */
export const SOCIAL_ROUTE = 'SocialDownload';

export const canOpenSocial = (pageUrl: string, routeNames: readonly string[]): boolean =>
  routeNames.includes(SOCIAL_ROUTE) && isSocialSite(pageUrl);

export const openSocial = (pageUrl: string, routeNames: readonly string[], navigate: Navigate): boolean => {
  if (!routeNames.includes(SOCIAL_ROUTE)) return false;
  navigate(SOCIAL_ROUTE, {url: pageUrl});
  return true;
};

/** A file the page started downloading (a link, or Content-Disposition: attachment). */
export const handlePageDownload = async (
  event: {url: string; fileName?: string; mimeType?: string; userAgent?: string},
  context: PageContext,
  navigate: Navigate,
): Promise<void> => {
  const url = event.url;
  if (/^(blob|data):/i.test(url)) {
    toast('This page made the file itself, so it cannot be saved here. Try the page in another browser.');
    return;
  }
  const kind = classifyMedia(url, event.mimeType);
  if (kind === 'torrent' || kind === 'magnet') {
    openTorrent(url, navigate, event.fileName);
    return;
  }
  const withAgent = {...context, userAgent: event.userAgent || context.userAgent};
  showAppDialog({
    title: 'Download this file?',
    message: event.fileName || fileNameOf(url),
    actions: [
      {label: 'Not now'},
      {label: 'Download', variant: 'primary', onPress: () => downloadFile({url, fileName: event.fileName, mime: event.mimeType}, withAgent).catch(error => toast(error.message))},
    ],
  });
};

export const shareLink = (url: string, title?: string): void => {
  Share.share({message: url, title}).catch(() => undefined);
};

export const openExternally = (url: string): void => {
  Linking.openURL(url).catch(() => toast('No app can open this link'));
};
