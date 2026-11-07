import {profileKey} from '../profiles/scope';
import {openStore, type MMKVStore} from '../storage/openStore';
import {DEFAULT_SEARCH_ENGINE, DEFAULT_SHORTCUTS, hostOf, type SearchEngineId, type Shortcut} from './url';

/**
 * Browser data in MMKV. Settings are shared by every profile; history,
 * bookmarks, open tabs, shortcuts and site layouts belong to the profile
 * (profileKey). Private tabs are never written here.
 */

export const BROWSER_INSTANCE_ID = 'droid-stream-browser';
/** Keys each profile owns in the browser store (profileData.ts clears them with the profile). */
export const PROFILE_BROWSER_KEYS = ['history', 'bookmarks', 'tabs', 'shortcuts', 'layouts', 'passwordNever'] as const;

let store: MMKVStore | undefined;
const browserStore = (): MMKVStore => (store ||= openStore(BROWSER_INSTANCE_ID));

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = browserStore().getString(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown): void => {
  browserStore().setString(key, JSON.stringify(value));
};

// --- Settings (shared) ---

export type Layout = 'desktop' | 'mobile';

export interface BrowserSettings {
  searchEngine: SearchEngineId;
  /** Layout for the first tab and typed addresses. */
  defaultLayout: Layout;
  /** Ask Desktop or Mobile when a page opens a new tab or pop-up. */
  askLayoutForNewTabs: boolean;
  darkPages: boolean;
  blockAds: boolean;
  /** Sites where blocking is off (host names). */
  allowedSites: string[];
  customRules: string;
  userscripts: boolean;
  showVideoButton: boolean;
  useDevicePasswords: boolean;
  useAppPasswords: boolean;
  passkeys: boolean;
  /** Ask before a page opens a link in another app. */
  confirmExternalApps: boolean;
}

export const DEFAULT_SETTINGS: BrowserSettings = {
  searchEngine: DEFAULT_SEARCH_ENGINE,
  defaultLayout: 'desktop',
  askLayoutForNewTabs: true,
  darkPages: false,
  blockAds: true,
  allowedSites: [],
  customRules: '',
  userscripts: true,
  showVideoButton: true,
  useDevicePasswords: true,
  useAppPasswords: true,
  passkeys: true,
  confirmExternalApps: true,
};

export const readSettings = (): BrowserSettings => ({...DEFAULT_SETTINGS, ...readJson<Partial<BrowserSettings>>('settings', {})});

const settingsListeners = new Set<(settings: BrowserSettings) => void>();

export const updateSettings = (patch: Partial<BrowserSettings>): BrowserSettings => {
  const next = {...readSettings(), ...patch};
  writeJson('settings', next);
  for (const listener of settingsListeners) listener(next);
  return next;
};

export const onSettingsChange = (listener: (settings: BrowserSettings) => void): (() => void) => {
  settingsListeners.add(listener);
  return () => settingsListeners.delete(listener);
};

// --- Per-profile data ---

const own = (key: (typeof PROFILE_BROWSER_KEYS)[number]) => profileKey(`browser.${key}`);

export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

const HISTORY_LIMIT = 1500;

export const readHistory = (): HistoryEntry[] => readJson<HistoryEntry[]>(own('history'), []);

export const addHistory = (url: string, title: string, now = Date.now()): void => {
  if (!/^https?:\/\//i.test(url)) return;
  const list = readHistory();
  if (list[0]?.url === url) {
    list[0] = {url, title: title || list[0].title, visitedAt: now};
  } else {
    list.unshift({url, title: title || url, visitedAt: now});
  }
  writeJson(own('history'), list.slice(0, HISTORY_LIMIT));
};

/** Sets the title of the newest visit to a URL, which often arrives after the visit. */
export const setHistoryTitle = (url: string, title: string): void => {
  const list = readHistory();
  const entry = list.find(item => item.url === url);
  if (!entry || !title || entry.title === title) return;
  entry.title = title;
  writeJson(own('history'), list);
};

export const removeHistory = (url: string): void => writeJson(own('history'), readHistory().filter(item => item.url !== url));

export const clearHistory = (): void => writeJson(own('history'), []);

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  createdAt: number;
}

export const readBookmarks = (): Bookmark[] => readJson<Bookmark[]>(own('bookmarks'), []);

export const isBookmarked = (url: string): boolean => readBookmarks().some(item => item.url === url);

export const toggleBookmark = (url: string, title: string): boolean => {
  const list = readBookmarks();
  if (list.some(item => item.url === url)) {
    writeJson(own('bookmarks'), list.filter(item => item.url !== url));
    return false;
  }
  writeJson(own('bookmarks'), [{id: `${Date.now().toString(36)}`, url, title: title || url, createdAt: Date.now()}, ...list]);
  return true;
};

export const removeBookmark = (id: string): void => writeJson(own('bookmarks'), readBookmarks().filter(item => item.id !== id));

export const readShortcuts = (): Shortcut[] => readJson<Shortcut[]>(own('shortcuts'), DEFAULT_SHORTCUTS);

export const saveShortcuts = (list: Shortcut[]): void => writeJson(own('shortcuts'), list.slice(0, 40));

export interface SavedTab {
  id: string;
  url: string;
  title: string;
  desktop: boolean;
}

export const readSavedTabs = (): {tabs: SavedTab[]; active?: string} =>
  readJson<{tabs: SavedTab[]; active?: string}>(own('tabs'), {tabs: []});

export const saveTabs = (tabs: SavedTab[], active?: string): void => writeJson(own('tabs'), {tabs: tabs.slice(0, 30), active});

// --- Desktop or mobile layout per site ---

/** The site a layout choice is remembered for: the host without "www." or "m.". */
export const layoutSiteOf = (url: string): string => hostOf(url).replace(/^(www|m|mobile)\./, '');

export const readLayouts = (): Record<string, Layout> => readJson<Record<string, Layout>>(own('layouts'), {});

export const rememberLayout = (url: string, layout: Layout): void => {
  const site = layoutSiteOf(url);
  if (!site) return;
  writeJson(own('layouts'), {...readLayouts(), [site]: layout});
};

export const forgetLayout = (site: string): void => {
  const next = {...readLayouts()};
  delete next[site];
  writeJson(own('layouts'), next);
};

/** The remembered layout for a site, or the default. */
export const layoutFor = (url: string, settings: BrowserSettings = readSettings(), remembered = readLayouts()): Layout =>
  remembered[layoutSiteOf(url)] || settings.defaultLayout;

/**
 * Whether opening this URL in a new tab asks Desktop or Mobile first. The
 * sheet starts on layoutFor(url); with asking off, layoutFor is used as is.
 */
export const shouldAskLayout = (url: string, settings: BrowserSettings = readSettings()): boolean =>
  settings.askLayoutForNewTabs && /^https?:\/\//i.test(url);

// --- Private tab clean-up, kept until it has run (also across a crash) ---

export const readPendingPrivateHosts = (): string[] => readJson<string[]>('privateHosts', []);

export const savePendingPrivateHosts = (hosts: string[]): void => writeJson('privateHosts', Array.from(new Set(hosts)).slice(0, 500));

// --- Raw access for the filter list and userscript modules ---

export const browserJson = {read: readJson, write: writeJson};
