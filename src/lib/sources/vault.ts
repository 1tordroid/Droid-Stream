import {MMKVLoader} from 'react-native-mmkv-storage';

export type SourceKind = 'webdav' | 'smb' | 'jellyfin' | 'emby' | 'plex';

export interface SavedSource {
  id: string;
  kind: SourceKind;
  name: string;
  server: string;
  username: string;
  secret: string;
  share?: string;
}

const storage = new MMKVLoader()
  .withInstanceID('droid-stream-sources')
  .withEncryption()
  .initialize();

const KEY = 'sources';

export const listSources = (): SavedSource[] => storage.getArray<SavedSource>(KEY) || [];

export const saveSource = (source: SavedSource): void => {
  const next = listSources().filter(item => item.id !== source.id);
  next.push(source);
  storage.setArray(KEY, next);
};

export const deleteSource = (id: string): void => {
  storage.setArray(KEY, listSources().filter(item => item.id !== id));
};
