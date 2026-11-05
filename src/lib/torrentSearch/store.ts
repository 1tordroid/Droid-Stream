import {MMKVLoader} from 'react-native-mmkv-storage';
import type {TorznabInstance} from './engines/torznab';
import type {SiteAdapter} from './engines/custom';
import type {ResultFilters, SortKey, TorrentCategory, TorrentResult} from './types';
import {defaultFilters} from './types';

const storage = new MMKVLoader().withInstanceID('droid-stream-torrent-search').initialize();

export interface EngineConfig {
  enabled: boolean;
  /** Index into the engine's mirrors, or a custom URL. */
  mirror?: string;
}

export interface TorrentSearchSettings {
  engines: Record<string, EngineConfig>;
  torznab: TorznabInstance[];
  /** Custom and catalog site adapters the user added. */
  adapters: SiteAdapter[];
  sort: SortKey;
  category: TorrentCategory;
  filters: ResultFilters;
  timeoutSeconds: number;
  saveHistory: boolean;
  /** Ask where to send a result (stream, download, PikPak) or use the default. */
  defaultAction: 'ask' | 'stream' | 'download' | 'pikpak';
  acknowledged: boolean;
}

export const defaultSearchSettings = (): TorrentSearchSettings => ({
  engines: {},
  torznab: [],
  adapters: [],
  sort: 'relevance',
  category: 'all',
  filters: defaultFilters(),
  timeoutSeconds: 15,
  saveHistory: true,
  defaultAction: 'ask',
  acknowledged: false,
});

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = storage.getString(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown): void => {
  storage.setString(key, JSON.stringify(value));
};

export const readSearchSettings = (): TorrentSearchSettings => {
  const saved = read<Partial<TorrentSearchSettings>>('settings', {});
  const base = defaultSearchSettings();
  return {...base, ...saved, filters: {...base.filters, ...(saved.filters || {})}};
};

export const writeSearchSettings = (settings: TorrentSearchSettings): void => write('settings', settings);

export const updateSearchSettings = (patch: Partial<TorrentSearchSettings>): TorrentSearchSettings => {
  const next = {...readSearchSettings(), ...patch};
  writeSearchSettings(next);
  return next;
};

// ---------------------------------------------------------------- history
const HISTORY_LIMIT = 40;

export const readHistory = (): string[] => read<string[]>('history', []);

export const pushHistory = (query: string): string[] => {
  const value = query.trim();
  if (!value || !readSearchSettings().saveHistory) return readHistory();
  const next = [value, ...readHistory().filter(item => item.toLowerCase() !== value.toLowerCase())].slice(0, HISTORY_LIMIT);
  write('history', next);
  return next;
};

export const removeHistory = (query: string): string[] => {
  const next = readHistory().filter(item => item !== query);
  write('history', next);
  return next;
};

export const clearHistory = (): void => write('history', []);

// ---------------------------------------------------------------- bookmarks
export interface Bookmark extends TorrentResult {
  savedAt: number;
}

export const readBookmarks = (): Bookmark[] => read<Bookmark[]>('bookmarks', []);

export const isBookmarked = (id: string): boolean => readBookmarks().some(item => item.id === id);

export const toggleBookmark = (result: TorrentResult): boolean => {
  const current = readBookmarks();
  if (current.some(item => item.id === result.id)) {
    write('bookmarks', current.filter(item => item.id !== result.id));
    return false;
  }
  write('bookmarks', [{...result, savedAt: Date.now()}, ...current].slice(0, 500));
  return true;
};

export const removeBookmark = (id: string): void => write('bookmarks', readBookmarks().filter(item => item.id !== id));
