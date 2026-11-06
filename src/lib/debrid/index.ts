import {MMKVLoader} from 'react-native-mmkv-storage';
import {debridLink, offcloud, pikpak, pikpakKey} from './more';
import {allDebrid, premiumize, realDebrid, torbox} from './services';
import {VIDEO_FILE, type DebridFile, type DebridId, type DebridService, type DebridTransfer} from './types';

export * from './types';

export const DEBRID_SERVICES: DebridService[] = [torbox, realDebrid, allDebrid, premiumize, offcloud, debridLink, pikpak];

const storage = new MMKVLoader().withInstanceID('droid-stream-debrid').withEncryption().initialize();

export interface DebridSettings {
  keys: Partial<Record<DebridId, string>>;
  /** Service tried first for Stream and Download. */
  preferred?: DebridId;
  /** Check search results against caches when a key is present. */
  checkCache: boolean;
  /** Only show cached results when a cache check ran. */
  cachedOnly: boolean;
  /** Pick the largest video automatically instead of asking. */
  autoPickVideo: boolean;
}

const defaults = (): DebridSettings => ({keys: {}, checkCache: true, cachedOnly: false, autoPickVideo: true});

export const readDebridSettings = (): DebridSettings => {
  try {
    const raw = storage.getString('settings');
    return raw ? {...defaults(), ...JSON.parse(raw)} : defaults();
  } catch {
    return defaults();
  }
};

export const writeDebridSettings = (settings: DebridSettings): void => {
  storage.setString('settings', JSON.stringify(settings));
};

export const debridKey = (id: DebridId, settings = readDebridSettings()): string =>
  id === 'pikpak' ? settings.keys.pikpak || pikpakKey() : settings.keys[id] || '';

export const getService = (id: DebridId): DebridService => DEBRID_SERVICES.find(service => service.id === id)!;

/** Services with a key, preferred one first. */
export const connectedServices = (settings = readDebridSettings()): DebridService[] => {
  const list = DEBRID_SERVICES.filter(service => debridKey(service.id, settings));
  return list.sort((a, b) => Number(b.id === settings.preferred) - Number(a.id === settings.preferred));
};

/** hash → ids of services that already have it cached. */
export const checkAllCaches = async (hashes: string[]): Promise<Record<string, DebridId[]>> => {
  const settings = readDebridSettings();
  const result: Record<string, DebridId[]> = {};
  const unique = Array.from(new Set(hashes.filter(Boolean).map(hash => hash.toLowerCase())));
  if (!unique.length || !settings.checkCache) return result;
  await Promise.all(
    connectedServices(settings)
      .filter(service => service.canCheckCache)
      .map(async service => {
        try {
          const cached = await service.checkCached(debridKey(service.id, settings), unique);
          Object.entries(cached).forEach(([hash, yes]) => {
            if (yes) result[hash] = [...(result[hash] || []), service.id];
          });
        } catch {
          // A failing service just shows no badge.
        }
      }),
  );
  return result;
};

export const pickVideo = (files: DebridFile[]): DebridFile | undefined => {
  const videos = files.filter(file => VIDEO_FILE.test(file.name) && !/sample/i.test(file.name));
  return (videos.length ? videos : files).slice().sort((a, b) => b.size - a.size)[0];
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface DebridResolution {
  service: DebridService;
  transfer: DebridTransfer;
  files: DebridFile[];
}

/**
 * Sends a magnet to the service and waits until its files are ready.
 * Cached torrents finish in a second or two; others report progress until
 * `maxWaitMs`, then the caller can keep checking from the Debrid screen.
 */
export const sendToDebrid = async (
  id: DebridId,
  magnet: string,
  options: {onProgress?: (transfer: DebridTransfer) => void; maxWaitMs?: number; signal?: AbortSignal} = {},
): Promise<DebridResolution> => {
  const service = getService(id);
  const key = debridKey(id);
  if (!key) throw new Error(`Add your ${service.name} key in Torrents → Debrid and cloud first`);
  const {id: transferId} = await service.addMagnet(key, magnet);
  const deadline = Date.now() + (options.maxWaitMs ?? 45000);
  let delay = 1200;
  for (;;) {
    if (options.signal?.aborted) throw new Error('Cancelled');
    const transfer = await service.status(key, transferId);
    options.onProgress?.(transfer);
    if (transfer.error) throw new Error(`${service.name}: ${transfer.error}`);
    if (transfer.ready && transfer.files.length) return {service, transfer, files: transfer.files};
    if (Date.now() > deadline) {
      const error: Error & {transfer?: DebridTransfer} = new Error(`${service.name} is still downloading (${Math.round(transfer.progress * 100)}%). It will keep going in your account.`);
      error.transfer = transfer;
      throw error;
    }
    await wait(delay);
    delay = Math.min(5000, delay * 1.4);
  }
};

export const directLink = async (resolution: DebridResolution, file: DebridFile): Promise<string> =>
  resolution.service.fileLink(debridKey(resolution.service.id), resolution.transfer, file);
