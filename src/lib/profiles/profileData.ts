import {mainStorage} from '../storage/StorageService';
import {openStore} from '../storage/openStore';
import {WatchListKeys} from '../storage/WatchListStorage';
import {WatchProgressStorage, type WatchProgress} from '../storage/WatchProgressStorage';
import {CONTINUE_WATCHING_KEY, type ContinueWatchingItem} from '../zustand/continueWatchingStore';
import {createLibraryBackup, restoreLibraryBackup, type LibraryBackup} from '../libraryBackup';
import {netlibStorage} from '../netlib/cache';
import {NETLIB_HISTORY_KEY} from '../netlib/history';
import {watchSyncBaseStorage} from '../watchSync';
import {profileKey, profileKeyPrefix} from './scope';

/**
 * Everything a profile owns, by store. The default profile owns the bare
 * keys; others own "p.<id>.<key>" (see scope.ts). Shared data (providers,
 * debrid, sources, downloads, settings) is not listed here.
 */
export const PROFILE_MAIN_KEYS = [
  WatchListKeys.WATCH_LIST,
  WatchListKeys.COLLECTIONS,
  WatchListKeys.DEFAULT_COLLECTION_ADDED,
  CONTINUE_WATCHING_KEY,
  'searchHistory',
  'library-selected-filter',
] as const;
export const LIVETV_INSTANCE_ID = 'droid-stream-livetv';
export const PROFILE_LIVETV_KEYS = ['favourites', 'recent', 'liveFilters'] as const;
export const LANGUAGES_INSTANCE_ID = 'droid-stream-languages';
export const PROFILE_LANGUAGE_KEYS = ['prefs'] as const;

/** Continue watching saved by zustand persist: {state: {items}, version}. */
const readHistory = (profileId: string): ContinueWatchingItem[] => {
  try {
    const parsed = JSON.parse(mainStorage.getString(profileKey(CONTINUE_WATCHING_KEY, profileId)) || 'null');
    const items = parsed?.state?.items;
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
};

const writeHistory = (profileId: string, items: ContinueWatchingItem[]) => {
  const key = profileKey(CONTINUE_WATCHING_KEY, profileId);
  let version = 0;
  try {
    version = JSON.parse(mainStorage.getString(key) || 'null')?.version ?? 0;
  } catch {}
  mainStorage.setString(key, JSON.stringify({state: {items}, version}));
};

/** Continue watching keeps 30 titles; newer entries win. */
export const mergeHistoryItems = (
  local: ContinueWatchingItem[],
  imported: ContinueWatchingItem[],
): ContinueWatchingItem[] => {
  const byId = new Map<string, ContinueWatchingItem>();
  for (const item of local) byId.set(item.id, item);
  for (const item of imported) {
    const existing = byId.get(item.id);
    if (!existing || item.updatedAt > existing.updatedAt) byId.set(item.id, item);
  }
  return Array.from(byId.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 30);
};

/** Positions to write: missing ones, and ones further along than the saved one. */
export const progressUpdates = (
  local: (key: string) => WatchProgress | null,
  imported: Record<string, WatchProgress>,
): Record<string, WatchProgress> => {
  const updates: Record<string, WatchProgress> = {};
  for (const [key, value] of Object.entries(imported)) {
    const saved = local(key);
    if (!saved) {
      updates[key] = value;
      continue;
    }
    const savedRatio = saved.duration > 0 ? saved.position / saved.duration : 0;
    const importRatio = value.duration > 0 ? value.position / value.duration : 0;
    if (importRatio > savedRatio) updates[key] = value;
  }
  return updates;
};

export interface ProfileData {
  library?: LibraryBackup;
  history?: ContinueWatchingItem[];
  progress?: Record<string, WatchProgress>;
}

export interface ProfileDataSelection {
  library: boolean;
  history: boolean;
  progress: boolean;
}

/** A profile's library, Continue watching and positions, read from storage. */
export const readProfileData = (profileId: string, selection: ProfileDataSelection): ProfileData => ({
  ...(selection.library ? {library: createLibraryBackup(profileId)} : {}),
  ...(selection.history ? {history: readHistory(profileId)} : {}),
  ...(selection.progress ? {progress: new WatchProgressStorage(profileId).getAllProgress()} : {}),
});

/**
 * Restores into a profile that is not in use, straight into storage (the
 * app restarts after a restore). The library is replaced; Continue watching
 * and positions are merged like the profile in use.
 */
export const writeProfileData = (profileId: string, data: ProfileData): void => {
  if (data.library) restoreLibraryBackup(data.library, profileId);
  if (data.history) writeHistory(profileId, mergeHistoryItems(readHistory(profileId), data.history));
  if (data.progress) {
    const storage = new WatchProgressStorage(profileId);
    const updates = progressUpdates(key => storage.getProgress(key), data.progress);
    if (Object.keys(updates).length) storage.setAllProgress(updates);
  }
};

const ownsKey = (profileId: string, key: string): boolean => {
  const prefix = profileKeyPrefix(profileId);
  // The default profile owns every key that is not under another profile.
  return prefix ? key.startsWith(prefix) : !key.startsWith('p.');
};

/**
 * Clears what a deleted profile owned. Shared data is left alone. The
 * profile's empty positions file stays on disk; MMKV cannot delete it.
 */
export const deleteProfileData = async (profileId: string): Promise<void> => {
  for (const key of PROFILE_MAIN_KEYS) mainStorage.delete(profileKey(key, profileId));
  new WatchProgressStorage(profileId).clearAllProgress();
  const live = openStore(LIVETV_INSTANCE_ID);
  for (const key of PROFILE_LIVETV_KEYS) live.removeItem(profileKey(key, profileId));
  const languages = openStore(LANGUAGES_INSTANCE_ID);
  for (const key of PROFILE_LANGUAGE_KEYS) languages.removeItem(profileKey(key, profileId));
  netlibStorage.remove(profileKey(NETLIB_HISTORY_KEY, profileId));
  try {
    const keys: string[] = (await watchSyncBaseStorage.indexer.getKeys()) || [];
    for (const key of keys) if (ownsKey(profileId, key)) watchSyncBaseStorage.removeItem(key);
  } catch (error) {
    console.warn('Could not clear the profile sign-ins:', error);
  }
};
