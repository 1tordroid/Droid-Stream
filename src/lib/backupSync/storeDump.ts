/**
 * Copies whole MMKV stores in and out of a backup, by value type, and the
 * merge rules for putting them back.
 */
import {MMKVLoader} from 'react-native-mmkv-storage';
import {openStore, type MMKVStore} from '../storage/openStore';
import {SECURE_STORE_IDS} from '../storage/secureStores';
import {PROFILE_LIVETV_KEYS} from '../profiles/profileData';

export type DumpType = 's' | 'n' | 'b' | 'm' | 'a';
export interface DumpValue {
  t: DumpType;
  v: unknown;
}
/** key -> typed value */
export type StoreDump = Record<string, DumpValue>;

export type RestoreMode = 'merge' | 'replace';

export interface StoreSpec {
  id: string;
  encrypted: boolean;
  /** Keys that go in a backup; others stay on this device. */
  include: (key: string) => boolean;
}

/** Keys that tell this install apart, and backup sync's own settings. */
const DEVICE_ONLY_KEYS = new Set(['install-id']);
export const isDeviceOnlyKey = (key: string): boolean => DEVICE_ONLY_KEYS.has(key) || key.startsWith('backup-sync.');

const LIVE_PROFILE_KEY = new RegExp(`^(p\\.[a-z0-9]{1,24}\\.)?(${PROFILE_LIVETV_KEYS.join('|')})$`);
/** Live TV playlists, the Jio server, guide addresses and each profile's favourites; not the caches. */
export const isLiveTvSetupKey = (key: string): boolean =>
  key === 'playlists' || key === 'jiotvServer' || key.startsWith('epgUrl:') || LIVE_PROFILE_KEY.test(key);

const all = (key: string) => !isDeviceOnlyKey(key);

/** Stores without sign-ins that a full backup carries next to the classic backup. */
export const PLAIN_STORES: StoreSpec[] = [
  {id: 'droid-stream-livetv', encrypted: false, include: isLiveTvSetupKey},
  {id: 'droid-stream-languages', encrypted: false, include: all},
  {id: 'droid-stream-browser', encrypted: false, include: all},
  {id: 'droid-stream-script-plugins', encrypted: false, include: all},
];

/**
 * Stores with sign-ins, keys and passwords: every encrypted store, and the
 * torrent search settings (indexer API keys). Only backed up with a passphrase.
 */
export const SECRET_STORES: StoreSpec[] = [
  ...SECURE_STORE_IDS.map(id => ({id, encrypted: true, include: all})),
  {id: 'droid-stream-torrent-search', encrypted: false, include: all},
];

/** The subset of MMKVStore this file uses, so tests can pass a plain fake. */
export interface DumpableStore {
  indexer: {
    getKeys(): Promise<string[]>;
    strings?: {getAll(): Promise<unknown>};
    numbers?: {getAll(): Promise<unknown>};
    booleans?: {getAll(): Promise<unknown>};
    maps?: {getAll(): Promise<unknown>};
    arrays?: {getAll(): Promise<unknown>};
  };
  getString(key: string): string | null | undefined;
  setString(key: string, value: string): unknown;
  setInt(key: string, value: number): unknown;
  setBool(key: string, value: boolean): unknown;
  setMap(key: string, value: object): unknown;
  setArray(key: string, value: unknown[]): unknown;
  getInt?(key: string): number | null | undefined;
  getBool?(key: string): boolean | null | undefined;
  getMap?(key: string): unknown;
  getArray?(key: string): unknown;
  removeItem(key: string): unknown;
}

export const openSpecStore = (spec: StoreSpec): DumpableStore =>
  (spec.encrypted
    ? new MMKVLoader().withInstanceID(spec.id).withEncryption().recoverOnKeyLoss().initialize()
    : (openStore(spec.id) as MMKVStore)) as unknown as DumpableStore;

const pairs = async (index?: {getAll(): Promise<unknown>}): Promise<Array<[string, unknown]>> => {
  if (!index) return [];
  const list = await index.getAll();
  return Array.isArray(list) ? (list.filter(item => Array.isArray(item) && typeof item[0] === 'string') as Array<[string, unknown]>) : [];
};

/** Every included key of [store], with its type. */
export const dumpStore = async (store: DumpableStore, include: (key: string) => boolean): Promise<StoreDump> => {
  const dump: StoreDump = {};
  const indexer = store.indexer;
  const add = (t: DumpType, entries: Array<[string, unknown]>, valid: (value: unknown) => boolean) => {
    for (const [key, value] of entries) if (include(key) && valid(value)) dump[key] = {t, v: value};
  };
  add('s', await pairs(indexer.strings), value => typeof value === 'string');
  add('n', await pairs(indexer.numbers), value => typeof value === 'number' && Number.isFinite(value));
  add('b', await pairs(indexer.booleans), value => typeof value === 'boolean');
  add('m', await pairs(indexer.maps), value => !!value && typeof value === 'object' && !Array.isArray(value));
  add('a', await pairs(indexer.arrays), value => Array.isArray(value));
  return dump;
};

