/**
 * Connects remote control and command access to the downloads list. Started
 * once from App.tsx; does nothing that reaches the network until the user
 * turns a feature on.
 */
import * as RNFS from '@dr.pogodin/react-native-fs';
import {ToastAndroid} from 'react-native';
import {findDuplicate} from '../downloadEngine/planner';
import {validateDownloadLocationAccess} from '../downloadLocation';
import {pauseDownload, resumeDownload, retryDownload, cancelDownload} from '../downloadManager';
import {parseEd2kLink} from '../ed2k/link';
import {isEd2kEnabled} from '../ed2k/settings';
import {isKidsProfileActive} from '../profiles/profiles';
import {settingsStorage} from '../storage';
import {DEBRID_HOSTS} from '../unblock/unblockHosts';
import useDownloadsStore, {isSubtitleDownloadItem, type DownloadItem} from '../zustand/downloadsStore';
import {createAria2Rpc, MAX_TORRENT_BYTES, type Aria2AddOptions, type Aria2Backend} from './aria2Rpc';
import {commandTargets, formatCommandList, parseCommand} from './commands';
import {remoteAccessNative, setGlobalSpeedLimit, type RpcServerState} from './native';
import {FailedAttemptLimiter} from './secret';
import {remoteAccessSettings} from './settings';
import {torrentNameFromBase64} from './torrentName';

/** Large enough for a base64 .torrent of MAX_TORRENT_BYTES and its JSON. */
export const MAX_RPC_BODY_BYTES = Math.ceil((MAX_TORRENT_BYTES * 4) / 3) + 64 * 1024;

const downloads = (): DownloadItem[] =>
  Object.values(useDownloadsStore.getState().downloads).filter(item => !isSubtitleDownloadItem(item));

