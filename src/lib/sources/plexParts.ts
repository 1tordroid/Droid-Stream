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

/** Saves which Plex item each part address plays, in one write for a whole listing. */
export const rememberPlexParts = (server: string, pairs: [partUrl: string | undefined, ratingKey: string | undefined][]): void => {
  let map: Record<string, string> | undefined;
  let changed = false;
  for (const [partUrl, ratingKey] of pairs) {
    const path = plexPartPath(server, partUrl);
    if (!path || !ratingKey) continue;
    map ||= read();
    const key = `${rootOf(server)}${path}`;
    if (map[key] === String(ratingKey)) continue;
    // Newest last, so the oldest pairs are dropped first.
    delete map[key];
    map[key] = String(ratingKey);
    changed = true;
  }
  if (!map || !changed) return;
  const keys = Object.keys(map);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete map[old];
  mainStorage.setObject(KEY, map);
};

/** Saves that this part address plays this Plex item. */
export const rememberPlexPart = (server: string, partUrl: string | undefined, ratingKey: string | undefined): void =>
  rememberPlexParts(server, [[partUrl, ratingKey]]);

/** The Plex item (ratingKey) this part address plays, when the library saw it. */
export const plexItemForPart = (server: string, url?: string): string | undefined => {
  const path = plexPartPath(server, url);
  return path ? read()[`${rootOf(server)}${path}`] : undefined;
};
