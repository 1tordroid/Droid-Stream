/**
 * Sources that failed to play for a title, remembered for a few hours so
 * Play best and the source list put them last next time.
 */
import {openStore} from '../storage/openStore';

/** How long a failure counts. Links often come back later, so keep it short. */
export const FAILURE_TTL_MS = 6 * 60 * 60 * 1000;
/** Titles kept at most, so the store cannot grow without bound. */
const MAX_TITLES = 200;
const KEY = 'failures';

export interface TitleKey {
  title: string;
  imdbId?: string;
  season?: number;
  episode?: number;
}

/** title key -> candidate id -> when it failed */
export type FailureMap = Record<string, Record<string, number>>;

interface KeyValueStore {
  getString: (key: string) => string | undefined | null;
  setString: (key: string, value: string) => unknown;
}

let store: KeyValueStore | undefined;
const getStore = (): KeyValueStore => (store ||= openStore('droid-stream-play-best') as unknown as KeyValueStore);

/** For tests. */
export const setFailureStore = (next: KeyValueStore | undefined): void => {
  store = next;
};

export const titleKey = (want: TitleKey): string => `${want.imdbId || want.title.toLowerCase()}:${want.season ?? ''}:${want.episode ?? ''}`;

/** Drops expired entries and titles beyond the cap (oldest first). Pure. */
export const pruneFailures = (map: FailureMap, now: number, ttl = FAILURE_TTL_MS): FailureMap => {
  const titles = Object.entries(map)
    .map(([key, ids]) => [key, Object.fromEntries(Object.entries(ids).filter(([, at]) => now - at < ttl && at <= now))] as const)
    .filter(([, ids]) => Object.keys(ids).length > 0)
    .sort((a, b) => Math.max(...Object.values(b[1])) - Math.max(...Object.values(a[1])))
    .slice(0, MAX_TITLES);
  return Object.fromEntries(titles);
};

const read = (): FailureMap => {
  try {
    const parsed = JSON.parse(getStore().getString(KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const write = (map: FailureMap): void => {
  try {
    getStore().setString(KEY, JSON.stringify(map));
  } catch {
    // Memory of failures is a nicety; playback must not depend on it.
  }
};

export const rememberFailure = (want: TitleKey, candidateId: string, now = Date.now()): void => {
  const map = pruneFailures(read(), now);
  const key = titleKey(want);
  map[key] = {...map[key], [candidateId]: now};
  write(map);
};

/** A source that played after all is no longer counted as failed. */
export const forgetFailure = (want: TitleKey, candidateId: string, now = Date.now()): void => {
  const map = pruneFailures(read(), now);
  const key = titleKey(want);
  if (!map[key]?.[candidateId]) return;
  delete map[key][candidateId];
  if (!Object.keys(map[key]).length) delete map[key];
  write(map);
};

export const recentFailures = (want: TitleKey, now = Date.now()): Set<string> => {
  const ids = pruneFailures(read(), now)[titleKey(want)] || {};
  return new Set(Object.keys(ids));
};

/** Moves recently failed sources to the end, keeping the order otherwise. */
export const demoteFailed = <T extends {id: string}>(ranked: T[], failed: ReadonlySet<string>): T[] =>
  failed.size ? [...ranked.filter(item => !failed.has(item.id)), ...ranked.filter(item => failed.has(item.id))] : ranked;
