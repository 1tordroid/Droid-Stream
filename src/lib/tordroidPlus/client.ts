/**
 * Talks to a Tordroid Plus portal: the family's shared PikPak account behind
 * plus.tordroid.com (or another address the user enters). The user signs in
 * with their own portal email and password; the token and password stay in the
 * encrypted source store. Original TypeScript written against the portal's
 * HTTP API; no portal code is included.
 */
import {Buffer} from 'buffer';
import {parsePikPakQuota, parseShareLink, type PikPakQuota, type ShareLink} from '../pikpak/parse';
import {
  clearTordroidPlusAccount,
  readTordroidPlusAccount,
  saveTordroidPlusAccount,
  type StoredTordroidPlusAccount,
} from '../sources/vault';

export const TORDROID_PLUS_DEFAULT_SERVER = 'https://plus.tordroid.com';

/** The portal refused the saved sign-in; the user has to sign in again. */
export class TordroidPlusAuthError extends Error {
  constructor(message = 'Your Tordroid Plus sign-in has ended. Sign in again.') {
    super(message);
    this.name = 'TordroidPlusAuthError';
  }
}

/** The portal answered with an error status. */
export class TordroidPlusError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'TordroidPlusError';
  }
}

/** "plus.tordroid.com/" → "https://plus.tordroid.com". */
export const normalizeServer = (value: string): string => {
  const trimmed = (value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return TORDROID_PLUS_DEFAULT_SERVER;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

/** The web app sends API calls to /api, which the portal passes to its server. */
export const apiBase = (server: string): string => {
  const base = normalizeServer(server);
  return /\/api$/i.test(base) ? base : `${base}/api`;
};

/** The expiry time in a JWT, in epoch ms, or undefined when it cannot be read. */
export const tokenExpiry = (token: string): number | undefined => {
  const part = token.split('.')[1];
  if (!part) return undefined;
  try {
    const json = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof json.exp === 'number' ? json.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
};

const TIMEOUT_MS = 25000;

const send = async (url: string, init: RequestInit = {}): Promise<{status: number; ok: boolean; data: any}> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {...init, signal: controller.signal, headers: {Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers as any)}});
    const text = await response.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    return {status: response.status, ok: response.ok, data};
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Tordroid Plus did not answer in time');
    throw new Error('Could not reach Tordroid Plus. Check the address and your connection.');
  } finally {
    clearTimeout(timer);
  }
};

const messageOf = (data: any, status: number): string =>
  (typeof data?.message === 'string' && data.message) || (typeof data?.error === 'string' && data.error) || `Tordroid Plus error (${status})`;

/** Signs in and saves the account. Throws the portal's message on a wrong password or a blocked account. */
export const signInToTordroidPlus = async (server: string, email: string, password: string): Promise<StoredTordroidPlusAccount> => {
  const address = normalizeServer(server);
  const {ok, status, data} = await send(`${apiBase(address)}/login`, {method: 'POST', body: JSON.stringify({email: email.trim(), password})});
  if (!ok || typeof data?.token !== 'string') throw new TordroidPlusError(messageOf(data, status), status);
  const account: StoredTordroidPlusAccount = {
    server: address,
    email: data.user?.email || email.trim(),
    password,
    token: data.token,
    ...(tokenExpiry(data.token) ? {expiresAt: tokenExpiry(data.token)} : {}),
  };
  saveTordroidPlusAccount(account);
  return account;
};

export const isTordroidPlusSignedIn = (): boolean => {
  const account = readTordroidPlusAccount();
  return Boolean(account?.token && !account.signedOut);
};

/** Signs out on this device. The portal's tokens are stateless, so this only forgets it here. */
export const signOutOfTordroidPlus = (): void => {
  const account = readTordroidPlusAccount();
  if (account) send(`${apiBase(account.server)}/logout`, {method: 'POST', headers: {Authorization: `Bearer ${account.token}`}}).catch(() => undefined);
  clearTordroidPlusAccount();
};

let renewing: Promise<StoredTordroidPlusAccount> | undefined;

/** Signs in again with the saved password. A refused password ends the sign-in on this device. */
const renew = (account: StoredTordroidPlusAccount): Promise<StoredTordroidPlusAccount> => {
  if (!renewing) {
    renewing = signInToTordroidPlus(account.server, account.email, account.password)
      .catch(error => {
        if (error instanceof TordroidPlusError && (error.status === 401 || error.status === 403)) {
          saveTordroidPlusAccount({...account, token: '', password: '', signedOut: true});
          throw new TordroidPlusAuthError(error.status === 403 ? error.message : undefined);
        }
        throw error;
      })
      .finally(() => {
        renewing = undefined;
      });
  }
  return renewing;
};

