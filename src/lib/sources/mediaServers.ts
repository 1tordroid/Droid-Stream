import {Buffer} from 'buffer';
import {isSourceAuthStatus, SOURCE_SERVICE_NAMES as NAMES, SourceAuthError} from './authErrors';

export interface LibraryItem {
  id: string;
  title: string;
  kind: 'folder' | 'video';
  playUrl?: string;
}

/** The DeviceId every install sent before 5.5.0. Only sources saved back then still use it. */
export const LEGACY_DEVICE_ID = 'droid-stream';

type MediaBrowserKind = 'jellyfin' | 'emby';

/**
 * Jellyfin and Emby keep one token per DeviceId and user, and end the older
 * one when the same DeviceId signs in again. Each install and source therefore
 * sends its own DeviceId.
 */
export const deviceHeader = (deviceId: string, token?: string) => ({
  'Content-Type': 'application/json',
  Authorization: `MediaBrowser Client="DroidStream", Device="Droid Stream", DeviceId="${deviceId}", Version="1.0"${token ? `, Token="${token}"` : ''}`,
});

const signInMediaBrowser = async (kind: MediaBrowserKind, server: string, username: string, password: string, deviceId: string) => {
  const response = await fetch(`${server.replace(/\/+$/, '')}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: deviceHeader(deviceId),
    body: JSON.stringify({Username: username, Pw: password}),
  });
  if (isSourceAuthStatus(response.status)) {
    throw new Error(`${NAMES[kind]} did not accept this username or password.`);
  }
  if (!response.ok) throw new Error(`${NAMES[kind]} sign-in failed (${response.status})`);
  const data = await response.json();
  const userId = data?.User?.Id as string | undefined;
  const token = data?.AccessToken as string | undefined;
  if (!userId || !token) throw new Error(`${NAMES[kind]} did not return a sign-in`);
  return {userId, token};
};

/**
 * Current Jellyfin always accepts the token as the ApiKey query; api_key only
 * works while the server allows legacy authorization. ApiKey support on
 * Jellyfin 10.8 and older is unverified.
 * Emby documents api_key, so Emby keeps it.
 */
const streamUrl = (kind: MediaBrowserKind, root: string, itemId: string, token: string) =>
  `${root}/Videos/${itemId}/stream?static=true&${kind === 'emby' ? 'api_key' : 'ApiKey'}=${encodeURIComponent(token)}`;

const listMediaBrowser = async (
  kind: MediaBrowserKind,
  server: string,
  userId: string,
  token: string,
  parentId: string | undefined,
  deviceId: string,
): Promise<LibraryItem[]> => {
  const root = server.replace(/\/+$/, '');
  const query = new URLSearchParams({Recursive: 'false'});
  if (parentId) query.set('ParentId', parentId);
  const response = await fetch(`${root}/Users/${userId}/Items?${query}`, {
    headers: deviceHeader(deviceId, token),
  });
  if (isSourceAuthStatus(response.status)) throw new SourceAuthError(kind, response.status);
  if (!response.ok) throw new Error(`${NAMES[kind]} library failed (${response.status})`);
  const data = await response.json();
  return (data.Items || []).map((item: {Id: string; Name: string; Type?: string; MediaType?: string}) => {
    const video = item.Type === 'Movie' || item.Type === 'Episode' || item.MediaType === 'Video';
    return {
      id: item.Id,
      title: item.Name,
      kind: video ? 'video' : 'folder',
      playUrl: video ? streamUrl(kind, root, item.Id, token) : undefined,
    } as LibraryItem;
  });
};

export const signInJellyfin = (server: string, username: string, password: string, deviceId: string) =>
  signInMediaBrowser('jellyfin', server, username, password, deviceId);

/** Sources saved before 5.5.0 have no deviceId; their token belongs to the old shared id. */
export const listJellyfin = (server: string, userId: string, token: string, parentId?: string, deviceId = LEGACY_DEVICE_ID) =>
  listMediaBrowser('jellyfin', server, userId, token, parentId, deviceId);

export const signInEmby = (server: string, username: string, password: string, deviceId: string) =>
  signInMediaBrowser('emby', server, username, password, deviceId);

export const listEmby = (server: string, userId: string, token: string, parentId?: string, deviceId = LEGACY_DEVICE_ID) =>
  listMediaBrowser('emby', server, userId, token, parentId, deviceId);

/**
 * Password sign-in through plex.tv. clientId identifies this install; sources
 * saved before 5.5.0 used 'droid-stream'. Two-step verification accounts may
 * need a pasted token instead.
 */
export const signInPlex = async (username: string, password: string, clientId: string) => {
  const response = await fetch('https://plex.tv/users/sign_in.json', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'X-Plex-Client-Identifier': clientId,
      'X-Plex-Product': 'Droid Stream',
      'X-Plex-Version': '1.0',
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    },
  });
  if (isSourceAuthStatus(response.status)) {
    throw new Error('Plex did not accept this username or password. With two-step verification, paste a Plex token instead.');
  }
  if (!response.ok) throw new Error(`Plex sign-in failed (${response.status})`);
  const data = await response.json();
  const token = data?.user?.authToken;
  if (!token) throw new Error('Plex did not return a token');
  return token as string;
};

const withPlexToken = (url: string, token: string) =>
  `${url}${url.includes('?') ? '&' : '?'}X-Plex-Token=${encodeURIComponent(token)}`;

interface PlexItem {
  key?: string;
  ratingKey?: string;
  title: string;
  type?: string;
  Media?: Array<{Part?: Array<{key?: string}>}>;
}

export const listPlex = async (server: string, token: string, path = '/library/sections'): Promise<LibraryItem[]> => {
  const root = server.replace(/\/+$/, '');
  const response = await fetch(withPlexToken(`${root}${path}`, token), {
    headers: {Accept: 'application/json'},
  });
  if (isSourceAuthStatus(response.status)) throw new SourceAuthError('plex', response.status);
  if (!response.ok) throw new Error(`Plex library failed (${response.status})`);
  const data = await response.json();
  const container = data?.MediaContainer || {};
  // Keys are either absolute ('/library/metadata/5/children') or relative to the
  // folder listed here ('1' under /library/sections, 'all' under a section).
  const folder = path.split('?')[0].replace(/\/+$/, '');
  const pathOf = (key: string) => (key.startsWith('/') ? key : `${folder}/${key}`);
  // Directory entries are libraries and their views, even when typed 'movie'.
  const folders: LibraryItem[] = (container.Directory || []).map((item: PlexItem) => ({
    id: pathOf(String(item.key || item.ratingKey || item.title)),
    title: item.title,
    kind: 'folder',
  }));
  const entries: LibraryItem[] = (container.Metadata || []).map((item: PlexItem) => {
    const video = item.type === 'movie' || item.type === 'episode';
    // The media part is the playable file. The server needs the token on it too.
    const part = item.Media?.[0]?.Part?.[0]?.key;
    return {
      id: video ? String(item.ratingKey) : pathOf(String(item.key || item.ratingKey || item.title)),
      title: item.title,
      kind: video ? 'video' : 'folder',
      playUrl: video ? withPlexToken(part ? `${root}${part}` : `${root}/library/metadata/${item.ratingKey}`, token) : undefined,
    };
  });
  return [...folders, ...entries];
};
