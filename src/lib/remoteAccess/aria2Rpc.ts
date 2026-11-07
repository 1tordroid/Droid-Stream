/**
 * An aria2-compatible JSON-RPC 2.0 interface to the downloads list, for
 * AriaNg and the aria2 browser extensions. Written from aria2's public RPC
 * documentation; no aria2 code is used.
 *
 * The handler is pure: the downloads list and the actions come from
 * [Aria2Backend], so the rules can be tested without the app around them.
 */
import type {DownloadItem} from '../zustand/downloadsStore';
import {ARIA2_DIR, aria2StatusOf, gidFor, isGid, pickKeys, sliceLikeAria2, toAria2Status} from './aria2Status';
import {isPrivateLanAddress} from './lan';
import {FailedAttemptLimiter, safeEqual} from './secret';

export const ARIA2_VERSION = '1.37.0';

/** What an add request may set. The folder is always the app's download folder. */
export interface Aria2AddOptions {
  /** A file name only; any folder part is removed. */
  out?: string;
  headers: Record<string, string>;
}

export interface Aria2Backend {
  /** Downloads to show, in the order they were added. */
  list(): DownloadItem[];
  /** Adds a link and resolves the new download's id. */
  addUri(uri: string, options: Aria2AddOptions): Promise<string>;
  /** Adds a .torrent file given as base64 and resolves the new download's id. */
  addTorrent(base64: string, options: Aria2AddOptions): Promise<string>;
  pause(downloadId: string): Promise<void>;
  unpause(downloadId: string): Promise<void>;
  /** Stops a download and deletes its partial data. Never called for finished downloads. */
  remove(downloadId: string): Promise<void>;
  /** Bytes per second for all downloads, 0 for no limit. */
  speedLimit(): number;
  setSpeedLimit(bytesPerSecond: number): void;
  maxConcurrentDownloads(): number;
}

export class Aria2Error extends Error {
  constructor(message: string, readonly code = 1) {
    super(message);
    this.name = 'Aria2Error';
  }
}

const UNAUTHORIZED = 'Unauthorized';
const MAX_URI_LENGTH = 8192;
/** Decoded .torrent files larger than this are refused. */
export const MAX_TORRENT_BYTES = 4 * 1024 * 1024;
const MAX_BATCH = 100;

/** Headers a client may not set: the app sets these itself. */
const BLOCKED_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'range', 'upgrade', 'te', 'keep-alive', 'proxy-authorization']);

/** "1M", "500K", "1048576" to bytes per second, as aria2 reads speed options. */
export const parseAria2Speed = (value: unknown): number | undefined => {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d+(?:\.\d+)?)([KkMm])?$/);
  if (!match) return undefined;
  const unit = match[2]?.toUpperCase() === 'M' ? 1024 * 1024 : match[2] ? 1024 : 1;
  const bytes = Math.round(Number(match[1]) * unit);
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= 10 * 1024 * 1024 * 1024 ? bytes : undefined;
};

/** A safe file name from aria2's "out" option, or undefined when nothing usable is left. */
export const safeOutName = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const base = value.split(/[\\/]/).pop() || '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f:*?"<>|]/g, '').trim().slice(0, 200);
  if (!clean || clean === '.' || clean === '..' || /^\.+$/.test(clean)) return undefined;
  return clean;
};

const addHeader = (headers: Record<string, string>, line: string) => {
  const index = line.indexOf(':');
  if (index <= 0) return;
  const name = line.slice(0, index).trim();
  const value = line.slice(index + 1).trim();
  if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || BLOCKED_HEADERS.has(name.toLowerCase())) return;
  if (!value || value.length > 8192 || /[\r\n]/.test(value)) return;
  headers[name] = value;
};

/** Reads the add options the app supports. "dir" and every other option are ignored. */
export const parseAddOptions = (raw: unknown): Aria2AddOptions => {
  const options: Aria2AddOptions = {headers: {}};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return options;
  const values = raw as Record<string, unknown>;
  const out = safeOutName(values.out);
  if (out) options.out = out;
  const header = values.header;
  if (typeof header === 'string') addHeader(options.headers, header);
  if (Array.isArray(header)) header.slice(0, 32).forEach(line => typeof line === 'string' && addHeader(options.headers, line));
  if (typeof values['user-agent'] === 'string') addHeader(options.headers, `User-Agent: ${values['user-agent']}`);
  if (typeof values.referer === 'string' && values.referer !== '*') addHeader(options.headers, `Referer: ${values.referer}`);
  return options;
};

