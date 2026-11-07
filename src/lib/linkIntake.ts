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
import {offerDashDownload} from './downloadEngine/dashIntake';

const storage = openStore('droid-stream-intake');

export type IncomingKind = 'magnet' | 'torrent' | 'http';

export const classifyLink = (value: string): IncomingKind | null => {
  const text = value.trim();
  if (/^magnet:\?/i.test(text)) return 'magnet';
  if (/^content:\/\//i.test(text) || /\.torrent(\?|$)/i.test(text)) return 'torrent';
  if (/^(https?|ftps?|ftpes):\/\/\S+$/i.test(text)) return 'http';
  return null;
};

/** First magnet or URL in copied text, if any. */
export const linkInText = (text: string): string | undefined =>
  text.match(/magnet:\?xt=urn:btih:[^\s"'<>]+/i)?.[0] || text.match(/https?:\/\/\S+\.(torrent|mkv|mp4|m3u8|avi|webm|zip|apk)(\?\S*)?/i)?.[0];

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

export const offerLink = (value: string, navigate: (screen: string, params?: object) => void, origin: 'shared' | 'clipboard'): void => {
  const kind = classifyLink(value);
  if (!kind) return;
  const title = nameOf(value);
  if (kind === 'http') {
    showAppDialog({
      title: origin === 'clipboard' ? 'Download the copied link?' : 'Download this link?',
      message: value,
      actions: [
        {label: 'Not now'},
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
        offerLink(intent.value, navigate, 'shared');
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
