/**
 * Handles magnets, .torrent files, and links that reach the app from other
 * apps (browser taps, Share), and copied links when the clipboard grabber is on.
 */
import {AppState, type AppStateStatus} from 'react-native';
import {MMKVLoader} from 'react-native-mmkv-storage';
import {connectedServices} from './debrid';
import {queueLink} from './linkGrabber';
import {settingsStorage} from './storage';
import {downloadWithClient, quickDebridPlay, streamOnDevice, toast} from './torrentSearch/actions';
import {makeResult, infoHashFrom} from './torrentSearch/util';
import {torrentManager} from './torrentManager';
import {showAppDialog} from './zustand/appDialogStore';

const storage = new MMKVLoader().withInstanceID('droid-stream-intake').initialize();

export type IncomingKind = 'magnet' | 'torrent' | 'http';

export const classifyLink = (value: string): IncomingKind | null => {
  const text = value.trim();
  if (/^magnet:\?/i.test(text)) return 'magnet';
  if (/^content:\/\//i.test(text) || /\.torrent(\?|$)/i.test(text)) return 'torrent';
  if (/^https?:\/\/\S+$/i.test(text)) return 'http';
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
        {label: 'Download', variant: 'primary', onPress: () => queueLink(value).then(state => toast(state === 'queued' ? 'Added to Downloads' : 'Already in Downloads')).catch(error => toast(error.message))},
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
  return () => {
    clearTimeout(first);
    subscription.remove();
  };
};