const SUPPORTED_SCHEMES = /^(https?|ftps?|ftpes|magnet|ed2k):/i;

export const ARIA2_METHODS = [
  'aria2.addUri',
  'aria2.addTorrent',
  'aria2.remove',
  'aria2.forceRemove',
  'aria2.pause',
  'aria2.pauseAll',
  'aria2.forcePause',
  'aria2.forcePauseAll',
  'aria2.unpause',
  'aria2.unpauseAll',
  'aria2.tellStatus',
  'aria2.getUris',
  'aria2.getFiles',
  'aria2.getPeers',
  'aria2.getServers',
  'aria2.tellActive',
  'aria2.tellWaiting',
  'aria2.tellStopped',
  'aria2.getOption',
  'aria2.getGlobalOption',
  'aria2.changeGlobalOption',
  'aria2.getGlobalStat',
  'aria2.purgeDownloadResult',
  'aria2.removeDownloadResult',
  'aria2.getVersion',
  'aria2.getSessionInfo',
  'aria2.saveSession',
  'system.multicall',
  'system.listMethods',
  'system.listNotifications',
] as const;

/** Methods aria2 answers without a token. */
const OPEN_METHODS = new Set(['system.listMethods', 'system.listNotifications']);

interface RpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export interface Aria2RpcOptions {
  backend: Aria2Backend;
  /** The current secret; requests must send "token:<secret>" as the first parameter. */
  token: () => string;
  limiter?: FailedAttemptLimiter;
  now?: () => number;
  sessionId?: string;
}

export interface Aria2Rpc {
  /** Answers one HTTP body or WebSocket message. Resolves null when nothing is sent back. */
  handle(body: string, client: string): Promise<string | null>;
}

const byAdded = (left: DownloadItem, right: DownloadItem) => left.createdAt - right.createdAt;
const byStopped = (left: DownloadItem, right: DownloadItem) =>
  (left.completedAt || left.updatedAt) - (right.completedAt || right.updatedAt);

const asInteger = (value: unknown, name: string): number => {
  const number = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number)) throw new Aria2Error(`${name} must be a whole number`);
  return number;
};

