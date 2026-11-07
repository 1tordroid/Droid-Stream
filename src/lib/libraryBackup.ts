import {mainStorage} from './storage/StorageService';
import {WatchListStorage, watchListStorage} from './storage/WatchListStorage';
import {getActiveProfileId} from './profiles/scope';
import {WatchListKeys, type WatchListItem, type LibraryCollection} from './storage/WatchListStorage';
import useWatchListStore from './zustand/watchListStore';

export interface LibraryBackup {
  items: WatchListItem[];
  collections: LibraryCollection[];
}

/** The library of the profile in use, or of [profileId]. */
export const createLibraryBackup = (profileId?: string): LibraryBackup => {
  const storage = profileId ? new WatchListStorage(profileId) : watchListStorage;
  return {items: storage.getWatchList(), collections: storage.getCollections()};
};

export const validateLibraryBackup = (value: unknown): void => {
  if (value === undefined) return;
  const library = value as LibraryBackup;
  const strings = (input: unknown) => Array.isArray(input) && input.every(id => typeof id === 'string');
  const timestamp = (input: unknown) => typeof input === 'number' && Number.isFinite(input);
  if (!library || !Array.isArray(library.items) || !Array.isArray(library.collections) ||
    !library.items.every(item => item && typeof item.title === 'string' && typeof item.link === 'string' &&
      typeof item.provider === 'string' && typeof item.poster === 'string' &&
      (item.collections === undefined || strings(item.collections)) &&
      (item.updatedAt === undefined || timestamp(item.updatedAt))) ||
    !library.collections.every(collection => collection && typeof collection.id === 'string' &&
      typeof collection.name === 'string' && typeof collection.icon === 'string' &&
      (collection.color === undefined || typeof collection.color === 'string') &&
      timestamp(collection.createdAt) && timestamp(collection.updatedAt))) {
    throw new Error('This backup contains an invalid library');
  }
};

/** Replaces the library of the profile in use, or of [profileId]. */
export const restoreLibraryBackup = (library?: LibraryBackup, profileId?: string): void => {
  if (library === undefined) return;
  validateLibraryBackup(library);
  const storage = new WatchListStorage(profileId);
  mainStorage.setArray(storage.key(WatchListKeys.WATCH_LIST), library.items);
  mainStorage.setArray(storage.key(WatchListKeys.COLLECTIONS), library.collections);
  // Preserve an intentionally deleted default category, including an empty library.
  mainStorage.setBool(storage.key(WatchListKeys.DEFAULT_COLLECTION_ADDED), true);
  if (!profileId || profileId === getActiveProfileId()) {
    useWatchListStore.setState({watchList: library.items, collections: library.collections});
  }
};
