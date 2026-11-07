import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import {
  addEd2kServers,
  DEFAULT_SERVER_LIST_URL,
  readEd2kServers,
  type Ed2kServer,
} from './settings';

export interface Ed2kStartOptions {
  hash: string;
  size: number;
  /** Local file the parts are written to. */
  path: string;
  sources: string[];
  partHashes?: string[];
  wifiOnly: boolean;
}

export interface Ed2kSearchResult {
  hash: string;
  name: string;
  size: number;
  sources: number;
  completeSources: number;
}

export type Ed2kState =
  | 'connecting'
  | 'searching'
  | 'queued'
  | 'downloading'
  | 'waitingForNetwork'
  | 'completed';

export interface Ed2kProgressEvent {
  downloadId: string;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  /** Known peers that have the file. */
  sources: number;
  /** Peers sending data now. */
  downloading: number;
  /** Peers whose upload queue this download waits in. */
  queued: number;
  /** Best queue position, 0 when not waiting. */
  queueRank: number;
  state: Ed2kState;
  server: string;
  message: string;
}

interface Ed2kNative {
  start(
    downloadId: string,
    options: Ed2kStartOptions,
    servers: Ed2kServer[],
  ): Promise<{totalBytes: number}>;
  pause(downloadId: string): Promise<void>;
  cancel(downloadId: string): Promise<void>;
  isActive(downloadId: string): Promise<boolean>;
  search(query: string, servers: Ed2kServer[]): Promise<Ed2kSearchResult[]>;
  fetchServerList(url: string): Promise<Ed2kServer[]>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const PROGRESS_EVENT = 'VegaEd2kProgress';

const nativeModule = (): Ed2kNative | undefined =>
  Platform.OS === 'android'
    ? (NativeModules.Ed2kModule as Ed2kNative | undefined)
    : undefined;

export const isEd2kSupported = (): boolean => Boolean(nativeModule());

const requireNative = (): Ed2kNative => {
  const module = nativeModule();
  if (!module) {
    throw new Error('eD2k downloads are not available on this device');
  }
  return module;
};

export const isEd2kPausedError = (error: unknown): boolean =>
  (error as {code?: string} | undefined)?.code === 'ED2K_PAUSED';

export const isEd2kCancelledError = (error: unknown): boolean =>
  (error as {code?: string} | undefined)?.code === 'ED2K_CANCELLED';

/** Downloads a server.met file and adds its servers. Returns how many were new. */
export const importServerList = async (url: string): Promise<number> => {
  const servers = await requireNative().fetchServerList(url);
  if (servers.length === 0) {
    throw new Error('That server list has no servers');
  }
  return addEd2kServers(
    servers.map(server => ({
      host: server.host,
      port: server.port,
      name: server.name || undefined,
    })),
  );
};

/** The saved servers; the default list is fetched the first time there are none. */
export const ensureEd2kServers = async (): Promise<Ed2kServer[]> => {
  const saved = readEd2kServers();
  if (saved.length > 0) {
    return saved;
  }
  try {
    await importServerList(DEFAULT_SERVER_LIST_URL);
  } catch {
    // Reported below as "no servers".
  }
  const servers = readEd2kServers();
  if (servers.length === 0) {
    throw new Error(
      'No eD2k servers. Add one or import a server list in Settings > Preferences > eD2k.',
    );
  }
  return servers;
};

export const startEd2kTransfer = (
  downloadId: string,
  options: Ed2kStartOptions,
  servers: Ed2kServer[],
): Promise<{totalBytes: number}> =>
  requireNative().start(downloadId, options, servers);

export const pauseEd2kTransfer = (downloadId: string): Promise<void> =>
  requireNative().pause(downloadId);

export const cancelEd2kTransfer = async (downloadId: string): Promise<void> => {
  await nativeModule()?.cancel(downloadId);
};

export const searchEd2k = async (query: string): Promise<Ed2kSearchResult[]> => {
  const text = query.trim();
  if (!text) {
    return [];
  }
  const servers = await ensureEd2kServers();
  const results = await requireNative().search(text, servers);
  return [...results].sort((left, right) => right.sources - left.sources);
};

let emitter: NativeEventEmitter | undefined;

export const onEd2kProgress = (
  listener: (event: Ed2kProgressEvent) => void,
): (() => void) => {
  const module = nativeModule();
  if (!module) {
    return () => undefined;
  }
  emitter ??= new NativeEventEmitter(module as never);
  const subscription = emitter.addListener(PROGRESS_EVENT, event =>
    listener(event as Ed2kProgressEvent),
  );
  return () => subscription.remove();
};