export const createAria2Rpc = ({backend, token, limiter = new FailedAttemptLimiter(), now = Date.now, sessionId}: Aria2RpcOptions): Aria2Rpc => {
  const session = sessionId || gidFor(`session-${now()}-${Math.random()}`) + gidFor(`session-${Math.random()}`).slice(0, 24);

  const find = (gid: unknown): DownloadItem => {
    if (!isGid(gid)) throw new Aria2Error('GID is not valid');
    const wanted = gid.toLowerCase();
    const item = backend.list().find(entry => gidFor(entry.id) === wanted);
    if (!item) throw new Aria2Error(`GID ${gid} is not found`);
    return item;
  };

  const statusList = (filter: (item: DownloadItem) => boolean, order: (a: DownloadItem, b: DownloadItem) => number) =>
    backend.list().filter(filter).sort(order);

  const active = () => statusList(item => aria2StatusOf(item.status) === 'active', byAdded);
  const waiting = () => statusList(item => ['waiting', 'paused'].includes(aria2StatusOf(item.status)), byAdded);
  const stopped = () => statusList(item => ['complete', 'error', 'removed'].includes(aria2StatusOf(item.status)), byStopped);

  const pauseOne = async (item: DownloadItem) => {
    if (aria2StatusOf(item.status) !== 'active') throw new Aria2Error(`GID ${gidFor(item.id)} cannot be paused now`);
    await backend.pause(item.id);
    return gidFor(item.id);
  };

  const unpauseOne = async (item: DownloadItem) => {
    if (aria2StatusOf(item.status) !== 'paused') throw new Aria2Error(`GID ${gidFor(item.id)} is not paused`);
    await backend.unpause(item.id);
    return gidFor(item.id);
  };

  const removeOne = async (item: DownloadItem) => {
    const status = aria2StatusOf(item.status);
    if (status === 'complete' || status === 'removed' || status === 'error') {
      throw new Aria2Error(`Active download not found for GID ${gidFor(item.id)}`);
    }
    await backend.remove(item.id);
    return gidFor(item.id);
  };

  const call = async (method: string, params: unknown[]): Promise<unknown> => {
    switch (method) {
      case 'aria2.addUri': {
        const uris = params[0];
        if (!Array.isArray(uris) || uris.length === 0 || typeof uris[0] !== 'string') throw new Aria2Error('No URI to download');
        const uri = uris[0].trim();
        if (uri.length > MAX_URI_LENGTH || !SUPPORTED_SCHEMES.test(uri)) {
          throw new Aria2Error('Only http, https, ftp, magnet and ed2k links can be added');
        }
        return gidFor(await backend.addUri(uri, parseAddOptions(params[1])));
      }
      case 'aria2.addTorrent': {
        const data = params[0];
        if (typeof data !== 'string' || !data) throw new Aria2Error('No torrent data');
        const clean = data.replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new Aria2Error('The torrent is not base64');
        if (Math.floor((clean.length * 3) / 4) > MAX_TORRENT_BYTES) throw new Aria2Error('The torrent file is too large');
        return gidFor(await backend.addTorrent(clean, parseAddOptions(params[2])));
      }
      case 'aria2.remove':
      case 'aria2.forceRemove':
        return removeOne(find(params[0]));
      case 'aria2.pause':
      case 'aria2.forcePause':
        return pauseOne(find(params[0]));
      case 'aria2.pauseAll':
      case 'aria2.forcePauseAll':
        for (const item of active()) await pauseOne(item).catch(() => undefined);
        return 'OK';
      case 'aria2.unpause':
        return unpauseOne(find(params[0]));
      case 'aria2.unpauseAll':
        for (const item of waiting()) {
          if (aria2StatusOf(item.status) === 'paused') await unpauseOne(item).catch(() => undefined);
        }
        return 'OK';
      case 'aria2.tellStatus':
        return pickKeys(toAria2Status(find(params[0])), params[1]);
      case 'aria2.getUris':
        return (toAria2Status(find(params[0])).files as {uris: unknown[]}[])[0].uris;
      case 'aria2.getFiles':
        return toAria2Status(find(params[0])).files;
      case 'aria2.getPeers':
      case 'aria2.getServers':
        find(params[0]);
        return [];
      case 'aria2.tellActive':
        return active().map(item => pickKeys(toAria2Status(item), params[0]));
      case 'aria2.tellWaiting':
        return sliceLikeAria2(waiting(), asInteger(params[0], 'offset'), asInteger(params[1], 'num')).map(item =>
          pickKeys(toAria2Status(item), params[2]),
        );
      case 'aria2.tellStopped':
        return sliceLikeAria2(stopped(), asInteger(params[0], 'offset'), asInteger(params[1], 'num')).map(item =>
          pickKeys(toAria2Status(item), params[2]),
        );
      case 'aria2.getOption':
        find(params[0]);
        return {dir: ARIA2_DIR};
      case 'aria2.getGlobalOption':
        return {
          dir: ARIA2_DIR,
          'max-overall-download-limit': String(backend.speedLimit()),
          'max-concurrent-downloads': String(backend.maxConcurrentDownloads()),
        };
      case 'aria2.changeGlobalOption': {
        const options = params[0];
        if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Aria2Error('No options given');
        const keys = Object.keys(options);
        if (keys.length === 0) return 'OK';
        if (keys.some(key => key !== 'max-overall-download-limit')) {
          throw new Aria2Error('Only max-overall-download-limit can be changed');
        }
        const limit = parseAria2Speed((options as Record<string, unknown>)['max-overall-download-limit']);
        if (limit === undefined) throw new Aria2Error('max-overall-download-limit is not a valid speed');
        backend.setSpeedLimit(limit);
        return 'OK';
      }
      case 'aria2.getGlobalStat': {
        const list = backend.list();
        const running = list.filter(item => aria2StatusOf(item.status) === 'active');
        const stoppedCount = list.filter(item => ['complete', 'error', 'removed'].includes(aria2StatusOf(item.status))).length;
        return {
          downloadSpeed: String(Math.round(running.reduce((sum, item) => sum + Math.max(0, item.speed || 0), 0))),
          uploadSpeed: '0',
          numActive: String(running.length),
          numWaiting: String(list.filter(item => ['waiting', 'paused'].includes(aria2StatusOf(item.status))).length),
          numStopped: String(stoppedCount),
          numStoppedTotal: String(stoppedCount),
        };
      }
      case 'aria2.removeDownloadResult': {
        const item = find(params[0]);
        // A failed download's partial data is cleared; finished files are never deleted from here.
        if (aria2StatusOf(item.status) === 'error') await backend.remove(item.id);
        else if (aria2StatusOf(item.status) !== 'complete' && aria2StatusOf(item.status) !== 'removed') {
          throw new Aria2Error(`GID ${gidFor(item.id)} is still active`);
        }
        return 'OK';
      }
      case 'aria2.purgeDownloadResult':
      case 'aria2.saveSession':
        return 'OK';
      case 'aria2.getVersion':
        return {version: ARIA2_VERSION, enabledFeatures: ['BitTorrent', 'HTTPS']};
      case 'aria2.getSessionInfo':
        return {sessionId: session};
      case 'system.listMethods':
        return [...ARIA2_METHODS];
      case 'system.listNotifications':
        return [];
      default:
        throw new Aria2Error(`No such method: ${method}`, -32601);
    }
  };

  /** Checks the token and runs one call. */
  const authorizedCall = async (method: unknown, rawParams: unknown, client: string): Promise<unknown> => {
    if (typeof method !== 'string') throw new Aria2Error('Invalid request', -32600);
    const params = rawParams === undefined ? [] : rawParams;
    if (!Array.isArray(params)) throw new Aria2Error('Invalid params', -32602);
    if (OPEN_METHODS.has(method)) {
      const rest = typeof params[0] === 'string' && params[0].startsWith('token:') ? params.slice(1) : params;
      return call(method, rest);
    }
    if (method === 'system.multicall') return multicall(params, client);
    if (limiter.isLocked(client, now())) throw new Aria2Error(UNAUTHORIZED);
    const first = params[0];
    const secret = token();
    const given = typeof first === 'string' && first.startsWith('token:') ? first.slice(6) : undefined;
    if (given === undefined || !safeEqual(given, secret)) {
      limiter.recordFailure(client, now());
      throw new Aria2Error(UNAUTHORIZED);
    }
    limiter.recordSuccess(client);
    return call(method, params.slice(1));
  };

  const multicall = async (params: unknown[], client: string): Promise<unknown> => {
    const calls = params[0];
    if (!Array.isArray(calls)) throw new Aria2Error('Invalid params', -32602);
    if (calls.length > MAX_BATCH) throw new Aria2Error('Too many calls');
    const results: unknown[] = [];
    for (const entry of calls) {
      const value = entry as {methodName?: unknown; params?: unknown};
      try {
        if (!value || typeof value !== 'object' || value.methodName === 'system.multicall') {
          throw new Aria2Error('Invalid call in multicall');
        }
        results.push([await authorizedCall(value.methodName, value.params, client)]);
      } catch (error) {
        results.push(errorObject(error));
      }
    }
    return results;
  };

  const errorObject = (error: unknown) =>
    error instanceof Aria2Error ? {code: error.code, message: error.message} : {code: 1, message: (error as Error)?.message || 'Failed'};

  const one = async (request: RpcRequest, client: string): Promise<Record<string, unknown> | null> => {
    const id = request && typeof request === 'object' && 'id' in request ? request.id : undefined;
    const isNotification = id === undefined;
    const reply = (body: Record<string, unknown>) => (isNotification ? null : {jsonrpc: '2.0', id: id ?? null, ...body});
    if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.method !== 'string') {
      return {jsonrpc: '2.0', id: id ?? null, error: {code: -32600, message: 'Invalid Request'}};
    }
    try {
      return reply({result: await authorizedCall(request.method, request.params, client)});
    } catch (error) {
      return reply({error: errorObject(error)});
    }
  };

  return {
    async handle(body: string, client: string): Promise<string | null> {
      // The native server refuses these already; checked again here.
      if (!isPrivateLanAddress(client)) {
        return JSON.stringify({jsonrpc: '2.0', id: null, error: {code: 1, message: UNAUTHORIZED}});
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return JSON.stringify({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'Parse error'}});
      }
      if (Array.isArray(parsed)) {
        if (parsed.length === 0 || parsed.length > MAX_BATCH) {
          return JSON.stringify({jsonrpc: '2.0', id: null, error: {code: -32600, message: 'Invalid Request'}});
        }
        const replies: Record<string, unknown>[] = [];
        for (const request of parsed) {
          const reply = await one(request as RpcRequest, client);
          if (reply) replies.push(reply);
        }
        return replies.length ? JSON.stringify(replies) : null;
      }
      const reply = await one(parsed as RpcRequest, client);
      return reply ? JSON.stringify(reply) : null;
    },
  };
};
