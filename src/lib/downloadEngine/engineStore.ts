/**
 * Settings and per-download options for the extra download engines (DASH,
 * live recording, FTP, mirrors, link refresh). Kept out of the downloads store
 * so its records stay as they are.
 */
import {MMKVLoader} from 'react-native-mmkv-storage';
import {openStore} from '../storage/openStore';
import {settingsStorage} from '../storage';
import type {MirrorRule} from './mirrors';

const storage = openStore('droid-stream-download-engine');
const OPTIONS_KEY = 'options';

export interface LiveRecordingOptions {
  /** Ms since epoch. The recording waits in the queue until then. */
  startAt?: number;
  /** Ms since epoch. */
  stopAt?: number;
  maxDurationMs?: number;
  /** JioTV channel id: its address expires, so a fresh one is fetched at start. */
  jioChannelId?: string;
  channelName?: string;
}

export interface DebridSource {
  service: string;
  transfer: {id: string; name: string; status?: string};
  file: {id: string; name: string; size: number; link?: string};
}

export interface DownloadEngineOptions {
  dash?: {video?: string; audio?: string};
  live?: LiveRecordingOptions;
  /** A debrid file, so an expired link can be made again. */
  debrid?: DebridSource;
  /** When the options were last written, ms since epoch. */
  savedAt?: number;
}

const readAll = (): Record<string, DownloadEngineOptions> => {
  try {
    return JSON.parse(storage.getString(OPTIONS_KEY) || '{}');
  } catch {
    return {};
  }
};

const writeAll = (all: Record<string, DownloadEngineOptions>) => storage.setString(OPTIONS_KEY, JSON.stringify(all));

export const getEngineOptions = (downloadId: string): DownloadEngineOptions => readAll()[downloadId] || {};

export const setEngineOptions = (downloadId: string, options: DownloadEngineOptions): void => {
  const all = readAll();
  all[downloadId] = {...all[downloadId], ...options, savedAt: Date.now()};
  writeAll(all);
};

/**
 * Drops options of downloads that no longer exist. Fresh ones are kept: their
 * download may still be on its way into the queue.
 */
export const pruneEngineOptions = (existingIds: Iterable<string>, now = Date.now()): void => {
  const keep = new Set(existingIds);
  const all = readAll();
  const ids = Object.keys(all).filter(id => !keep.has(id) && now - (all[id].savedAt || 0) > 60 * 60_000);
  if (!ids.length) return;
  ids.forEach(id => delete all[id]);
  writeAll(all);
};

/** Ms until a scheduled recording may start, or 0 when it can start now. */
export const scheduledStartDelay = (downloadId: string, now = Date.now()): number => {
  const startAt = getEngineOptions(downloadId).live?.startAt;
  return startAt && startAt > now ? startAt - now : 0;
};

// ---- Channels found to use DRM (JioTV tells only when a stream is fetched) ----

export const knownProtectedChannels = (): Set<string> => {
  try {
    return new Set(JSON.parse(storage.getString('protected-channels') || '[]'));
  } catch {
    return new Set();
  }
};

export const rememberChannelProtection = (url: string, isProtected: boolean): void => {
  const known = knownProtectedChannels();
  if (known.has(url) === isProtected) return;
  if (isProtected) known.add(url);
  else known.delete(url);
  storage.setString('protected-channels', JSON.stringify([...known].slice(-500)));
};

// ---- Advanced download settings ----

const bool = (key: string, fallback: boolean) => {
  const value = storage.getBool(key);
  return typeof value === 'boolean' ? value : fallback;
};

export const advancedDownloadSettings = {
  mirrorsEnabled: () => bool('mirrors-enabled', false),
  setMirrorsEnabled: (value: boolean) => storage.setBool('mirrors-enabled', value),
  mirrorRules: (): MirrorRule[] => {
    try {
      const rules = JSON.parse(storage.getString('mirror-rules') || '[]');
      return Array.isArray(rules) ? rules : [];
    } catch {
      return [];
    }
  },
  setMirrorRules: (rules: MirrorRule[]) => storage.setString('mirror-rules', JSON.stringify(rules)),
  /** Rules in use: none while mirrors are off. */
  activeMirrorRules: (): MirrorRule[] => (advancedDownloadSettings.mirrorsEnabled() ? advancedDownloadSettings.mirrorRules() : []),
  ftpPassive: () => bool('ftp-passive', true),
  setFtpPassive: (value: boolean) => storage.setBool('ftp-passive', value),
  /** Recordings are saved as MP4, or as MPEG-TS when this is on. */
  recordAsTs: () => bool('record-as-ts', false),
  setRecordAsTs: (value: boolean) => storage.setBool('record-as-ts', value),
  /** Expired provider and debrid links are fetched again and the download continues. */
  autoRefreshLinks: () => bool('auto-refresh-links', true),
  setAutoRefreshLinks: (value: boolean) => storage.setBool('auto-refresh-links', value),
};

