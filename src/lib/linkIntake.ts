/**
 * Handles magnets, .torrent files, and links that reach the app from other
 * apps (browser taps, Share), and copied links when the clipboard grabber is on.
 */
import {AppState, DeviceEventEmitter, type AppStateStatus} from 'react-native';
import {openStore} from './storage/openStore';
import {connectedServices} from './debrid';
import {probeLink, qualityChoices, queueLink} from './linkGrabber';
import {settingsStorage} from './storage';
import {downloadWithClient, quickDebridPlay, streamOnDevice, toast} from './torrentSearch/actions';
import {makeResult, infoHashFrom} from './torrentSearch/util';
import {torrentManager} from './torrentManager';
import {showAppDialog} from './zustand/appDialogStore';
import {openWatchOnline} from './watchOnline/store';
import {isPageLink} from './ytdl/formats';
import {ytdlSupported} from './ytdl/native';
import {readYtdlSettings} from './ytdl/settings';
import {isKidsProfileActive} from './profiles/profiles';
import {offerDashDownload} from './downloadEngine/dashIntake';
import {ed2kLinksIn, isEd2kLink} from './ed2k/link';
import {offerEd2kLink} from './ed2k/intake';
import {socialLinkInText} from './social/urls';

const storage = openStore('droid-stream-intake');

export type IncomingKind = 'magnet' | 'torrent' | 'http' | 'ed2k';

