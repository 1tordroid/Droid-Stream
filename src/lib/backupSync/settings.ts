/**
 * Backup sync settings. They live in the encrypted sources store (with the
 * WebDAV sign-ins) under "backup-sync." keys, which backups never carry.
 */
import {MMKVLoader} from 'react-native-mmkv-storage';
import {listSources} from '../sources/vault';
import type {WebDavTarget} from './webdav';

const storage = new MMKVLoader().withInstanceID('droid-stream-sources').withEncryption().recoverOnKeyLoss().initialize();

export type AutoMode = 'off' | 'daily' | 'change';

export type SyncTarget =
  | {kind: 'source'; sourceId: string; folder: string}
  | {kind: 'custom'; server: string; username: string; password: string; folder: string};

export interface SyncStatus {
  lastSuccessAt?: number;
  lastAttemptAt?: number;
  lastError?: string;
  lastFile?: string;
  /** Change detection for automatic backups; a hash, never the data. */
  fingerprint?: string;
}

export const KEEP_CHOICES = [3, 5, 10, 20] as const;
export const DEFAULT_FOLDER = 'Droid Stream backups';

const KEYS = {
  target: 'backup-sync.target',
  passphrase: 'backup-sync.passphrase',
  auto: 'backup-sync.auto',
  wifiOnly: 'backup-sync.wifi-only',
  keep: 'backup-sync.keep',
  status: 'backup-sync.status',
  deviceId: 'backup-sync.device-id',
};

const readJson = <T,>(key: string): T | undefined => {
  try {
    const raw = storage.getString(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
};

export const readTarget = (): SyncTarget | undefined => readJson<SyncTarget>(KEYS.target);
export const writeTarget = (target: SyncTarget | undefined): void => {
  if (target) storage.setString(KEYS.target, JSON.stringify(target));
  else storage.removeItem(KEYS.target);
};

/** The WebDAV details for a target, or undefined when its saved source is gone. */
export const resolveTarget = (target: SyncTarget | undefined = readTarget()): WebDavTarget | undefined => {
  if (!target) return undefined;
  if (target.kind === 'custom') {
    return {server: target.server, username: target.username, password: target.password, folder: target.folder};
  }
  const source = listSources().find(item => item.id === target.sourceId && item.kind === 'webdav');
  return source ? {server: source.server, username: source.username, password: source.secret, folder: target.folder} : undefined;
};

export const describeTarget = (target: SyncTarget | undefined = readTarget()): string | undefined => {
  if (!target) return undefined;
  if (target.kind === 'custom') {
    let host = target.server;
    try {
      host = new URL(target.server).host;
    } catch {}
    return `${host} / ${target.folder}`;
  }
  const source = listSources().find(item => item.id === target.sourceId);
  return source ? `${source.name} / ${target.folder}` : undefined;
};

export const readPassphrase = (): string => storage.getString(KEYS.passphrase) || '';
export const writePassphrase = (passphrase: string): void => {
  if (passphrase) storage.setString(KEYS.passphrase, passphrase);
  else storage.removeItem(KEYS.passphrase);
};

export const readAutoMode = (): AutoMode => {
  const value = storage.getString(KEYS.auto);
  return value === 'daily' || value === 'change' ? value : 'off';
};
export const writeAutoMode = (mode: AutoMode): void => {
  storage.setString(KEYS.auto, mode);
};

export const readWifiOnly = (): boolean => storage.getString(KEYS.wifiOnly) !== 'false';
export const writeWifiOnly = (value: boolean): void => {
  storage.setString(KEYS.wifiOnly, value ? 'true' : 'false');
};

export const readKeep = (): number => {
  const value = Number(storage.getString(KEYS.keep));
  return (KEEP_CHOICES as readonly number[]).includes(value) ? value : 5;
};
export const writeKeep = (value: number): void => {
  storage.setString(KEYS.keep, String(value));
};

export const readStatus = (): SyncStatus => readJson<SyncStatus>(KEYS.status) || {};
export const updateStatus = (patch: SyncStatus): SyncStatus => {
  const next = {...readStatus(), ...patch};
  storage.setString(KEYS.status, JSON.stringify(next));
  return next;
};

/** A short random id for this install's file names. Not the media-server install id. */
export const readDeviceId = (random: () => string = () => Math.random().toString(36).slice(2, 8)): string => {
  let id = storage.getString(KEYS.deviceId);
  if (!id) {
    id = random();
    storage.setString(KEYS.deviceId, id);
  }
  return id;
};
