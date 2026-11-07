import {MMKVLoader} from 'react-native-mmkv-storage';

export type SourceKind = 'webdav' | 'smb' | 'jellyfin' | 'emby' | 'plex';

export type SourceAuthState = 'ok' | 'signedOut';

export interface SavedSource {
  id: string;
  kind: SourceKind;
  name: string;
  server: string;
  /** Jellyfin and Emby: the server's user id. Others: the name typed to sign in. */
  username: string;
  /** The password, or the access token for Jellyfin, Emby and Plex. */
  secret: string;
  share?: string;
  /**
   * Jellyfin and Emby: the DeviceId the token was issued for. Plex: the
   * X-Plex-Client-Identifier of the sign-in. Missing on sources saved before
   * 5.5.0, which all used 'droid-stream'.
   */
  deviceId?: string;
  /** Jellyfin and Emby: the name typed to sign in, so signing in again can be prefilled. */
  loginName?: string;
  /** 'signedOut' once the server rejected the saved sign-in. */
  authState?: SourceAuthState;
}

const storage = new MMKVLoader()
  .withInstanceID('droid-stream-sources')
  .withEncryption().recoverOnKeyLoss()
  .initialize();

const KEY = 'sources';
const INSTALL_ID_KEY = 'install-id';

export const listSources = (): SavedSource[] => storage.getArray<SavedSource>(KEY) || [];

/** Adds a source, or replaces the saved one with the same id where it already is in the list. */
export const saveSource = (source: SavedSource): void => {
  const list = listSources();
  const next = list.some(item => item.id === source.id)
    ? list.map(item => (item.id === source.id ? source : item))
    : [...list, source];
  storage.setArray(KEY, next);
};

/** Changes a saved source in place. The id and list position stay the same, so links to it keep working. */
export const updateSource = (id: string, patch: Partial<Omit<SavedSource, 'id'>>): SavedSource | undefined => {
  let updated: SavedSource | undefined;
  const next = listSources().map(item => {
    if (item.id !== id) return item;
    updated = {...item, ...patch, id};
    return updated;
  });
  if (updated) storage.setArray(KEY, next);
  return updated;
};

/**
 * A random id made once per install and kept in this encrypted store, so it
 * is not part of JSON backups. Media servers use it to tell this install's
 * sign-ins apart from other phones and from the preview build.
 */
export const getInstallId = (): string => {
  let id = storage.getString(INSTALL_ID_KEY);
  if (!id) {
    // Loaded on first use so modules that only read sources do not need the native module.
    const {randomUUID} = require('expo-crypto') as typeof import('expo-crypto');
    id = randomUUID();
    storage.setString(INSTALL_ID_KEY, id);
  }
  return id;
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

export interface StoredTordroidPlusAccount {
  /** The portal address, e.g. https://plus.tordroid.com. */
  server: string;
  email: string;
  /** Kept so an ended sign-in can be renewed without asking. */
  password: string;
  /** The portal's sign-in token (a JWT). */
  token: string;
  /** Epoch ms when the token stops working, read from the token. */
  expiresAt?: number;
  /** Set once the portal refused the saved password; the user signs in again. */
  signedOut?: boolean;
}

const TORDROID_PLUS_KEY = 'tordroid-plus-account';

/** One Tordroid Plus sign-in per install, in the encrypted source store. */
export const readTordroidPlusAccount = (): StoredTordroidPlusAccount | undefined => {
  const raw = storage.getString(TORDROID_PLUS_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as StoredTordroidPlusAccount;
    return parsed.server && parsed.email ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const saveTordroidPlusAccount = (account: StoredTordroidPlusAccount): void => {
  storage.setString(TORDROID_PLUS_KEY, JSON.stringify(account));
};

export const clearTordroidPlusAccount = (): void => {
  storage.removeItem(TORDROID_PLUS_KEY);
};
