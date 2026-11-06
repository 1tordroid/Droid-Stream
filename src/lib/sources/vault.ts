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

export interface StoredPikPakAccount {
  username: string;
  accessToken: string;
  userId?: string;
  /** Present for password sign-ins; lets the app renew the access token. */
  refreshToken?: string;
  /** Epoch ms when the access token stops working. */
  expiresAt?: number;
}

const PIKPAK_KEY = 'pikpak-account';
const PIKPAK_USER_KEY = 'pikpak-last-username';
const PIKPAK_DEVICE_KEY = 'pikpak-device-id';

/** One PikPak login per install. The token stays in the encrypted source store. */
export const readPikPakAccount = (): StoredPikPakAccount | undefined => {
  const raw = storage.getString(PIKPAK_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as StoredPikPakAccount;
    return parsed.accessToken ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const savePikPakAccount = (account: StoredPikPakAccount): void => {
  storage.setString(PIKPAK_KEY, JSON.stringify(account));
  storage.setString(PIKPAK_USER_KEY, account.username);
};

/** Writes renewed tokens in one step, keeping the rest of the account. */
export const updatePikPakTokens = (
  patch: Pick<StoredPikPakAccount, 'accessToken'> & Partial<Pick<StoredPikPakAccount, 'refreshToken' | 'expiresAt'>>,
): void => {
  const account = readPikPakAccount();
  if (account) savePikPakAccount({...account, ...patch});
};

export const clearPikPakAccount = (): void => {
  storage.removeItem(PIKPAK_KEY);
};

/** The last username, kept after a sign-in ends so the form can be prefilled. */
export const readPikPakUsername = (): string => storage.getString(PIKPAK_USER_KEY) || '';

export const readPikPakDeviceId = (): string | undefined => storage.getString(PIKPAK_DEVICE_KEY) || undefined;

export const savePikPakDeviceId = (id: string): void => {
  storage.setString(PIKPAK_DEVICE_KEY, id);
};
