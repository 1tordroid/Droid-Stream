import {registerStorageClearHook} from '../storage/StorageService';
import {netlibStorage} from './cache';

/** Where a library title was left: the file (version key) and the position in it. */
export interface NetlibHistoryEntry {
  itemId: string;
  key: string;
  position: number;
  duration: number;
  updatedAt: number;
  /** Removed from Continue Watching; playing again brings it back. */
  hidden?: boolean;
}

/** Past this share of a file, it counts as watched. */
export const WATCHED_SHARE = 0.85;

export const isWatchedProgress = (position: number, duration: number): boolean =>
  duration > 0 && position / duration > WATCHED_SHARE;

const KEY = 'history';
const MAX_ENTRIES = 200;

export const readNetlibHistory = (): NetlibHistoryEntry[] => netlibStorage.readJson<NetlibHistoryEntry[]>(KEY) || [];

export const historyFor = (itemId: string): NetlibHistoryEntry | undefined =>
  getNetlibHistorySnapshot().find(entry => entry.itemId === itemId);

const listeners = new Set<() => void>();
export const subscribeNetlibHistory = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let snapshot: NetlibHistoryEntry[] | undefined;

/** The same array until history changes, for useSyncExternalStore. */
export const getNetlibHistorySnapshot = (): NetlibHistoryEntry[] => {
  if (!snapshot) snapshot = readNetlibHistory();
  return snapshot;
};

const write = (entries: NetlibHistoryEntry[]) => {
  netlibStorage.writeJson(KEY, entries.slice(0, MAX_ENTRIES));
  snapshot = undefined;
  listeners.forEach(listener => listener());
};

/** Saves where a library title was left, newest first. */
export const saveNetlibHistory = (itemId: string, key: string, position: number, duration: number, now = Date.now()): void => {
  if (!itemId || !key || !Number.isFinite(position) || position < 0 || !Number.isFinite(duration) || duration <= 0) return;
  const rest = readNetlibHistory().filter(entry => entry.itemId !== itemId);
  write([{itemId, key, position: Math.min(position, duration), duration, updatedAt: now}, ...rest]);
};

export const hideNetlibHistory = (itemId: string): void =>
  write(readNetlibHistory().map(entry => (entry.itemId === itemId ? {...entry, hidden: true} : entry)));

export const clearNetlibHistory = (itemId: string): void => write(readNetlibHistory().filter(entry => entry.itemId !== itemId));

// Erase all empties the store; the next read must not return the old list.
if (typeof registerStorageClearHook === 'function') {
  registerStorageClearHook(() => {
    snapshot = undefined;
    listeners.forEach(listener => listener());
  });
}
