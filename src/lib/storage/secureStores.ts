import {MMKVLoader} from 'react-native-mmkv-storage';

/**
 * Every MMKV instance opened with withEncryption(): saved sign-ins (Sources,
 * PikPak, debrid, watch sync), Stremio add-ons, torrent settings with the
 * proxy password, and private provider source tokens. plugins/
 * with-backup-rules.js keeps the same list out of Auto Backup; a Jest test
 * checks both lists against the source.
 */
export const SECURE_STORE_IDS = [
  'droid-stream-sources',
  'droid-stream-debrid',
  'droid-stream-watch-sync',
  'droid-stream-stremio',
  'droid-stream-torrents',
  'provider-source-tokens',
] as const;

/**
 * Empties every encrypted store. An explicit list, not a clear hook in each
 * module: a hook registers only once its module is imported, and some stores
 * open lazily. Each store opens with withEncryption() so a store that does
 * not exist yet is never created unencrypted.
 */
export const clearSignInStores = (): void => {
  for (const id of SECURE_STORE_IDS) {
    try {
      new MMKVLoader().withInstanceID(id).withEncryption().initialize().clearStore();
    } catch (e) {
      console.error(`Error clearing encrypted store ${id}:`, e);
    }
  }
};