const newId = () => `remote-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const nameFromLink = (url: string): string => {
  const dn = url.match(/[?&]dn=([^&]+)/i)?.[1];
  if (dn) {
    try {
      return decodeURIComponent(dn.replace(/\+/g, ' '));
    } catch {
      return dn;
    }
  }
  const last = url.split(/[?#]/)[0].split('/').filter(Boolean).pop() || 'download';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
};

const extensionOf = (name: string): string => name.match(/\.([a-z0-9]{1,8})$/i)?.[1].toLowerCase() || '';

/** Queues the download and checks it reached the list (it does not when no download folder is set). */
const queue = async (input: {downloadId: string; url: string; name: string; fileType: string; headers?: Record<string, string>}) => {
  // A remote add must not open the folder picker on the phone.
  if (!(await validateDownloadLocationAccess(settingsStorage.getDownloadLocationConfig()))) {
    throw new Error('Choose a download folder in Droid Stream first.');
  }
  const {downloadManager} = require('../downloader') as typeof import('../downloader');
  const baseName = input.name.replace(/\.[a-z0-9]{1,8}$/i, '') || input.name;
  await downloadManager({
    downloadId: input.downloadId,
    title: baseName,
    mediaType: 'movie',
    url: input.url,
    fileName: baseName,
    fileType: input.fileType,
    headers: input.headers && Object.keys(input.headers).length ? input.headers : undefined,
    provider: 'Remote',
    deleteDownload: () => undefined,
  });
  if (!useDownloadsStore.getState().downloads[input.downloadId]) {
    throw new Error('Could not add. Open Droid Stream and choose a download folder.');
  }
  return input.downloadId;
};

/** An existing download for the same link: a failed one is tried again. */
const reuse = async (existing: DownloadItem): Promise<string> => {
  if ((existing.status === 'error' || existing.status === 'interrupted') && existing.retryable) {
    await retryDownload(existing.id);
  }
  return existing.id;
};

const addLink = async (uri: string, options: Aria2AddOptions): Promise<string> => {
  if (isKidsProfileActive()) throw new Error('Downloads cannot be added in a kids profile');
  if (/^ed2k:/i.test(uri)) {
    const link = parseEd2kLink(uri);
    if (!link || link.kind !== 'file') throw new Error('Only eD2k file links can be added');
    if (!isEd2kEnabled()) throw new Error('eD2k downloads are off in Settings');
    const {queueEd2kFile} = require('../ed2k/intake') as typeof import('../ed2k/intake');
    await queueEd2kFile(link, uri);
    return `ed2k-${link.hash}`;
  }
  const name = options.out || nameFromLink(uri);
  const existing = findDuplicate(
    downloads().map(item => ({id: item.id, url: item.url, fileName: item.displayFileName, size: item.totalBytes})),
    {url: uri},
  );
  if (existing) return reuse(useDownloadsStore.getState().downloads[existing.id]);
  if (/^magnet:/i.test(uri)) {
    return queue({downloadId: newId(), url: uri, name: name === 'download' ? 'Torrent' : name, fileType: 'torrent'});
  }
  const fileType = /\.m3u8(\?|#|$)/i.test(uri) ? 'm3u8' : /\.mpd(\?|#|$)/i.test(uri) ? 'mpd' : extensionOf(name) || 'mp4';
  return queue({downloadId: newId(), url: uri, name, fileType, headers: options.headers});
};

const addTorrentFile = async (base64: string, options: Aria2AddOptions): Promise<string> => {
  if (isKidsProfileActive()) throw new Error('Downloads cannot be added in a kids profile');
  const downloadId = newId();
  const folder = `${RNFS.CachesDirectoryPath}/remote-torrents`;
  await RNFS.mkdir(folder);
  const path = `${folder}/${downloadId}.torrent`;
  await RNFS.writeFile(path, base64, 'base64');
  const name = options.out || torrentNameFromBase64(base64) || 'Torrent';
  return queue({downloadId, url: path, name, fileType: 'torrent'});
};

const findTarget = (target: string): DownloadItem[] => downloads().filter(item => commandTargets(target, item));

const unpause = async (item: DownloadItem): Promise<void> => {
  if (item.status === 'paused') await resumeDownload(item.id);
  else if (item.retryable) await retryDownload(item.id);
};

export const appAria2Backend: Aria2Backend = {
  list: downloads,
  addUri: addLink,
  addTorrent: addTorrentFile,
  pause: pauseDownload,
  unpause: async id => {
    const item = useDownloadsStore.getState().downloads[id];
    if (item) await unpause(item);
  },
  remove: cancelDownload,
  speedLimit: () => remoteAccessSettings.speedLimit(),
  setSpeedLimit: bytes => {
    remoteAccessSettings.setSpeedLimit(bytes);
    setGlobalSpeedLimit(bytes);
  },
  maxConcurrentDownloads: () => settingsStorage.getDownloadConcurrency(),
};

// ---- Server state for the settings page ----

let serverState: RpcServerState = {running: false};
const stateListeners = new Set<(state: RpcServerState) => void>();

const setServerState = (state: RpcServerState) => {
  serverState = state;
  stateListeners.forEach(listener => listener(state));
};

export const currentServerState = (): RpcServerState => serverState;

export const subscribeServerState = (listener: (state: RpcServerState) => void): (() => void) => {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
};

/** Starts or stops the server to match the setting. */
export const applyRemoteControl = async (): Promise<RpcServerState> => {
  if (!remoteAccessNative.supported()) {
    setServerState({running: false, error: 'Not available on this device'});
    return serverState;
  }
  if (!remoteAccessSettings.rpcEnabled()) {
    await remoteAccessNative.stopServer().catch(() => undefined);
    setServerState({running: false});
    return serverState;
  }
  try {
    setServerState(await remoteAccessNative.startServer(remoteAccessSettings.rpcPort(), MAX_RPC_BODY_BYTES));
  } catch (error) {
    setServerState({running: false, error: (error as Error)?.message || 'Could not start'});
  }
  return serverState;
};

export const applyCommandAccess = (): Promise<void> =>
  remoteAccessNative.setCommandAccess(remoteAccessSettings.commandsEnabled(), remoteAccessSettings.commandsEnabled() ? remoteAccessSettings.commandToken() : '');

export const applyBrowserLikeSites = (): Promise<void> =>
  remoteAccessNative.setBrowserLikeSites(remoteAccessSettings.browserLikeSites(), DEBRID_HOSTS);

// ---- Commands ----

const runCommand = async (action: string, extras: Record<string, string>): Promise<string> => {
  const command = parseCommand(action, extras);
  if ('error' in command) throw new Error(command.error);
  switch (command.kind) {
    case 'add': {
      const id = await addLink(command.url, {out: command.name, headers: {}});
      ToastAndroid.show('Added to Downloads', ToastAndroid.SHORT);
      return `Added: ${id}`;
    }
    case 'pause': {
      const items = findTarget(command.target).filter(item => item.status === 'downloading' || item.status === 'starting');
      for (const item of items) await pauseDownload(item.id).catch(() => undefined);
      return `Paused ${items.length}`;
    }
    case 'resume': {
      const items = findTarget(command.target).filter(item => item.status === 'paused' || item.status === 'interrupted');
      for (const item of items) await unpause(item).catch(() => undefined);
      return `Resumed ${items.length}`;
    }
    case 'list':
      return formatCommandList(downloads().filter(item => item.status !== 'completed'));
  }
};

const takePending = async () => {
  const pending = await remoteAccessNative.takePendingCommands().catch(() => [] as string[]);
  for (const text of pending) {
    try {
      const value = JSON.parse(text) as {action?: string; extras?: Record<string, string>};
      await runCommand(value.action || '', value.extras || {});
    } catch (error) {
      ToastAndroid.show((error as Error)?.message || 'A saved command did not work', ToastAndroid.LONG);
    }
  }
};

/** Wires everything up. Returns a cleanup function. */
export const startRemoteAccess = (): (() => void) => {
  if (!remoteAccessNative.supported()) return () => undefined;
  const rpc = createAria2Rpc({backend: appAria2Backend, token: () => remoteAccessSettings.rpcToken(), limiter: new FailedAttemptLimiter()});
  const subscriptions = [
    remoteAccessNative.onRequest(event => {
      rpc
        .handle(event.body, event.client)
        .then(reply => remoteAccessNative.respond(event.id, reply))
        .catch(() => remoteAccessNative.respond(event.id, JSON.stringify({jsonrpc: '2.0', id: null, error: {code: 1, message: 'Failed'}})));
    }),
    remoteAccessNative.onCommand(event => {
      runCommand(event.action, event.extras || {})
        .then(text => remoteAccessNative.respondCommand(event.id, true, text))
        .catch(error => remoteAccessNative.respondCommand(event.id, false, (error as Error)?.message || 'Failed'));
    }),
    remoteAccessNative.onServerState(state => {
      if (!state.running && state.error === 'stopped-from-notification') {
        remoteAccessSettings.setRpcEnabled(false);
        setServerState({running: false});
        return;
      }
      setServerState(state);
    }),
  ];
  const limit = remoteAccessSettings.speedLimit();
  if (limit > 0) setGlobalSpeedLimit(limit);
  applyBrowserLikeSites().catch(() => undefined);
  applyCommandAccess()
    .then(() => (remoteAccessSettings.commandsEnabled() ? takePending() : undefined))
    .catch(() => undefined);
  remoteAccessNative
    .consumeStoppedFromNotification()
    .then(stopped => {
      if (stopped) remoteAccessSettings.setRpcEnabled(false);
      return applyRemoteControl();
    })
    .catch(() => undefined);
  return () => subscriptions.forEach(subscription => subscription?.remove());
};
