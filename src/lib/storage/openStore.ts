import {InitializationError, MMKVLoader} from 'react-native-mmkv-storage';

export type MMKVStore = ReturnType<MMKVLoader['initialize']>;

/**
 * Session-only stand-in with the calls the app makes, for a store whose file
 * cannot be opened. Settings then reset at the next launch instead of the
 * whole app failing at import time.
 */
const memoryStore = (): MMKVStore => {
  const values = new Map<string, unknown>();
  const get = (key: string): any => values.get(key) ?? undefined;
  const set = (key: string, value: unknown) => {
    values.set(key, value);
    return true;
  };
  const store = {
    getString: get, setString: set, getBool: get, setBool: set,
    getInt: get, setInt: set, getMap: get, setMap: set,
    getArray: get, setArray: set, getItem: get, setItem: set,
    getStringAsync: async (key: string) => get(key),
    setStringAsync: async (key: string, value: unknown) => set(key, value),
    removeItem: (key: string) => values.delete(key),
    clearStore: () => {
      values.clear();
      return true;
    },
    getAllKeys: () => [...values.keys()],
    indexer: {
      getKeys: async () => [...values.keys()],
      hasKey: (key: string) => values.has(key),
    },
  };
  return store as unknown as MMKVStore;
};

/**
 * Opens a plain (unencrypted) MMKV store, the default one when [id] is empty.
 * mmkv 13 throws InitializationError when the native instance cannot be set
 * up; one retry covers a transient failure, then the store lives in memory.
 */
export const openStore = (id?: string): MMKVStore => {
  const open = () => {
    const loader = new MMKVLoader();
    return (id ? loader.withInstanceID(id) : loader).initialize();
  };
  try {
    return open();
  } catch (error) {
    if (!(error instanceof InitializationError)) throw error;
    try {
      return open();
    } catch (retryError) {
      if (!(retryError instanceof InitializationError)) throw retryError;
      console.error(`Storage "${id || 'default'}" could not be opened; using memory for this session`, retryError);
      return memoryStore();
    }
  }
};
