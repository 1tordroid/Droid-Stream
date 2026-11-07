/**
 * Which Plex item a media part address belongs to. A Plex play address names
 * the file (/library/parts/{id}/...), not the item, but skip markers are read
 * from the item. The library remembers the pair when it hands out a part, so
 * the player can find the item again later, also from Continue watching.
 */
import {mainStorage} from '../storage/StorageService';

const KEY = 'plex-part-items';
/** Enough for a few large libraries; the oldest pairs are dropped first. */
const MAX_ENTRIES = 2000;

const rootOf = (server: string) => server.replace(/\/+$/, '').toLowerCase();

/** The part path of a Plex play address under this server, without the token. */
export const plexPartPath = (server: string, url?: string): string | undefined => {
  if (!url) return undefined;
  const root = rootOf(server);
  if (!url.toLowerCase().startsWith(`${root}/`)) return undefined;
  const path = url.slice(root.length).split(/[?#]/)[0];
  return /^\/library\/parts\/\d+\//.test(path) ? path : undefined;
};

const read = (): Record<string, string> => {
  const saved = mainStorage.getObject<Record<string, string>>(KEY);
  return saved && typeof saved === 'object' ? saved : {};
};

/** Saves that this part address plays this Plex item. */
export const rememberPlexPart = (server: string, partUrl: string | undefined, ratingKey: string | undefined): void => {
  const path = plexPartPath(server, partUrl);
  if (!path || !ratingKey) return;
  const key = `${rootOf(server)}${path}`;
  const map = read();
  if (map[key] === ratingKey) return;
  delete map[key];
  map[key] = String(ratingKey);
  const keys = Object.keys(map);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete map[old];
  mainStorage.setObject(KEY, map);
};

/** The Plex item (ratingKey) this part address plays, when the library saw it. */
export const plexItemForPart = (server: string, url?: string): string | undefined => {
  const path = plexPartPath(server, url);
  return path ? read()[`${rootOf(server)}${path}`] : undefined;
};
