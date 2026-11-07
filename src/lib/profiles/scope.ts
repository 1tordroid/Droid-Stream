import {openStore, type MMKVStore} from '../storage/openStore';

/**
 * Profile ids and where each profile keeps its data.
 *
 * The first profile has the id "default" and uses the keys and MMKV
 * instances the app used before profiles existed, so an upgrade keeps every
 * saved title, position and sign-in without moving any data. Every other
 * profile gets its own copy of each per-profile key ("p.<id>.<key>") and of
 * each per-profile instance ("<instance>-p-<id>").
 *
 * The active profile is read once per JS launch. Switching profiles saves the
 * new id and restarts the JS app, so every store loads the right data.
 */
export const DEFAULT_PROFILE_ID = 'default';

/** Plain (default store) key holding the id of the profile in use. */
export const ACTIVE_PROFILE_KEY = 'profiles.active';
/** Plain (default store) key holding the saved profiles (profiles.ts). */
export const PROFILES_LIST_KEY = 'profiles.list';

const PROFILE_ID_PATTERN = /^[a-z0-9]{1,24}$/;

export const isValidProfileId = (id: unknown): id is string =>
  typeof id === 'string' && PROFILE_ID_PATTERN.test(id);

export const createProfileId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 24);

/** The key [key] of profile [profileId]. The default profile keeps the bare key. */
export const profileKey = (key: string, profileId: string = getActiveProfileId()): string =>
  profileId === DEFAULT_PROFILE_ID ? key : `p.${profileId}.${key}`;

/** Prefix of every key the profile owns in a shared store. Empty for the default profile. */
export const profileKeyPrefix = (profileId: string): string =>
  profileId === DEFAULT_PROFILE_ID ? '' : `p.${profileId}.`;

/** The MMKV instance id [base] of profile [profileId]. */
export const profileInstanceId = (base: string, profileId: string = getActiveProfileId()): string =>
  profileId === DEFAULT_PROFILE_ID ? base : `${base}-p-${profileId}`;

let defaultStore: MMKVStore | undefined;
const store = () => (defaultStore ||= openStore());

let active: string | undefined;

/** MMKV instances each profile has its own copy of (see profileInstanceId). */
export const PROFILE_INSTANCE_BASES = ['watch-progress'] as const;

/** Ids in the saved profile list, or undefined before the first profile was saved. */
export const savedProfileIds = (): string[] | undefined => {
  try {
    const parsed = JSON.parse(store().getString(PROFILES_LIST_KEY) || 'null');
    if (!Array.isArray(parsed)) return undefined;
    const ids = parsed.map(item => item?.id).filter(isValidProfileId);
    return ids.length ? ids : undefined;
  } catch {
    return undefined;
  }
};

/** The profile this JS launch runs as. */
export const getActiveProfileId = (): string => {
  if (active === undefined) {
    let saved: string | undefined;
    try {
      saved = store().getString(ACTIVE_PROFILE_KEY) ?? undefined;
    } catch {
      saved = undefined;
    }
    const ids = savedProfileIds();
    if (isValidProfileId(saved) && (!ids || ids.includes(saved))) active = saved;
    else active = ids?.[0] ?? DEFAULT_PROFILE_ID;
  }
  return active;
};

export const isDefaultProfileActive = (): boolean => getActiveProfileId() === DEFAULT_PROFILE_ID;

/** Saves the profile the next JS launch runs as. Callers restart the app after it. */
export const saveActiveProfileId = (id: string): void => {
  store().setString(ACTIVE_PROFILE_KEY, isValidProfileId(id) ? id : DEFAULT_PROFILE_ID);
};

/** Tests only: forget the cached profile so the next read loads it again. */
export const resetActiveProfileCacheForTests = (): void => {
  active = undefined;
  defaultStore = undefined;
};

/** Minimal string store, as used by the encrypted watch-sync store. */
export interface StringStore {
  getString(key: string): string | null | undefined;
  setString(key: string, value: string): unknown;
  removeItem(key: string): unknown;
}

/**
 * The same store with every key moved under the profile. Used for an
 * encrypted store, so a profile does not need an instance of its own (each
 * encrypted instance needs its own backup exclusion rule).
 */
export const scopedStringStore = <T extends StringStore>(
  base: T,
  profileId: string | (() => string) = getActiveProfileId,
): StringStore => {
  const id = () => (typeof profileId === 'function' ? profileId() : profileId);
  return {
    getString: key => base.getString(profileKey(key, id())),
    setString: (key, value) => base.setString(profileKey(key, id()), value),
    removeItem: key => base.removeItem(profileKey(key, id())),
  };
};