/** Options the native FTP downloader takes. */
export const ftpOptions = () => ({
  passive: advancedDownloadSettings.ftpPassive(),
  connections: settingsStorage.getDownloadConnections(),
});

// ---- FTP sign-ins (passwords in an encrypted store) ----

export const FTP_STORE_ID = 'droid-stream-ftp';

let ftpStore: ReturnType<MMKVLoader['initialize']> | undefined;
const secure = () => {
  ftpStore ??= new MMKVLoader().withInstanceID('droid-stream-ftp').withEncryption().recoverOnKeyLoss().initialize();
  return ftpStore;
};

export interface FtpAccount {
  /** scheme://user@host:port */
  key: string;
  host: string;
  port: number;
  user: string;
  scheme: FtpScheme;
}

export type FtpScheme = 'ftp' | 'ftps' | 'ftpes';

export interface ParsedFtpUrl {
  scheme: FtpScheme;
  user: string;
  password?: string;
  host: string;
  port: number;
  path: string;
}

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** ftp:// (plain), ftpes:// (explicit TLS) or ftps:// (implicit TLS). */
export const parseFtpUrl = (url: string): ParsedFtpUrl | undefined => {
  const match = /^(ftp|ftps|ftpes):\/\/(?:([^:@/]*)(?::([^@/]*))?@)?(\[[^\]]+\]|[^:/?#]+)(?::(\d+))?(\/[^?#]*)?/i.exec(url.trim());
  if (!match) return undefined;
  const scheme = match[1].toLowerCase() as FtpScheme;
  return {
    scheme,
    user: match[2] ? decode(match[2]) : 'anonymous',
    password: match[3] !== undefined ? decode(match[3]) : undefined,
    host: match[4].toLowerCase(),
    port: match[5] ? Number(match[5]) : scheme === 'ftps' ? 990 : 21,
    path: decode(match[6] || '/'),
  };
};

export const ftpAccountKey = (parsed: Pick<ParsedFtpUrl, 'scheme' | 'user' | 'host' | 'port'>): string =>
  `${parsed.scheme}://${parsed.user}@${parsed.host}:${parsed.port}`;

/** The link without its password, which moves to the encrypted store. */
export const storeFtpPassword = (url: string): string => {
  const parsed = parseFtpUrl(url);
  if (!parsed || parsed.password === undefined) return url;
  saveFtpAccount(parsed, parsed.password);
  return url.replace(/^([a-z]+:\/\/[^:@/]*):[^@/]*@/i, '$1@');
};

const accountsKey = 'accounts';

export const listFtpAccounts = (): FtpAccount[] => {
  try {
    return JSON.parse(secure().getString(accountsKey) || '[]');
  } catch {
    return [];
  }
};

export const saveFtpAccount = (parsed: Pick<ParsedFtpUrl, 'scheme' | 'user' | 'host' | 'port'>, password: string): void => {
  const key = ftpAccountKey(parsed);
  const accounts = listFtpAccounts().filter(item => item.key !== key);
  accounts.push({key, host: parsed.host, port: parsed.port, user: parsed.user, scheme: parsed.scheme});
  secure().setString(accountsKey, JSON.stringify(accounts));
  secure().setString(`password:${key}`, password);
};

export const removeFtpAccount = (key: string): void => {
  secure().setString(accountsKey, JSON.stringify(listFtpAccounts().filter(item => item.key !== key)));
  secure().removeItem(`password:${key}`);
};

/** The saved password for this link's user and server. Anonymous sign-ins need none. */
export const ftpPasswordFor = (url: string): string | undefined => {
  const parsed = parseFtpUrl(url);
  if (!parsed) return undefined;
  if (parsed.password !== undefined) return parsed.password;
  return secure().getString(`password:${ftpAccountKey(parsed)}`) || undefined;
};
