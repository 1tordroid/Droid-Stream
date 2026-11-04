import {Buffer} from 'buffer';

export interface LibraryItem {
  id: string;
  title: string;
  kind: 'folder' | 'video';
  playUrl?: string;
}

const deviceHeader = (headerName: string, token?: string) => ({
  'Content-Type': 'application/json',
  [headerName]: `MediaBrowser Client="DroidStream", Device="Phone", DeviceId="droid-stream", Version="1.0"${token ? `, Token="${token}"` : ''}`,
});

export const signInJellyfin = async (server: string, username: string, password: string) => {
  const response = await fetch(`${server.replace(/\/+$/, '')}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: deviceHeader('Authorization'),
    body: JSON.stringify({Username: username, Pw: password}),
  });
  if (!response.ok) throw new Error(`Jellyfin sign-in failed (${response.status})`);
  const data = await response.json();
  return {userId: data.User?.Id as string, token: data.AccessToken as string};
};

export const listJellyfin = async (
  server: string,
  userId: string,
  token: string,
  parentId?: string,
): Promise<LibraryItem[]> => {
  const root = server.replace(/\/+$/, '');
  const query = new URLSearchParams({Recursive: 'false'});
  if (parentId) query.set('ParentId', parentId);
  const response = await fetch(`${root}/Users/${userId}/Items?${query}`, {
    headers: deviceHeader('Authorization', token),
  });
  if (!response.ok) throw new Error(`Jellyfin library failed (${response.status})`);
  const data = await response.json();
  return (data.Items || []).map((item: {Id: string; Name: string; Type?: string; MediaType?: string}) => {
    const video = item.Type === 'Movie' || item.Type === 'Episode' || item.MediaType === 'Video';
    return {
      id: item.Id,
      title: item.Name,
      kind: video ? 'video' : 'folder',
      playUrl: video ? `${root}/Videos/${item.Id}/stream?static=true&api_key=${encodeURIComponent(token)}` : undefined,
    } as LibraryItem;
  });
};

export const signInEmby = signInJellyfin;

export const listEmby = async (server: string, userId: string, token: string, parentId?: string) =>
  listJellyfin(server, userId, token, parentId);

export const signInPlex = async (username: string, password: string) => {
  const response = await fetch('https://plex.tv/users/sign_in.json', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'X-Plex-Client-Identifier': 'droid-stream',
      'X-Plex-Product': 'Droid Stream',
      'X-Plex-Version': '1.0',
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    },
  });
  if (!response.ok) throw new Error(`Plex sign-in failed (${response.status})`);
  const data = await response.json();
  const token = data?.user?.authToken;
  if (!token) throw new Error('Plex did not return a token');
  return token as string;
};

export const listPlex = async (server: string, token: string, path = '/library/sections'): Promise<LibraryItem[]> => {
  const root = server.replace(/\/+$/, '');
  const response = await fetch(`${root}${path}${path.includes('?') ? '&' : '?'}X-Plex-Token=${encodeURIComponent(token)}`, {
    headers: {Accept: 'application/json'},
  });
  if (!response.ok) throw new Error(`Plex library failed (${response.status})`);
  const data = await response.json();
  const directories = data?.MediaContainer?.Directory || data?.MediaContainer?.Metadata || [];
  return directories.map((item: {key?: string; ratingKey?: string; title: string; type?: string}) => {
    const video = item.type === 'movie' || item.type === 'episode';
    return {
      id: video ? String(item.ratingKey) : String(item.key || item.ratingKey || item.title),
      title: item.title,
      kind: video ? 'video' : 'folder',
      playUrl: video ? `${root}/library/metadata/${item.ratingKey}` : undefined,
    } as LibraryItem;
  });
};
