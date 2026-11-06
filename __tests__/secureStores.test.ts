import fs from 'fs';
import path from 'path';
import {MMKVLoader} from 'react-native-mmkv-storage';
import {readDebridSettings, writeDebridSettings} from '../src/lib/debrid';
import {
  listSources,
  readPikPakAccount,
  readPikPakUsername,
  saveSource,
  savePikPakAccount,
} from '../src/lib/sources/vault';
import {clearAllMMKVStorage} from '../src/lib/storage/StorageService';
import {clearSignInStores, SECURE_STORE_IDS} from '../src/lib/storage/secureStores';
import {sourceTokenStorage} from '../src/lib/storage/sourceTokenStorage';
import {readAddons, writeAddons} from '../src/lib/stremio';
import {readSyncSettings, updateAccount} from '../src/lib/watchSync';
const {ENCRYPTED_INSTANCE_IDS} = require('../plugins/with-backup-rules');

type LoaderWithId = MMKVLoader & {id: string};

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js)$/.test(entry.name) ? [full] : [];
  });

/** Every instance id the app opens with withEncryption(), read from the source. */
const encryptedIdsInSource = (): string[] => {
  const ids = new Set<string>();
  const pattern = /withInstanceID\(\s*['"]([^'"]+)['"]\s*\)\s*\.withEncryption\(\)/g;
  for (const file of sourceFiles(path.join(__dirname, '..', 'src'))) {
    if (file.endsWith('secureStores.ts')) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) ids.add(match[1]);
  }
  return [...ids].sort();
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('encrypted store list', () => {
  it('names every encrypted MMKV instance in the source, in both the app and the backup rules', () => {
    const fromSource = encryptedIdsInSource();
    expect(fromSource.length).toBeGreaterThanOrEqual(6);
    expect([...SECURE_STORE_IDS].sort()).toEqual(fromSource);
    expect([...ENCRYPTED_INSTANCE_IDS].sort()).toEqual(fromSource);
  });
});

describe('clearSignInStores', () => {
  it('erases every saved sign-in together with the other stores', () => {
    savePikPakAccount({username: 'user@example.com', accessToken: 'a', refreshToken: 'r', expiresAt: 1});
    saveSource({id: 's1', kind: 'jellyfin', name: 'Home', server: 'http://h', username: 'u', secret: 'x'});
    writeDebridSettings({...readDebridSettings(), keys: {torbox: 'k'}});
    updateAccount('trakt', {accessToken: 't', refreshToken: 'tr'});
    sourceTokenStorage.set('author', 'ghp_token');
    writeAddons([{base: 'https://addon.test/cfg', manifest: {id: 'a', name: 'A', types: [], resources: []}, enabled: true, addedAt: 1}]);

    clearAllMMKVStorage();
    clearSignInStores();

    expect(readPikPakAccount()).toBeUndefined();
    expect(readPikPakUsername()).toBe('');
    expect(listSources()).toEqual([]);
    expect(readDebridSettings().keys).toEqual({});
    expect(readSyncSettings().trakt.accessToken).toBeUndefined();
    expect(readSyncSettings().trakt.refreshToken).toBeUndefined();
    expect(sourceTokenStorage.get('author')).toBeUndefined();
    expect(readAddons()).toEqual([]);
  });

  it('opens each store encrypted, so a store that does not exist yet is never created in the clear', () => {
    const encrypted: string[] = [];
    const original = MMKVLoader.prototype.withEncryption;
    jest.spyOn(MMKVLoader.prototype, 'withEncryption').mockImplementation(function (this: LoaderWithId) {
      encrypted.push(this.id);
      return original.call(this);
    });

    clearSignInStores();

    expect(encrypted).toEqual([...SECURE_STORE_IDS]);
  });

  it('keeps clearing the other stores when one fails', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const original = MMKVLoader.prototype.initialize;
    jest.spyOn(MMKVLoader.prototype, 'initialize').mockImplementation(function (this: LoaderWithId) {
      const store = original.call(this);
      if (this.id === 'droid-stream-debrid') {
        // Restored by jest.restoreAllMocks() after the test.
        jest.spyOn(store, 'clearStore').mockImplementation(() => {
          throw new Error('locked');
        });
      }
      return store;
    });
    savePikPakAccount({username: 'user@example.com', accessToken: 'a'});
    updateAccount('simkl', {accessToken: 's'});

    expect(() => clearSignInStores()).not.toThrow();

    expect(readPikPakAccount()).toBeUndefined();
    expect(readSyncSettings().simkl.accessToken).toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(String((console.error as jest.Mock).mock.calls[0][0])).toContain('droid-stream-debrid');
  });
});
