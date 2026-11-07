/**
 * Where chapters come from: the viewer's Jellyfin, Emby or Plex server first
 * (they have names and images), then the file itself through FFprobe.
 */
import {findEmbyItem, findJellyfinItem, findPlexItem} from '../playback/skipSources';
import {deviceHeader, LEGACY_DEVICE_ID} from '../sources/mediaServers';
import {listSources} from '../sources/vault';
import {cacheStorage} from '../storage/StorageService';
import {parseMediaBrowserChapters, parsePlexChapters, parseProbeChapters, type Chapter, type ChapterSource} from './chapters';
import {isProbeableSource, playerTools} from './playerTools';

const FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedChapters {
  at: number;
  chapters: Chapter[];
}

const cached = async (key: string, load: () => Promise<Chapter[]>, now = Date.now()): Promise<Chapter[]> => {
  const entry = cacheStorage.getObject<CachedChapters>(`chapters:${key}`);
  if (entry && typeof entry.at === 'number' && Array.isArray(entry.chapters)) {
    const ttl = entry.chapters.length ? FOUND_TTL_MS : EMPTY_TTL_MS;
    if (now - entry.at <= ttl && entry.at <= now) return entry.chapters;
  }
  const chapters = await load();
  cacheStorage.setObject<CachedChapters>(`chapters:${key}`, {at: now, chapters});
  return chapters;
};

const getJson = async (url: string, headers: Record<string, string>): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {signal: controller.signal, headers: {Accept: 'application/json', ...headers}});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

/** Chapters from the media server the stream belongs to, or undefined when it is not a server item. */
export const fetchServerChapters = async (
  urls: (string | undefined)[],
): Promise<{source: ChapterSource; chapters: Chapter[]} | undefined> => {
  const sources = listSources();
  const jellyfin = findJellyfinItem(urls, sources);
  const emby = jellyfin ? undefined : findEmbyItem(urls, sources);
  const item = jellyfin || emby;
  if (item) {
    const kind: ChapterSource = jellyfin ? 'jellyfin' : 'emby';
    const root = item.source.server.replace(/\/+$/, '');
    const headers = deviceHeader(item.source.deviceId || LEGACY_DEVICE_ID, item.source.secret);
    const user = encodeURIComponent(item.source.username);
    const id = encodeURIComponent(item.itemId);
    const chapters = await cached(`${kind}:${item.source.id}:${item.itemId}`, async () => {
      // Jellyfin 10.9 moved item details; the user path works on older Jellyfin and on Emby.
      const legacy = `${root}/Users/${user}/Items/${id}?Fields=Chapters`;
      let data: unknown;
      if (kind === 'jellyfin') {
        try {
          data = await getJson(`${root}/Items/${id}?userId=${user}&Fields=Chapters`, headers);
        } catch {
          data = await getJson(legacy, headers);
        }
      } else {
        data = await getJson(legacy, headers);
      }
      return parseMediaBrowserChapters(data, root, item.itemId);
    });
    return {source: kind, chapters};
  }
  const plex = findPlexItem(urls, sources);
  if (!plex) return undefined;
  const root = plex.source.server.replace(/\/+$/, '');
  const chapters = await cached(`plex:${plex.source.id}:${plex.ratingKey}`, async () =>
    parsePlexChapters(
      await getJson(`${root}/library/metadata/${encodeURIComponent(plex.ratingKey)}?includeChapters=1`, {'X-Plex-Token': plex.source.secret}),
      root,
      plex.source.secret,
    ),
  );
  return {source: 'plex', chapters};
};

// File chapters are kept for this app run only: stream addresses often carry
// short-lived tokens, so they make poor long-term keys.
const fileChapters = new Map<string, Promise<Chapter[]>>();

/** Matroska or MP4 chapters inside the file. [] when the file has none or cannot be read. */
export const readFileChapters = (uri: string, headers: Record<string, string> = {}, type?: string, durationSeconds = 0): Promise<Chapter[]> => {
  if (!playerTools || !isProbeableSource(uri, type)) return Promise.resolve([]);
  const key = uri.split('#')[0];
  let pending = fileChapters.get(key);
  if (!pending) {
    pending = playerTools
      .readChapters(uri, headers)
      .then(items => parseProbeChapters(items, durationSeconds))
      .catch(() => []);
    fileChapters.set(key, pending);
    if (fileChapters.size > 20) fileChapters.delete(fileChapters.keys().next().value as string);
  }
  return pending;
};