const RENEW_MARGIN_MS = 60 * 1000;

/**
 * Calls the portal with the saved token. A token about to end is renewed
 * first; a 401 renews it and tries once more.
 */
export const tordroidPlusRequest = async <T = any>(path: string, init: RequestInit = {}): Promise<T> => {
  let account = readTordroidPlusAccount();
  if (!account || account.signedOut || !account.token) throw new TordroidPlusAuthError('Sign in to Tordroid Plus first.');
  if (account.expiresAt && account.expiresAt - Date.now() < RENEW_MARGIN_MS) account = await renew(account);
  const run = (token: string) => send(`${apiBase(account!.server)}${path}`, {...init, headers: {...(init.headers as any), Authorization: `Bearer ${token}`}});
  let answer = await run(account.token);
  if (answer.status === 401) {
    account = await renew(account);
    answer = await run(account.token);
    if (answer.status === 401) throw new TordroidPlusAuthError();
  }
  if (!answer.ok) throw new TordroidPlusError(messageOf(answer.data, answer.status), answer.status);
  return answer.data as T;
};

export type TordroidPlusTaskState = 'done' | 'running' | 'waiting' | 'failed';

export interface TordroidPlusTask {
  id: number;
  createdAt: number;
  name: string;
  url: string;
  /** The PikPak file or folder, once PikPak made one. */
  fileId?: string;
  phase: string;
  /** 0..100 */
  progress: number;
  state: TordroidPlusTaskState;
  message?: string;
  size?: number;
  screenshots: string[];
}

const stateOf = (phase: string): TordroidPlusTaskState =>
  phase === 'PHASE_TYPE_COMPLETE' ? 'done' : phase === 'PHASE_TYPE_ERROR' ? 'failed' : phase === 'PHASE_TYPE_RUNNING' ? 'running' : 'waiting';

/** One row of /tasks: the saved add, with PikPak's task inside (data.task.task) and the magnet's lookup (data.whatslink). */
export const parseTordroidPlusTask = (record: any): TordroidPlusTask | undefined => {
  if (!record || record.id === undefined) return undefined;
  const data = record.data || {};
  const wrapper = data.task || {};
  const task = wrapper.task || {};
  const lookup = data.whatslink || {};
  const phase = String(task.phase || '');
  const fileId = task.file_id || wrapper.file?.id;
  const size = Number(lookup.size) || Number(task.file_size) || undefined;
  const created = Date.parse(record.created_at || task.created_time || '');
  return {
    id: Number(record.id),
    createdAt: Number.isFinite(created) ? created : 0,
    name: String(lookup.name || task.name || task.file_name || wrapper.file?.name || data.meta?.title || 'Download'),
    url: String(data.url || ''),
    ...(fileId ? {fileId: String(fileId)} : {}),
    phase,
    progress: phase === 'PHASE_TYPE_COMPLETE' ? 100 : Math.max(0, Math.min(100, Number(task.progress) || 0)),
    state: stateOf(phase),
    ...(task.message ? {message: String(task.message)} : {}),
    ...(size ? {size} : {}),
    screenshots: Array.isArray(lookup.screenshots) ? lookup.screenshots.filter((url: unknown) => typeof url === 'string') : [],
  };
};

export interface TordroidPlusTaskPage {
  tasks: TordroidPlusTask[];
  count: number;
  page: number;
  limit: number;
}

/** The signed-in person's downloads, newest first. */
export const listTordroidPlusTasks = async (page = 1, limit = 50): Promise<TordroidPlusTaskPage> => {
  const data = await tordroidPlusRequest(`/tasks?page=${page}&limit=${limit}`);
  const tasks = (Array.isArray(data?.data) ? data.data : []).map(parseTordroidPlusTask).filter((task: TordroidPlusTask | undefined): task is TordroidPlusTask => Boolean(task));
  return {tasks, count: Number(data?.count) || tasks.length, page: Number(data?.page) || page, limit: Number(data?.limit) || limit};
};

/** Every page of downloads, up to `max`. */
export const listAllTordroidPlusTasks = async (max = 500): Promise<TordroidPlusTask[]> => {
  const out: TordroidPlusTask[] = [];
  for (let page = 1; out.length < max; page++) {
    const result = await listTordroidPlusTasks(page, 100);
    out.push(...result.tasks);
    if (!result.tasks.length || out.length >= result.count) break;
  }
  return out.slice(0, max);
};

