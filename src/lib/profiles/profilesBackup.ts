import {validateLibraryBackup} from '../libraryBackup';
import {isPinHash, type PinHash} from './pin';
import {
  isAskOnStart,
  isProfile,
  listProfiles,
  MAX_PROFILES,
  readPinHash,
  readSavedProfiles,
  setAskOnStart,
  writePinHash,
  type Profile,
} from './profiles';
import {readProfileData, writeProfileData, type ProfileData, type ProfileDataSelection} from './profileData';
import {getActiveProfileId, PROFILES_LIST_KEY} from './scope';
import {mainStorage} from '../storage/StorageService';

/**
 * Profiles in a backup file. The data of the profile in use at backup time
 * ([current]) stays in the file's top-level library, history and progress,
 * which older versions read; [data] holds every other profile.
 */
export interface ProfilesBackup {
  list: Profile[];
  current: string;
  askOnStart?: boolean;
  /** Salted PIN hashes, so a restored kids profile stays locked. Never the PIN. */
  pins?: Record<string, PinHash>;
  data?: Record<string, ProfileData>;
}

export const createProfilesBackup = (selection: ProfileDataSelection): ProfilesBackup => {
  const list = listProfiles();
  const current = getActiveProfileId();
  const pins: Record<string, PinHash> = {};
  for (const profile of list) {
    const pin = readPinHash(profile.id);
    if (pin) pins[profile.id] = pin;
  }
  const data: Record<string, ProfileData> = {};
  if (selection.library || selection.history || selection.progress) {
    for (const profile of list) {
      if (profile.id !== current) data[profile.id] = readProfileData(profile.id, selection);
    }
  }
  return {list, current, askOnStart: isAskOnStart(), pins, data};
};

/**
 * Throws when the section is malformed. Per-profile history and progress
 * are checked by backup.ts with the same checks as the top-level ones.
 */
export const validateProfilesBackup = (
  value: unknown,
  validateHistory: (value: unknown) => void,
  validateProgress: (value: unknown) => void,
): void => {
  if (value === undefined) return;
  const backup = value as ProfilesBackup;
  if (!backup || typeof backup !== 'object' || !Array.isArray(backup.list) || !backup.list.length ||
    backup.list.length > MAX_PROFILES || !backup.list.every(isProfile) || backup.list.every(item => item.kids) || typeof backup.current !== 'string' ||
    new Set(backup.list.map(item => item.id)).size !== backup.list.length ||
    (backup.askOnStart !== undefined && typeof backup.askOnStart !== 'boolean') ||
    (backup.pins !== undefined && (typeof backup.pins !== 'object' || backup.pins === null || !Object.values(backup.pins).every(isPinHash))) ||
    (backup.data !== undefined && (typeof backup.data !== 'object' || backup.data === null || Array.isArray(backup.data)))) {
    throw new Error('This backup contains invalid profiles');
  }
  for (const data of Object.values(backup.data || {})) {
    if (!data || typeof data !== 'object') throw new Error('This backup contains invalid profiles');
    validateLibraryBackup(data.library);
    validateHistory(data.history);
    validateProgress(data.progress);
  }
};

/**
 * Adds the backup's profiles to the ones on this device (same id: the
 * backup's name, avatar and kids setting win) and restores their data.
 * [restoreActive] restores data for the profile in use through its live
 * stores. Returns the profile that gets the file's top-level data.
 */
export const restoreProfilesBackup = (
  backup: ProfilesBackup | undefined,
  restoreActive: (data: ProfileData) => void,
): string => {
  const active = getActiveProfileId();
  if (!backup) return active;
  const local = readSavedProfiles() ?? listProfiles();
  const merged = [...local];
  for (const profile of backup.list) {
    const index = merged.findIndex(item => item.id === profile.id);
    if (index >= 0) merged[index] = {...profile};
    else if (merged.length < MAX_PROFILES) merged.push({...profile});
  }
  mainStorage.setString(PROFILES_LIST_KEY, JSON.stringify(merged));
  const kept = new Set(merged.map(item => item.id));
  for (const [id, pin] of Object.entries(backup.pins || {})) if (kept.has(id)) writePinHash(id, pin);
  if (backup.askOnStart !== undefined) setAskOnStart(backup.askOnStart);
  for (const [id, data] of Object.entries(backup.data || {})) {
    if (!kept.has(id)) continue;
    if (id === active) restoreActive(data);
    else writeProfileData(id, data);
  }
  return kept.has(backup.current) ? backup.current : active;
};
