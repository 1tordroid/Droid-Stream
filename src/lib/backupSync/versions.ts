/**
 * Backup file names in the sync folder, the version list and pruning.
 *
 * ds-backup-<device>-<yyyymmddThhmmssZ>.json, with ".e" before ".json" when
 * the file carries encrypted sign-ins. <device> is a slug of the device name
 * and a short random id, so each device prunes only its own versions.
 */

export interface BackupVersion {
  name: string;
  device: string;
  /** ms since epoch, from the name. */
  createdAt: number;
  encrypted: boolean;
  size?: number;
}

const NAME = /^ds-backup-([a-z0-9-]{1,48})-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z(\.e)?\.json$/;

export const deviceSlug = (name: string, id: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  const safeId = id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'device';
  return `${slug || 'device'}-${safeId}`;
};

const pad = (value: number) => String(value).padStart(2, '0');

export const backupFileName = (device: string, createdAt: number, encrypted: boolean): string => {
  const date = new Date(createdAt);
  const stamp =
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return `ds-backup-${device}-${stamp}${encrypted ? '.e' : ''}.json`;
};

export const parseBackupFileName = (name: string, size?: number): BackupVersion | undefined => {
  const match = NAME.exec(name);
  if (!match) return undefined;
  const [, device, year, month, day, hour, minute, second, encrypted] = match;
  const createdAt = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  if (!Number.isFinite(createdAt)) return undefined;
  return {name, device, createdAt, encrypted: Boolean(encrypted), ...(size !== undefined ? {size} : {})};
};

/** Backups in a folder listing, newest first. Other files are ignored. */
export const listVersions = (files: Array<{name: string; size?: number; directory?: boolean}>): BackupVersion[] =>
  files
    .filter(file => !file.directory)
    .map(file => parseBackupFileName(file.name, file.size))
    .filter((item): item is BackupVersion => Boolean(item))
    .sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));

/** This device's versions beyond the newest [keep]; other devices' files are never pruned. */
export const versionsToPrune = (versions: BackupVersion[], device: string, keep: number): BackupVersion[] => {
  const limit = Math.max(1, Math.floor(keep));
  return versions
    .filter(version => version.device === device)
    .sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name))
    .slice(limit);
};

/** The device name part of a slug, for the version list. */
export const deviceLabel = (device: string): string => {
  const parts = device.split('-');
  if (parts.length > 1) parts.pop();
  const label = parts.join(' ').trim();
  return label ? label.replace(/\b\w/g, letter => letter.toUpperCase()) : 'Device';
};