export const isStoreDump = (value: unknown): value is StoreDump =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every(entry => {
    const item = entry as DumpValue;
    if (!item || typeof item !== 'object') return false;
    switch (item.t) {
      case 's':
        return typeof item.v === 'string';
      case 'n':
        return typeof item.v === 'number' && Number.isFinite(item.v);
      case 'b':
        return typeof item.v === 'boolean';
      case 'm':
        return !!item.v && typeof item.v === 'object' && !Array.isArray(item.v);
      case 'a':
        return Array.isArray(item.v);
      default:
        return false;
    }
  });

const IDENTITY_FIELDS = ['id', 'value', 'base', 'transportUrl', 'url', 'key', 'link'];
const identity = (item: unknown): string => {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    for (const field of IDENTITY_FIELDS) {
      const value = (item as Record<string, unknown>)[field];
      if (typeof value === 'string' || typeof value === 'number') return `${field}:${value}`;
    }
  }
  return `json:${JSON.stringify(item)}`;
};

/** This device's items first, then the backup's items it does not have. */
export const unionList = (local: unknown[], incoming: unknown[]): unknown[] => {
  const seen = new Set(local.map(identity));
  const out = [...local];
  for (const item of incoming) {
    const id = identity(item);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(item);
    }
  }
  return out;
};

const jsonArray = (text: unknown): unknown[] | undefined => {
  if (typeof text !== 'string' || !text.startsWith('[')) return undefined;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/**
 * What to write for one key when merging. Missing keys are added; lists
 * (also lists saved as JSON text) get the backup's missing items; any other
 * value already on this device stays. Returns undefined to leave the key.
 */
export const mergeValue = (local: DumpValue | undefined, incoming: DumpValue): DumpValue | undefined => {
  if (!local) return incoming;
  if (local.t === 'a' && incoming.t === 'a') {
    const merged = unionList(local.v as unknown[], incoming.v as unknown[]);
    return merged.length === (local.v as unknown[]).length ? undefined : {t: 'a', v: merged};
  }
  if (local.t === 's' && incoming.t === 's') {
    const localList = jsonArray(local.v);
    const incomingList = jsonArray(incoming.v);
    if (localList && incomingList) {
      const merged = unionList(localList, incomingList);
      return merged.length === localList.length ? undefined : {t: 's', v: JSON.stringify(merged)};
    }
  }
  return undefined;
};

const write = (store: DumpableStore, key: string, value: DumpValue) => {
  switch (value.t) {
    case 's':
      store.setString(key, value.v as string);
      break;
    case 'n':
      store.setInt(key, value.v as number);
      break;
    case 'b':
      store.setBool(key, value.v as boolean);
      break;
    case 'm':
      store.setMap(key, value.v as object);
      break;
    case 'a':
      store.setArray(key, value.v as unknown[]);
      break;
  }
};

/**
 * Puts a dump back. Merge adds what is missing (see [mergeValue]); replace
 * removes this device's included keys first, then writes the backup's.
 * Device-only keys are never touched. Returns the number of keys written.
 */
export const restoreStore = async (
  store: DumpableStore,
  dump: StoreDump,
  include: (key: string) => boolean,
  mode: RestoreMode,
): Promise<number> => {
  if (!isStoreDump(dump)) throw new Error('This backup is damaged');
  const allowed = (key: string) => include(key) && !isDeviceOnlyKey(key);
  const local = await dumpStore(store, allowed);
  let written = 0;
  if (mode === 'replace') {
    for (const key of Object.keys(local)) if (!(key in dump)) store.removeItem(key);
    for (const [key, value] of Object.entries(dump)) {
      if (!allowed(key)) continue;
      write(store, key, value);
      written += 1;
    }
    return written;
  }
  for (const [key, value] of Object.entries(dump)) {
    if (!allowed(key)) continue;
    const next = mergeValue(local[key], value);
    if (next) {
      write(store, key, next);
      written += 1;
    }
  }
  return written;
};

export const dumpStores = async (specs: StoreSpec[], open = openSpecStore): Promise<Record<string, StoreDump>> => {
  const out: Record<string, StoreDump> = {};
  for (const spec of specs) {
    try {
      const dump = await dumpStore(open(spec), spec.include);
      if (Object.keys(dump).length) out[spec.id] = dump;
    } catch (error) {
      // Only the store id; never its values.
      console.warn(`Backup: could not read store ${spec.id}`, error instanceof Error ? error.message : '');
    }
  }
  return out;
};

/** Restores the dumps whose store is in [specs]; unknown ids in a backup are ignored. */
export const restoreStores = async (
  dumps: Record<string, StoreDump> | undefined,
  specs: StoreSpec[],
  mode: RestoreMode,
  open = openSpecStore,
): Promise<number> => {
  if (!dumps) return 0;
  let written = 0;
  for (const spec of specs) {
    const dump = dumps[spec.id];
    if (dump) written += await restoreStore(open(spec), dump, spec.include, mode);
  }
  return written;
};
