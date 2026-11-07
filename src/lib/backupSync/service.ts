/**
 * Backup sync: back up to a WebDAV folder now or automatically, keep the
 * last N versions of this device, and read versions back for a restore.
 */
import {AppState} from 'react-native';
import {
  buildSyncFile,
  collectSyncContent,
  deviceName,
  fingerprintContent,
  parseSyncFile,
  type SyncBackupFile,
  type SyncContent,
} from './payload';
import {syncNative} from './native';
import {
  readAutoMode,
  readDeviceId,
  readKeep,
  readPassphrase,
  readStatus,
  readWifiOnly,
  resolveTarget,
  updateStatus,
  type AutoMode,
  type SyncStatus,
} from './settings';
import {backupFileName, deviceSlug, listVersions, versionsToPrune, type BackupVersion} from './versions';
import {deleteFile, downloadFile, ensureFolder, listFolder, uploadFile, type WebDavTarget} from './webdav';

const DAY_MS = 24 * 60 * 60 * 1000;
/** After a failed or finished try, automatic backups wait at least this long. */
const RETRY_MS = 30 * 60 * 1000;
const CHANGE_MIN_GAP_MS = 10 * 60 * 1000;
const CHECK_EVERY_MS = 30 * 60 * 1000;
const FIRST_CHECK_MS = 90 * 1000;

const requireTarget = (): WebDavTarget => {
  const target = resolveTarget();
  if (!target) throw new Error('Choose a WebDAV folder first');
  return target;
};

export const thisDevice = (): string => deviceSlug(deviceName(), readDeviceId());

export interface BackupResult {
  name: string;
  withSignIns: boolean;
}

let inFlight: Promise<BackupResult> | undefined;

const runBackup = async (content?: SyncContent, now = Date.now()): Promise<BackupResult> => {
  const target = requireTarget();
  const passphrase = readPassphrase();
  updateStatus({lastAttemptAt: now});
  try {
    const data = content || (await collectSyncContent(Boolean(passphrase)));
    const fingerprint = fingerprintContent(data);
    const file = await buildSyncFile(data, passphrase, undefined, now);
    const device = thisDevice();
    const name = backupFileName(device, now, Boolean(file.secrets));
    await ensureFolder(target);
    await uploadFile(target, name, JSON.stringify(file));
    try {
      const old = versionsToPrune(listVersions(await listFolder(target)), device, readKeep());
      for (const version of old) await deleteFile(target, version.name);
    } catch (error) {
      console.warn('Backup sync: could not remove old versions', error instanceof Error ? error.message : '');
    }
    updateStatus({lastSuccessAt: now, lastError: undefined, lastFile: name, fingerprint});
    return {name, withSignIns: Boolean(file.secrets)};
  } catch (error) {
    updateStatus({lastError: error instanceof Error ? error.message : 'Backup failed'});
    throw error;
  }
};

/** Backs up now. A second call while one runs waits for the same backup. */
export const backUpNow = (content?: SyncContent): Promise<BackupResult> => {
  if (!inFlight) {
    inFlight = runBackup(content).finally(() => {
      inFlight = undefined;
    });
  }
  return inFlight;
};

/** Whether an automatic backup should run now. [fingerprint] is only needed for 'change'. */
export const autoBackupDue = (mode: AutoMode, status: SyncStatus, now: number, fingerprint?: string): boolean => {
  if (mode === 'off') return false;
  const lastAttempt = status.lastAttemptAt ?? 0;
  if (mode === 'daily') {
    if (status.lastSuccessAt && now - status.lastSuccessAt < DAY_MS) return false;
    return !lastAttempt || now - lastAttempt >= RETRY_MS || (status.lastSuccessAt ?? 0) >= lastAttempt;
  }
  if (lastAttempt && now - lastAttempt < CHANGE_MIN_GAP_MS) return false;
  if (status.lastError && lastAttempt && now - lastAttempt < RETRY_MS) return false;
  return fingerprint !== undefined && fingerprint !== status.fingerprint;
};

/** One automatic check: follows the mode, the Wi-Fi setting and the timing rules. */
export const runAutoBackup = async (now = Date.now()): Promise<boolean> => {
  const mode = readAutoMode();
  if (mode === 'off' || inFlight || !resolveTarget()) return false;
  const status = readStatus();
  if (mode === 'daily' && !autoBackupDue(mode, status, now)) return false;
  if (mode === 'change' && status.lastAttemptAt && now - status.lastAttemptAt < CHANGE_MIN_GAP_MS) return false;
  if (readWifiOnly() && !(await syncNative.isUnmetered())) return false;
  let content: SyncContent | undefined;
  if (mode === 'change') {
    content = await collectSyncContent(Boolean(readPassphrase()));
    if (!autoBackupDue(mode, status, now, fingerprintContent(content))) return false;
  }
  try {
    await backUpNow(content);
    return true;
  } catch {
    // The reason is kept in the status for Settings.
    return false;
  }
};

/** Starts automatic backups while the app runs. Returns a stop function. */
export const startBackupSync = (): (() => void) => {
  const check = () => {
    runAutoBackup().catch(() => undefined);
  };
  const first = setTimeout(check, FIRST_CHECK_MS);
  const timer = setInterval(check, CHECK_EVERY_MS);
  const subscription = AppState.addEventListener('change', state => {
    if (state === 'background') check();
  });
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    subscription.remove();
  };
};

export const fetchVersions = async (): Promise<BackupVersion[]> => listVersions(await listFolder(requireTarget()));

export const downloadVersion = async (name: string): Promise<SyncBackupFile> =>
  parseSyncFile(await downloadFile(requireTarget(), name));

/** Checks that the folder can be made and listed. */
export const testTarget = async (target: WebDavTarget): Promise<number> => {
  await ensureFolder(target);
  return listVersions(await listFolder(target)).length;
};