export const classifyLink = (value: string): IncomingKind | null => {
  const text = value.trim();
  if (isEd2kLink(text)) return 'ed2k';
  if (/^magnet:\?/i.test(text)) return 'magnet';
  if (/^content:\/\//i.test(text) || /\.torrent(\?|$)/i.test(text)) return 'torrent';
  if (/^(https?|ftps?|ftpes):\/\/\S+$/i.test(text)) return 'http';
  return null;
};

/** First magnet, file link or social post link in copied text, if any. */
export const linkInText = (text: string): string | undefined =>
  ed2kLinksIn(text)[0] ||
  text.match(/magnet:\?xt=urn:btih:[^\s"'<>]+/i)?.[0] ||
  text.match(/https?:\/\/\S+\.(torrent|mkv|mp4|m3u8|avi|webm|zip|apk)(\?\S*)?/i)?.[0] ||
  socialLinkInText(text);

const nameOf = (value: string): string => {
  const dn = value.match(/[?&]dn=([^&]+)/i)?.[1];
  try {
    if (dn) return decodeURIComponent(dn.replace(/\+/g, ' '));
  } catch {
    // fall through
  }
  return value.split('/').pop()?.split('?')[0] || 'Torrent';
};

const queueWithToast = (url: string, name?: string) =>
  queueLink(url, name)
    .then(state => toast(state === 'queued' ? 'Added to Downloads' : 'Already in Downloads'))
    .catch(error => toast(error.message));

/** Asks which quality to save when a stream offers more than one. */
const downloadLink = async (url: string): Promise<void> => {
  if (/\.mpd(\?|$)/i.test(url)) {
    await offerDashDownload(url, undefined, (link, name, dash) =>
      queueLink(link, name, {dash}).then(state => toast(state === 'queued' ? 'Added to Downloads' : 'Already in Downloads')),
    );
    return;
  }
  if (!/\.m3u8(\?|$)/i.test(url)) {
    await queueWithToast(url);
    return;
  }
  const probed = await probeLink(url).catch(() => undefined);
  const choices = qualityChoices(probed?.variants || []);
  if (choices.length < 2) {
    await queueWithToast(choices[0]?.url || url, probed?.fileName);
    return;
  }
  const save = (choice: (typeof choices)[number]) => ({
    label: choice.label,
    onPress: () => queueWithToast(choice.url, `${(probed?.fileName || 'video').replace(/\.[^.]+$/, '')} ${choice.label}.m3u8`),
  });
  showAppDialog({
    title: 'Choose a quality',
    message: probed?.fileName || url,
    // The last action is the highlighted one, so the best quality goes there.
    actions: [{label: 'Not now'}, ...choices.slice(1).map(save), {...save(choices[0]), variant: 'primary'}],
  });
};

/** What another browser sent with a file link it handed over as a download manager. */
export interface IncomingDownload {
  headers?: Record<string, string>;
  mimeType?: string;
}

/** A file link from another browser: saved with the cookies, Referer and user agent it sent. */
const offerDownload = (url: string, extra: IncomingDownload): void => {
  const headers = extra.headers || {};
  showAppDialog({
    title: 'Download this file?',
    message: nameOf(url),
    actions: [
      {label: 'Not now'},
      {
        label: 'Download',
        variant: 'primary',
        onPress: () => {
          // Loaded here so the intake does not pull the browser in at start.
          const {downloadFile} = require('./browser/handoff') as typeof import('./browser/handoff');
          downloadFile({url, mime: extra.mimeType, headers}, {pageUrl: headers.Referer || '', userAgent: headers['User-Agent'] || '', isPrivate: false}).catch(error => toast(error.message));
        },
      },
    ],
  });
};

const isUserscriptLink = (value: string): boolean => /^https?:\/\/[^?#\s]+\.user\.js(\?|#|$)/i.test(value);

export const offerLink = (
  value: string,
  navigate: (screen: string, params?: object) => void,
  origin: 'shared' | 'clipboard',
  download?: IncomingDownload,
): void => {
  const kind = classifyLink(value);
  if (kind === 'http' && download) {
    offerDownload(value, download);
    return;
  }
  // A post, story or profile on Instagram, X, Reddit and the like opens the
  // photo sheet, which offers the video downloader for video posts.
  const social = socialLinkInText(value);
  if (social) {
    if (origin === 'shared') {
      navigate('SocialDownload', {url: social});
      return;
    }
    showAppDialog({
      title: 'Save from the copied post?',
      message: social,
      actions: [{label: 'Not now'}, {label: 'Open', variant: 'primary', onPress: () => navigate('SocialDownload', {url: social})}],
    });
    return;
  }
  if (!kind) return;
  if (kind === 'ed2k') {
    offerEd2kLink(value, origin);
    return;
  }
  if (kind === 'http' && origin === 'shared' && isUserscriptLink(value) && !isKidsProfileActive()) {
    showAppDialog({
      title: 'Install this userscript?',
      message: value,
      actions: [
        {label: 'Not now'},
        {
          label: 'Install',
          variant: 'primary',
          onPress: () => {
            const {installUserscriptFromUrl} = require('./browser/userscripts/store') as typeof import('./browser/userscripts/store');
            installUserscriptFromUrl(value)
              .then(script => toast(`Installed ${script.meta.name}. It runs in the browser.`))
              .catch(error => toast(error.message));
          },
        },
      ],
    });
    return;
  }
  const title = nameOf(value);
  // A shared web page (a YouTube, Instagram or X post) opens the yt-dlp sheet.
  if (kind === 'http' && origin === 'shared' && isPageLink(value) && ytdlSupported() && readYtdlSettings().offerForAllLinks) {
    navigate('YtdlDownload', {url: value});
    return;
  }
  if (kind === 'http') {
    showAppDialog({
      title: origin === 'clipboard' ? 'Download the copied link?' : 'Download this link?',
      message: value,
      actions: [
        {label: 'Not now'},
        ...(isKidsProfileActive() ? [] : [{label: 'Open in browser', onPress: () => navigate('Browser', {url: value})}]),
        {label: 'Download', variant: 'primary', onPress: () => downloadLink(value)},
      ],
    });
    return;
  }
  const result = makeResult({engine: origin, title, magnet: kind === 'magnet' ? value : undefined, torrentUrl: kind === 'torrent' ? value : undefined, infoHash: infoHashFrom(value)});
  const debrid = connectedServices()[0];
  const actions = [
    {label: 'Not now'},
    {label: 'Download', onPress: () => downloadWithClient(result).catch(error => toast(error.message))},
    {label: 'Stream', variant: 'primary' as const, onPress: () => streamOnDevice(result, {navigate}).catch(error => toast(error.message))},
  ];
  // Watch online picks cached debrid, PikPak or the torrent by itself.
  actions.splice(1, 0, {label: 'Watch online', onPress: async () => openWatchOnline({result, navigate})});
  if (debrid && kind === 'magnet') {
    actions.splice(1, 0, {label: `Play with ${debrid.name}`, onPress: () => quickDebridPlay(result, {navigate}, debrid.id).then(() => undefined).catch(error => toast(error.message))});
  }
  showAppDialog({
    title: origin === 'clipboard' ? 'Copied magnet found' : 'Open torrent',
    message: title,
    actions,
  });
};

/** Starts listening. Returns a cleanup function. */
export const startLinkIntake = (navigate: (screen: string, params?: object) => void): (() => void) => {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const intent = await torrentManager.consumeLaunchIntent().catch(() => null);
      if (intent?.value) {
        let headers: Record<string, string> | undefined;
        try {
          headers = intent.headers ? JSON.parse(intent.headers) : undefined;
        } catch {
          headers = undefined;
        }
        offerLink(intent.value, navigate, 'shared', intent.download ? {headers, mimeType: intent.mimeType} : undefined);
        return;
      }
      const mode = settingsStorage.clipboardGrabber();
      if (mode === 'off') return;
      const text = await torrentManager.readClipboard().catch(() => '');
      const link = text ? linkInText(text) : undefined;
      if (!link || storage.getString('lastClipboard') === link) return;
      storage.setString('lastClipboard', link);
      offerLink(link, navigate, 'clipboard');
    } finally {
      running = false;
    }
  };
  const onChange = (state: AppStateStatus) => {
    if (state === 'active') check().catch(() => undefined);
  };
  const subscription = AppState.addEventListener('change', onChange);
  const first = setTimeout(() => check().catch(() => undefined), 1500);
  const shared = DeviceEventEmitter.addListener('onVegaSharedLink', () => check().catch(() => undefined));
  return () => {
    clearTimeout(first);
    subscription.remove();
    shared.remove();
  };
};
