/**
 * What a sync backup and a setup transfer carry, and how they are put back.
 *
 * Both reuse the classic backup (backup.ts) for settings, providers, library,
 * history, positions and profiles, and add whole MMKV stores for the rest
 * (storeDump.ts). Sign-in stores only travel encrypted: in a sync backup
 * under the passphrase, in a transfer under the key from the code.
 */
import {Platform} from 'react-native';
import {createBackup, parseBackup, restoreBackup, type BackupSelection, type VegaBackup} from '../backup';
import {isTV} from '../tv/constants';
import {decryptWithPassphrase, encryptWithPassphrase, nativeCrypto, type CryptoBackend} from './crypto';
import {
  dumpStores,
  isStoreDump,
  PLAIN_STORES,
  restoreStores,
  SECRET_STORES,
  unionList,
  type RestoreMode,
  type StoreDump,
  type StoreSpec,
} from './storeDump';

const EVERYTHING: BackupSelection = {settings: true, library: true, providers: true, history: true, progress: true};

export const deviceName = (): string => {
  const constants = (Platform.constants || {}) as {Model?: string; Brand?: string; Manufacturer?: string};
  const model = constants.Model?.trim();
  const brand = (constants.Brand || constants.Manufacturer || '').trim();
  if (!model) return isTV ? 'TV' : 'Phone';
  return brand && !model.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${model}` : model;
};

// ---- Merge rules for the classic backup part ----

const listOr = <T,>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);

/**
 * The backup to restore when merging: settings this device already has
 * stay; providers, sources, modules and libraries are combined (this
 * device's copy of an item stays). History and positions are always
 * combined by restoreBackup itself.
 */
export const mergeBackupWithLocal = (incoming: VegaBackup, local: VegaBackup): VegaBackup => {
  const merged: VegaBackup = {...incoming};
  if (incoming.settings) {
    const settings: NonNullable<VegaBackup['settings']> = {};
    for (const [key, value] of Object.entries(incoming.settings)) {
      if (!local.settings || !(key in local.settings)) settings[key] = value;
    }
    merged.settings = settings;
  }
  if (incoming.providers) {
    const mine = local.providers;
    merged.providers = {
      installed: unionList(listOr(mine?.installed), incoming.providers.installed) as typeof incoming.providers.installed,
      sources: unionList(listOr(mine?.sources), incoming.providers.sources) as typeof incoming.providers.sources,
      modules: unionList(listOr(mine?.modules), incoming.providers.modules) as typeof incoming.providers.modules,
      disabled: [...new Set([...listOr(mine?.disabled), ...listOr(incoming.providers.disabled)])],
      selected: mine?.selected || incoming.providers.selected,
    };
  }
  const localLibrary = (profileId: string) =>
    profileId === (local.profiles?.current ?? profileId) ? local.library : local.profiles?.data?.[profileId]?.library;
  const mergeLibrary = (mine: VegaBackup['library'], theirs: VegaBackup['library']) =>
    theirs && mine
      ? {
          items: unionList(mine.items, theirs.items) as typeof theirs.items,
          collections: unionList(mine.collections, theirs.collections) as typeof theirs.collections,
        }
      : theirs;
  const target = incoming.profiles?.current ?? local.profiles?.current ?? 'default';
  if (incoming.library) merged.library = mergeLibrary(localLibrary(target), incoming.library);
  if (incoming.profiles?.data) {
    const data: NonNullable<NonNullable<VegaBackup['profiles']>['data']> = {};
    for (const [id, item] of Object.entries(incoming.profiles.data)) {
      data[id] = item.library ? {...item, library: mergeLibrary(localLibrary(id), item.library)} : item;
    }
    merged.profiles = {...incoming.profiles, data};
  }
  return merged;
};

const restoreClassic = (backup: VegaBackup | undefined, mode: RestoreMode) => {
  if (!backup) return;
  restoreBackup(mode === 'merge' ? mergeBackupWithLocal(backup, createBackup(EVERYTHING)) : backup);
};

/** Validates the classic part with the same checks as a backup file. */
const checkClassic = (backup: unknown): VegaBackup | undefined =>
  backup === undefined || backup === null ? undefined : parseBackup(JSON.stringify(backup));

const checkDumps = (value: unknown, specs: StoreSpec[]): Record<string, StoreDump> => {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('This backup is damaged');
  const known = new Set(specs.map(spec => spec.id));
  const out: Record<string, StoreDump> = {};
  for (const [id, dump] of Object.entries(value)) {
    if (!known.has(id)) continue;
    if (!isStoreDump(dump)) throw new Error('This backup is damaged');
    out[id] = dump;
  }
  return out;
};

// ---- Sync backup files ----

export const SYNC_APP = 'droid-stream-sync';
export const SYNC_FORMAT = 1;

export interface SyncBackupFile {
  app: typeof SYNC_APP;
  format: number;
  createdAt: string;
  device: {name: string; tv: boolean};
  backup: VegaBackup;
  stores: Record<string, StoreDump>;
  /** Encrypted {stores} of sign-ins (crypto.ts envelope); absent without a passphrase. */
  secrets?: string;
}

export interface SyncContent {
  backup: VegaBackup;
  stores: Record<string, StoreDump>;
  secretStores?: Record<string, StoreDump>;
}

/** Reads everything a sync backup carries. Sign-ins only when [withSecrets]. */
export const collectSyncContent = async (withSecrets: boolean): Promise<SyncContent> => ({
  backup: createBackup(EVERYTHING),
  stores: await dumpStores(PLAIN_STORES),
  ...(withSecrets ? {secretStores: await dumpStores(SECRET_STORES)} : {}),
});

/** FNV-1a (32-bit) and length of the content without its time stamp, for "back up when something changes". */
export const fingerprintContent = (content: SyncContent): string => {
  const backup: Partial<VegaBackup> = {...content.backup};
  delete backup.createdAt;
  const text = JSON.stringify([backup, content.stores, content.secretStores || null]);
  let high = 0x811c;
  let low = 0x9dc5;
  for (let index = 0; index < text.length; index += 1) {
    // eslint-disable-next-line no-bitwise -- FNV-1a
    low ^= text.charCodeAt(index);
    // Multiply the 32-bit pair by the FNV prime (0x01000193) in 16-bit halves.
    const lowProduct = low * 0x0193;
    const highProduct = high * 0x0193 + low * 0x0100 + Math.floor(lowProduct / 0x10000);
    low = lowProduct % 0x10000;
    high = highProduct % 0x10000;
  }
  return `${text.length.toString(36)}-${(high * 0x10000 + low).toString(36)}`;
};

export const buildSyncFile = async (
  content: SyncContent,
  passphrase: string,
  backend: CryptoBackend = nativeCrypto,
  now = Date.now(),
): Promise<SyncBackupFile> => ({
  app: SYNC_APP,
  format: SYNC_FORMAT,
  createdAt: new Date(now).toISOString(),
  device: {name: deviceName(), tv: isTV},
  backup: content.backup,
  stores: content.stores,
  ...(content.secretStores && passphrase
    ? {secrets: await encryptWithPassphrase(JSON.stringify({stores: content.secretStores}), passphrase, backend)}
    : {}),
});

export const parseSyncFile = (text: string): SyncBackupFile => {
  let data: SyncBackupFile;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not a Droid Stream backup');
  }
  if (data?.app !== SYNC_APP || typeof data.format !== 'number') throw new Error('This is not a Droid Stream backup');
  if (data.format > SYNC_FORMAT) throw new Error('This backup was made by a newer version of Droid Stream');
  if (data.secrets !== undefined && typeof data.secrets !== 'string') throw new Error('This backup is damaged');
  return data;
};

export interface RestoreOptions {
  mode: RestoreMode;
  /** Needed when the file has sign-ins and [skipSecrets] is false. */
  passphrase?: string;
  skipSecrets?: boolean;
  backend?: CryptoBackend;
}

/**
 * Checks and decrypts everything first, so a wrong passphrase or a damaged
 * file changes nothing; then restores. The app should restart afterwards.
 */
export const restoreSyncFile = async (file: SyncBackupFile, options: RestoreOptions): Promise<void> => {
  const backup = checkClassic(file.backup);
  const stores = checkDumps(file.stores, PLAIN_STORES);
  let secretStores: Record<string, StoreDump> = {};
  if (file.secrets && !options.skipSecrets) {
    const plain = await decryptWithPassphrase(file.secrets, options.passphrase || '', options.backend);
    let parsed: {stores?: unknown};
    try {
      parsed = JSON.parse(plain);
    } catch {
      throw new Error('This backup is damaged');
    }
    secretStores = checkDumps(parsed.stores, SECRET_STORES);
  }
  restoreClassic(backup, options.mode);
  await restoreStores(stores, PLAIN_STORES, options.mode);
  await restoreStores(secretStores, SECRET_STORES, options.mode);
};

// ---- Setup transfer ----

export const SETUP_SECTIONS = ['providers', 'addons', 'debrid', 'sources', 'livetv', 'player', 'profiles'] as const;
export type SetupSection = (typeof SETUP_SECTIONS)[number];

export const SECTION_LABELS: Record<SetupSection, {title: string; description: string}> = {
  providers: {title: 'Providers and extensions', description: 'Installed providers, provider sources and script plugins'},
  addons: {title: 'Add-ons', description: 'Stremio add-ons'},
  debrid: {title: 'Debrid keys', description: 'Debrid services and their keys'},
  sources: {title: 'Sources and sign-ins', description: 'WebDAV, SMB, media servers, PikPak, Trakt, torrent and search sites'},
  livetv: {title: 'Live TV playlists', description: 'Playlists, guides, favourites and the Jio server'},
  player: {title: 'Player and app settings', description: 'Player, subtitles, languages and other settings'},
  profiles: {title: 'Profiles', description: 'Profiles with their libraries and Continue watching'},
};

const spec = (id: string): StoreSpec => {
  const found = [...PLAIN_STORES, ...SECRET_STORES].find(item => item.id === id);
  if (!found) throw new Error(`Unknown store ${id}`);
  return found;
};

export const SECTION_STORES: Record<SetupSection, StoreSpec[]> = {
  providers: [spec('droid-stream-script-plugins'), spec('provider-source-tokens')],
  addons: [spec('droid-stream-stremio')],
  debrid: [spec('droid-stream-debrid')],
  sources: [
    spec('droid-stream-sources'),
    spec('droid-stream-watch-sync'),
    spec('droid-stream-ftp'),
    spec('droid-stream-torrents'),
    spec('droid-stream-torrent-search'),
  ],
  livetv: [spec('droid-stream-livetv'), spec('droid-stream-jiotv')],
  player: [spec('droid-stream-languages')],
  profiles: [spec('droid-stream-profiles')],
};

export const SETUP_APP = 'droid-stream-setup';

export interface SetupPayload {
  app: typeof SETUP_APP;
  v: number;
  from: string;
  createdAt: string;
  sections: SetupSection[];
  backup?: VegaBackup;
  stores: Record<string, StoreDump>;
}

const storesFor = (sections: SetupSection[]): StoreSpec[] => sections.flatMap(section => SECTION_STORES[section]);

export const pickClassic = (full: VegaBackup, sections: SetupSection[]): VegaBackup | undefined => {
  const has = (section: SetupSection) => sections.includes(section);
  const picked: VegaBackup = {app: full.app, version: full.version, createdAt: full.createdAt};
  if (has('providers') && full.providers) picked.providers = full.providers;
  if (has('player') && full.settings) picked.settings = full.settings;
  if (has('profiles')) {
    if (full.profiles) picked.profiles = full.profiles;
    if (full.library) picked.library = full.library;
    if (full.history) picked.history = full.history;
    if (full.progress) picked.progress = full.progress;
  }
  const any = picked.providers || picked.settings || picked.library || picked.history || picked.progress;
  return any ? picked : undefined;
};

export const createSetupPayload = async (sections: SetupSection[], now = Date.now()): Promise<SetupPayload> => {
  if (!sections.length) throw new Error('Choose what to send');
  const backup = pickClassic(createBackup(EVERYTHING), sections);
  return {
    app: SETUP_APP,
    v: 1,
    from: deviceName(),
    createdAt: new Date(now).toISOString(),
    sections,
    ...(backup ? {backup} : {}),
    stores: await dumpStores(storesFor(sections)),
  };
};

/** Checks a received payload; throws when anything is off. */
export const parseSetupPayload = (text: string): SetupPayload => {
  let data: SetupPayload;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The setup could not be read');
  }
  if (data?.app !== SETUP_APP || data.v !== 1 || !Array.isArray(data.sections)) {
    throw new Error('The setup could not be read');
  }
  const sections = data.sections.filter((item): item is SetupSection => (SETUP_SECTIONS as readonly string[]).includes(item));
  return {
    app: SETUP_APP,
    v: 1,
    from: typeof data.from === 'string' ? data.from.slice(0, 80) : 'Another device',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    sections,
    ...(data.backup ? {backup: checkClassic(data.backup)} : {}),
    stores: checkDumps(data.stores, storesFor(sections)),
  };
};

const countJsonList = (dump: StoreDump | undefined, key: string): number => {
  const value = dump?.[key];
  if (!value) return 0;
  if (value.t === 'a') return (value.v as unknown[]).length;
  if (value.t === 's') {
    try {
      const parsed = JSON.parse(value.v as string);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** One line per section, for the confirm screen. */
export const summarizeSetup = (payload: SetupPayload): string[] =>
  payload.sections.map(section => {
    const title = SECTION_LABELS[section].title;
    switch (section) {
      case 'providers':
        return `${title}: ${plural(payload.backup?.providers?.installed.length ?? 0, 'provider')}`;
      case 'addons':
        return `${title}: ${plural(countJsonList(payload.stores['droid-stream-stremio'], 'addons'), 'add-on')}`;
      case 'sources':
        return `${title}: ${plural(countJsonList(payload.stores['droid-stream-sources'], 'sources'), 'source')}`;
      case 'livetv':
        return `${title}: ${plural(countJsonList(payload.stores['droid-stream-livetv'], 'playlists'), 'playlist')}`;
      case 'profiles':
        return `${title}: ${plural(payload.backup?.profiles?.list.length ?? 1, 'profile')}`;
      case 'player':
        return `${title}: ${plural(Object.keys(payload.backup?.settings || {}).length, 'setting')}`;
      default:
        return title;
    }
  });

/** Applies a received setup. The app should restart afterwards. */
export const applySetupPayload = async (payload: SetupPayload, mode: RestoreMode): Promise<void> => {
  restoreClassic(payload.backup, mode);
  await restoreStores(payload.stores, storesFor(payload.sections), mode);
};
