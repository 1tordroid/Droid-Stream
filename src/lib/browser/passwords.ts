import {MMKVLoader} from 'react-native-mmkv-storage';
import {profileKey} from '../profiles/scope';
import type {MMKVStore} from '../storage/openStore';
import {browserJson} from './store';

/**
 * Saved sign-ins for the browser, per profile, in an encrypted MMKV store
 * (Keystore-backed, kept out of backups: SECURE_STORE_IDS and
 * plugins/with-backup-rules.js). The pure helpers below decide matching and
 * saving, and are shared with the page script through browser messages.
 */

export const PASSWORDS_INSTANCE_ID = 'droid-stream-passwords';

export interface SavedLogin {
  id: string;
  /** scheme://host[:port] of the sign-in page. */
  origin: string;
  username: string;
  password: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

let secure: MMKVStore | undefined;
const secureStore = (): MMKVStore =>
  (secure ||= new MMKVLoader().withInstanceID('droid-stream-passwords').withEncryption().recoverOnKeyLoss().initialize() as MMKVStore);

const LOGINS_KEY = 'logins';

/** scheme://host[:port], lower case, or '' for anything that is not http(s). */
export const loginOrigin = (url: string): string => {
  const match = /^(https?):\/\/(?:[^@/?#]*@)?([^/?#:]+)(:\d+)?/i.exec(url.trim());
  if (!match) return '';
  const port = match[3] && !((match[1].toLowerCase() === 'https' && match[3] === ':443') || (match[1].toLowerCase() === 'http' && match[3] === ':80')) ? match[3] : '';
  return `${match[1].toLowerCase()}://${match[2].toLowerCase()}${port}`;
};

const bareHost = (origin: string): string => origin.replace(/^https?:\/\//, '').replace(/^www\./, '');

/** Sign-ins for a page: the same origin, treating "www." and the bare host as one site. Never http for an https sign-in. */
export const loginsForUrl = (list: SavedLogin[], url: string): SavedLogin[] => {
  const origin = loginOrigin(url);
  if (!origin) return [];
  const https = origin.startsWith('https:');
  return list
    .filter(item => bareHost(item.origin) === bareHost(origin) && (https || item.origin.startsWith('http:')))
    .sort((left, right) => (right.lastUsedAt || right.updatedAt) - (left.lastUsedAt || left.updatedAt));
};

export type SaveDecision = 'new' | 'update' | 'same';

/** What a submitted sign-in means for the saved ones. */
export const decideSave = (list: SavedLogin[], url: string, username: string, password: string): SaveDecision => {
  const existing = loginsForUrl(list, url).find(item => item.username === username);
  if (!existing) return 'new';
  return existing.password === password ? 'same' : 'update';
};

export const upsertLogin = (list: SavedLogin[], url: string, username: string, password: string, now = Date.now()): SavedLogin[] => {
  const origin = loginOrigin(url);
  const index = list.findIndex(item => bareHost(item.origin) === bareHost(origin) && item.username === username);
  if (index >= 0) {
    const next = list.slice();
    next[index] = {...next[index], password, updatedAt: now};
    return next;
  }
  return [{id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, origin, username, password, createdAt: now, updatedAt: now}, ...list];
};

const csvField = (value: string): string => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** The CSV layout Chrome and most password managers import: name,url,username,password. */
export const loginsToCsv = (list: SavedLogin[]): string =>
  ['name,url,username,password', ...list.map(item => [bareHost(item.origin), item.origin, item.username, item.password].map(csvField).join(','))].join('\n');

// --- Store ---

export const readLogins = (): SavedLogin[] => {
  try {
    const raw = secureStore().getString(profileKey(LOGINS_KEY));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeLogins = (list: SavedLogin[]): void => {
  secureStore().setString(profileKey(LOGINS_KEY), JSON.stringify(list));
};

export const saveLogin = (url: string, username: string, password: string): void => writeLogins(upsertLogin(readLogins(), url, username, password));

export const updateLogin = (id: string, patch: Partial<Pick<SavedLogin, 'username' | 'password' | 'origin'>>): void =>
  writeLogins(readLogins().map(item => (item.id === id ? {...item, ...patch, updatedAt: Date.now()} : item)));

export const deleteLogin = (id: string): void => writeLogins(readLogins().filter(item => item.id !== id));

export const markLoginUsed = (id: string): void =>
  writeLogins(readLogins().map(item => (item.id === id ? {...item, lastUsedAt: Date.now()} : item)));

/** Removes a profile's sign-ins (profile deleted). */
export const deleteProfileLogins = (profileId: string): void => {
  try {
    secureStore().removeItem(profileKey(LOGINS_KEY, profileId));
  } catch {
    // Nothing saved.
  }
};

// Sites the user said never to save for, per profile (not secret, so the plain store).
const neverKey = () => profileKey('browser.passwordNever');

export const readNeverSites = (): string[] => browserJson.read<string[]>(neverKey(), []);

export const isNeverSite = (url: string): boolean => readNeverSites().includes(bareHost(loginOrigin(url)));

export const addNeverSite = (url: string): void => {
  const host = bareHost(loginOrigin(url));
  if (host) browserJson.write(neverKey(), Array.from(new Set([...readNeverSites(), host])));
};

export const removeNeverSite = (host: string): void => browserJson.write(neverKey(), readNeverSites().filter(item => item !== host));
