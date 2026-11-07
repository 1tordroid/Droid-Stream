import {MMKVLoader} from 'react-native-mmkv-storage';
import {registerStorageClearHook} from '../storage/StorageService';
import type {NetlibLibrary, NetlibMatch, NetlibSource, NetlibSourceSettings} from './types';

/**
 * Library scans, title matches and library history. Its own instance: it is
 * not part of the settings backup or watch sync (it can be rebuilt by a
 * rescan), and Android Auto Backup skips it (plugins/with-backup-rules.js).
 * Erase all clears it.
 */
export const NETLIB_INSTANCE_ID = 'netlib';

const storage = new MMKVLoader().withInstanceID(NETLIB_INSTANCE_ID).initialize();

// Guarded: test doubles of StorageService often leave the hook list out.
if (typeof registerStorageClearHook === 'function') registerStorageClearHook(() => storage.clearStore());

const DAY = 24 * 60 * 60 * 1000;
/** TMDB allows caching; matches are kept for six months, misses for a week. */
export const MATCH_HIT_TTL = 180 * DAY;
export const MATCH_MISS_TTL = 7 * DAY;

const readJson = <T>(key: string): T | undefined => {
  const text = storage.getString(key);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
};

const writeJson = (key: string, value: unknown): void => {
  storage.setString(key, JSON.stringify(value));
};

interface CachedMatch {
  at: number;
  match?: NetlibMatch;
}

/**
 * The cached answer for a lookup key: a match, null for a recent miss, or
 * undefined when it has to be looked up (never asked, or expired).
 */
export const getCachedMatch = (key: string, now = Date.now()): NetlibMatch | null | undefined => {
  const cached = readJson<CachedMatch>(`match:${key}`);
  if (!cached) return undefined;
  const age = now - cached.at;
  if (cached.match) return age < MATCH_HIT_TTL ? cached.match : undefined;
  return age < MATCH_MISS_TTL ? null : undefined;
};

export const setCachedMatch = (key: string, match: NetlibMatch | undefined, now = Date.now()): void =>
  writeJson(`match:${key}`, {at: now, ...(match ? {match} : {})});

export const loadLibrary = (sourceId: string): NetlibLibrary | undefined => readJson<NetlibLibrary>(`library:${sourceId}`);

export const saveLibrary = (library: NetlibLibrary): void => writeJson(`library:${library.sourceId}`, library);

export const removeLibrary = (sourceId: string): void => {
  storage.removeItem(`library:${sourceId}`);
  storage.removeItem(`settings:${sourceId}`);
};

export const DEFAULT_SOURCE_SETTINGS: NetlibSourceSettings = {matchOnline: true};

export const getSourceSettings = (sourceId: string): NetlibSourceSettings => ({
  ...DEFAULT_SOURCE_SETTINGS,
  ...readJson<NetlibSourceSettings>(`settings:${sourceId}`),
});

export const setSourceSettings = (sourceId: string, patch: Partial<NetlibSourceSettings>): NetlibSourceSettings => {
  const next = {...getSourceSettings(sourceId), ...patch};
  writeJson(`settings:${sourceId}`, next);
  return next;
};

/** Device folders used as library sources. */
export const listDeviceSources = (): NetlibSource[] => readJson<NetlibSource[]>('device-sources') || [];

export const saveDeviceSource = (source: NetlibSource): void => {
  const list = listDeviceSources().filter(item => item.id !== source.id);
  writeJson('device-sources', [...list, source]);
};

export const removeDeviceSource = (id: string): void => {
  writeJson('device-sources', listDeviceSources().filter(item => item.id !== id));
  removeLibrary(id);
};

export const netlibStorage = {readJson, writeJson, remove: (key: string) => storage.removeItem(key)};
