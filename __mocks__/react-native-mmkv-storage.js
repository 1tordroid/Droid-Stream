// In-memory stand-in for the native MMKV bindings, used by every test that
// does not install its own jest.mock('react-native-mmkv-storage').
const createStore = () => {
  const values = new Map();
  const get = key => (values.has(key) ? values.get(key) : undefined);
  const set = (key, value) => {
    values.set(key, value);
    return true;
  };
  return {
    getString: get,
    setString: set,
    getBool: get,
    setBool: set,
    getInt: get,
    setInt: set,
    getMap: get,
    setMap: set,
    getArray: get,
    setArray: set,
    getStringAsync: async key => get(key),
    setStringAsync: async (key, value) => set(key, value),
    getBoolAsync: async key => get(key),
    setBoolAsync: async (key, value) => set(key, value),
    getMapAsync: async key => get(key),
    setMapAsync: async (key, value) => set(key, value),
    removeItem: key => values.delete(key),
    clearStore: () => values.clear(),
    getAllKeys: () => Array.from(values.keys()),
    indexer: {getKeys: async () => Array.from(values.keys())},
  };
};

const stores = new Map();

class KeyUnavailableError extends Error {
  constructor(instanceID) {
    super(`Encryption key for storage "${instanceID}" could not be read.`);
    this.name = 'KeyUnavailableError';
    this.instanceID = instanceID;
  }
}

class InitializationError extends Error {
  constructor(instanceID) {
    super(`Storage "${instanceID}" could not be opened.`);
    this.name = 'InitializationError';
    this.instanceID = instanceID;
  }
}

class MMKVLoader {
  constructor() {
    this.id = 'default';
  }
  withInstanceID(id) {
    this.id = id;
    return this;
  }
  withEncryption() {
    return this;
  }
  recoverOnKeyLoss() {
    return this;
  }
  withSynchronizableKey() {
    return this;
  }
  setProcessingMode() {
    return this;
  }
  setAccessibleIOS() {
    return this;
  }
  initialize() {
    if (!stores.has(this.id)) stores.set(this.id, createStore());
    return stores.get(this.id);
  }
}

const useMMKVStorage = (key, storage, initial) => {
  const React = require('react');
  const [value, setValue] = React.useState(() => {
    const raw = storage?.getString?.(key);
    return raw === undefined ? initial : raw;
  });
  return [value, next => {
    storage?.setString?.(key, next);
    setValue(next);
  }];
};

module.exports = {
  MMKVLoader,
  MMKVInstance: class {},
  ProcessingModes: {SINGLE_PROCESS: 1, MULTI_PROCESS: 2},
  IOSAccessibleStates: {},
  useMMKVStorage,
  KeyUnavailableError,
  InitializationError,
  create: () => () => [undefined, () => undefined],
};