export interface TordroidPlusStream {
  label: string;
  url: string;
  height?: number;
  original: boolean;
  type: 'm3u8' | 'mp4';
}

export interface TordroidPlusVideo {
  id: string;
  name: string;
  /** Folders inside the download, ending in "/". */
  path: string;
  size: number;
  thumbnail?: string;
}

export type TordroidPlusMedia =
  | {type: 'folder'; id: string; name: string; videos: TordroidPlusVideo[]}
  | {type: 'file'; id: string; name: string; size: number; isVideo: boolean; thumbnail?: string; mimeType?: string; streams: TordroidPlusStream[]};

const toVideo = (item: any): TordroidPlusVideo => ({
  id: String(item.id),
  name: String(item.name || 'Video'),
  path: String(item.path || ''),
  size: Number(item.size) || 0,
  ...(item.thumbnail ? {thumbnail: String(item.thumbnail)} : {}),
});

/** Reads /media/<id>: a folder's videos, or one file's streams (transcodes first, then the original). */
export const parseTordroidPlusMedia = (data: any): TordroidPlusMedia => {
  if (data?.type === 'folder') {
    return {type: 'folder', id: String(data.id || ''), name: String(data.name || 'Folder'), videos: (data.videos || []).filter((item: any) => item?.id).map(toVideo)};
  }
  const streams: TordroidPlusStream[] = (Array.isArray(data?.streams) ? data.streams : [])
    .filter((item: any) => typeof item?.url === 'string' && item.url)
    .map((item: any) => {
      const height = Number(item.height) || undefined;
      const original = Boolean(item.is_origin);
      return {
        label: original ? 'Original' : String(item.label || (height ? `${height}p` : 'Stream')),
        url: item.url,
        ...(height ? {height} : {}),
        original,
        type: original && !/\.m3u8(\?|$)/i.test(item.url) ? 'mp4' : 'm3u8',
      } as TordroidPlusStream;
    });
  return {
    type: 'file',
    id: String(data?.id || ''),
    name: String(data?.name || 'File'),
    size: Number(data?.size) || 0,
    isVideo: Boolean(data?.is_video),
    ...(data?.thumbnail ? {thumbnail: String(data.thumbnail)} : {}),
    ...(data?.mime_type ? {mimeType: String(data.mime_type)} : {}),
    streams,
  };
};

export const tordroidPlusMedia = async (fileId: string): Promise<TordroidPlusMedia> =>
  parseTordroidPlusMedia(await tordroidPlusRequest(`/media/${encodeURIComponent(fileId)}`));

/** Adds a magnet (or eD2k link) to the family account. Returns the portal's message. */
export const addToTordroidPlus = async (url: string): Promise<string> => {
  const data = await tordroidPlusRequest('/add', {method: 'POST', body: JSON.stringify({url: url.trim()})});
  return data?.message === 'Task already exists' ? 'Already in the family downloads' : 'Added to the family downloads';
};

export const tordroidPlusQuota = async (): Promise<PikPakQuota> => {
  const data = await tordroidPlusRequest('/quota');
  return parsePikPakQuota(data?.storage, data?.transfer);
};

export const shareTordroidPlusFile = async (fileId: string): Promise<ShareLink> =>
  parseShareLink(await tordroidPlusRequest('/share', {method: 'POST', body: JSON.stringify({id: fileId})}));

export interface TordroidPlusWebDav {
  server: string;
  username: string;
  password: string;
  /** Epoch ms; the portal makes new logins on a schedule. */
  expiresAt?: number;
}

/** Picks the read-only WebDAV login that lasts longest from /webdav/active-clients. */
export const parseTordroidPlusWebDav = (data: any): TordroidPlusWebDav | undefined => {
  const clients = (Array.isArray(data?.clients) ? data.clients : []).filter((client: any) => client?.username && client?.password && client?.serverUrl);
  if (!clients.length) return undefined;
  const expiry = (client: any) => {
    const at = Date.parse(client.expiresAt || '');
    return Number.isFinite(at) ? at : 0;
  };
  const best = clients.slice().sort((a: any, b: any) => expiry(b) - expiry(a))[0];
  return {server: String(best.serverUrl).replace(/\/+$/, ''), username: String(best.username), password: String(best.password), ...(expiry(best) ? {expiresAt: expiry(best)} : {})};
};

export const tordroidPlusWebDav = async (): Promise<TordroidPlusWebDav> => {
  const login = parseTordroidPlusWebDav(await tordroidPlusRequest('/webdav/active-clients'));
  if (!login) throw new Error('Tordroid Plus has no WebDAV login right now. Try again later.');
  return login;
};
