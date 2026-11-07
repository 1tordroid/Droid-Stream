import {MMKVLoader} from 'react-native-mmkv-storage';
import {openStore, type MMKVStore} from '../storage/openStore';
import {
  checkPin,
  hashPin,
  isPinHash,
  NO_ATTEMPTS,
  type PinAttempts,
  type PinCheck,
  type PinHash,
} from './pin';
import {
  createProfileId,
  DEFAULT_PROFILE_ID,
  getActiveProfileId,
  isValidProfileId,
  PROFILES_LIST_KEY,
  saveActiveProfileId,
} from './scope';

export interface Profile {
  id: string;
  name: string;
  /** One emoji shown on the avatar. */
  emoji: string;
  /** Avatar background, a hex colour. */
  color: string;
  /** Kids profile: hides 18+ titles, torrents, settings, sign-ins and adult TV groups. */
  kids: boolean;
  createdAt: number;
}

export type ProfileDraft = Pick<Profile, 'name' | 'emoji' | 'color' | 'kids'>;

/** Plain default-store keys. The list (PROFILES_LIST_KEY) holds no PINs. */
export {PROFILES_LIST_KEY};
export const PROFILES_ASK_ON_START_KEY = 'profiles.askOnStart';
/** Id of a profile unlocked in the picker just before the app restarted into it. */
export const PROFILES_UNLOCKED_KEY = 'profiles.unlockedForLaunch';

export const MAX_PROFILES = 8;
export const MAX_NAME_LENGTH = 20;

export const PROFILE_COLORS = ['#E5484D', '#F76B15', '#FFC53D', '#46A758', '#12A594', '#0090FF', '#6E56CF', '#D6409F'];
export const PROFILE_EMOJIS = ['🙂', '😎', '🤓', '🥳', '🦊', '🐼', '🐯', '🐸', '🦄', '🐙', '🚀', '⚽', '🎮', '🎧', '🌟', '🍕'];

export const DEFAULT_PROFILE: Profile = {
  id: DEFAULT_PROFILE_ID,
  name: 'Me',
  emoji: '🙂',
  color: PROFILE_COLORS[5],
  kids: false,
  createdAt: 0,
};

let plain: MMKVStore | undefined;
const plainStore = () => (plain ||= openStore());

/** PIN hashes and wrong-try counts. Encrypted; see secureStores.ts. */
let secure: MMKVStore | undefined;
const secureStore = () =>
  (secure ||= new MMKVLoader().withInstanceID('droid-stream-profiles').withEncryption().recoverOnKeyLoss().initialize());

const pinKey = (id: string) => `pin:${id}`;
const attemptsKey = (id: string) => `attempts:${id}`;

/** Tests only. */
export const resetProfileStoresForTests = (): void => {
  plain = undefined;
  secure = undefined;
};

const cleanName = (name: string): string => name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);

export const isProfile = (value: unknown): value is Profile => {
  const item = value as Profile;
  return Boolean(item) && isValidProfileId(item.id) && typeof item.name === 'string' && item.name.trim().length > 0 &&
    typeof item.emoji === 'string' && typeof item.color === 'string' && typeof item.kids === 'boolean' &&
    typeof item.createdAt === 'number' && Number.isFinite(item.createdAt);
};

/** Saved profiles, or undefined when none were saved yet (an install from before profiles). */
export const readSavedProfiles = (): Profile[] | undefined => {
  const raw = plainStore().getString(PROFILES_LIST_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const seen = new Set<string>();
    const list = parsed.filter(item => isProfile(item) && !seen.has(item.id) && seen.add(item.id));
    return list.length ? list : undefined;
  } catch {
    return undefined;
  }
};

const writeProfiles = (profiles: Profile[]): Profile[] => {
  plainStore().setString(PROFILES_LIST_KEY, JSON.stringify(profiles));
  return profiles;
};

/**
 * Upgrade step, run before anything reads per-profile data. An install from
 * before profiles gets one profile, "default", which reads the keys it always
 * used, so nothing is moved or lost. Safe to run on every start.
 */
export const ensureProfiles = (): Profile[] => {
  const saved = readSavedProfiles();
  if (saved) return saved;
  return writeProfiles([{...DEFAULT_PROFILE}]);
};

export const listProfiles = (): Profile[] => ensureProfiles();

export const getProfile = (id: string): Profile | undefined => listProfiles().find(item => item.id === id);

export const getActiveProfile = (): Profile => {
  const profiles = listProfiles();
  return profiles.find(item => item.id === getActiveProfileId()) ?? profiles[0];
};

export const isKidsProfileActive = (): boolean => getActiveProfile().kids;

export const createProfile = (draft: ProfileDraft, now = Date.now()): Profile => {
  const profiles = listProfiles();
  if (profiles.length >= MAX_PROFILES) throw new Error(`You can have up to ${MAX_PROFILES} profiles`);
  const name = cleanName(draft.name);
  if (!name) throw new Error('Enter a name');
  let id = createProfileId();
  while (id === DEFAULT_PROFILE_ID || profiles.some(item => item.id === id)) id = createProfileId();
  const profile: Profile = {id, name, emoji: draft.emoji || DEFAULT_PROFILE.emoji, color: draft.color || DEFAULT_PROFILE.color, kids: draft.kids, createdAt: now};
  writeProfiles([...profiles, profile]);
  return profile;
};

export const updateProfile = (id: string, draft: ProfileDraft): Profile => {
  const profiles = listProfiles();
  const index = profiles.findIndex(item => item.id === id);
  if (index === -1) throw new Error('This profile no longer exists');
  const name = cleanName(draft.name);
  if (!name) throw new Error('Enter a name');
  // Settings, and with it profile editing, is only reachable from a profile
  // that is not a kids profile.
  if (draft.kids && !profiles.some((item, i) => i !== index && !item.kids)) {
    throw new Error('Keep at least one profile that is not a kids profile');
  }
  const next = {...profiles[index], name, emoji: draft.emoji || profiles[index].emoji, color: draft.color || profiles[index].color, kids: draft.kids};
  writeProfiles(profiles.map((item, i) => (i === index ? next : item)));
  return next;
};

/**
 * Removes a profile from the list and its PIN. Its data is cleared by
 * deleteProfileData (profileData.ts). The last profile and the profile in
 * use cannot be removed.
 */
export const removeProfile = (id: string): Profile[] => {
  const profiles = listProfiles();
  if (!profiles.some(item => item.id === id)) return profiles;
  if (profiles.length <= 1) throw new Error('You cannot delete the last profile');
  if (id === getActiveProfileId()) throw new Error('Switch to another profile first');
  secureStore().removeItem(pinKey(id));
  secureStore().removeItem(attemptsKey(id));
  return writeProfiles(profiles.filter(item => item.id !== id));
};

// ---------------------------------------------------------------- PIN

export const readPinHash = (id: string): PinHash | undefined => {
  try {
    const parsed = JSON.parse(secureStore().getString(pinKey(id)) || 'null');
    return isPinHash(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const hasPin = (id: string): boolean => readPinHash(id) !== undefined;

export const setPin = (id: string, pin: string): void => {
  secureStore().setString(pinKey(id), JSON.stringify(hashPin(pin)));
  secureStore().removeItem(attemptsKey(id));
};

export const clearPin = (id: string): void => {
  secureStore().removeItem(pinKey(id));
  secureStore().removeItem(attemptsKey(id));
};

/** Saved hashes, for the backup file. */
export const writePinHash = (id: string, hash: PinHash): void => {
  secureStore().setString(pinKey(id), JSON.stringify(hash));
};

export const readPinAttempts = (id: string): PinAttempts => {
  try {
    const parsed = JSON.parse(secureStore().getString(attemptsKey(id)) || 'null');
    if (parsed && Number.isFinite(parsed.failures) && Number.isFinite(parsed.lockedUntil)) {
      return {failures: Math.max(0, parsed.failures), lockedUntil: Math.max(0, parsed.lockedUntil)};
    }
  } catch {}
  return NO_ATTEMPTS;
};

/** Checks a PIN and saves the wrong-try count, so a restart does not reset the wait. */
export const tryProfilePin = (id: string, pin: string, now = Date.now()): PinCheck => {
  const result = checkPin(pin, readPinHash(id), readPinAttempts(id), now);
  if (result.ok) secureStore().removeItem(attemptsKey(id));
  else secureStore().setString(attemptsKey(id), JSON.stringify(result.attempts));
  return result;
};

// ---------------------------------------------------------------- start

export const isAskOnStart = (): boolean => plainStore().getBool(PROFILES_ASK_ON_START_KEY) === true;
export const setAskOnStart = (value: boolean): void => {
  plainStore().setBool(PROFILES_ASK_ON_START_KEY, value);
};

/**
 * Whether the picker opens at start: with more than one profile or when the
 * user asked for it, and always when the profile in use has a PIN, except
 * right after the picker unlocked it and restarted the app.
 */
export const shouldShowPickerOnStart = (): boolean => {
  const store = plainStore();
  const unlocked = store.getString(PROFILES_UNLOCKED_KEY);
  if (unlocked) store.removeItem(PROFILES_UNLOCKED_KEY);
  const active = getActiveProfile();
  if (unlocked && unlocked === active.id) return false;
  return listProfiles().length > 1 || isAskOnStart() || hasPin(active.id);
};

/** Saves the profile for the next launch. The caller restarts the app (expo reloadAppAsync). */
export const prepareSwitch = (id: string): void => {
  if (!getProfile(id)) throw new Error('This profile no longer exists');
  saveActiveProfileId(id);
  plainStore().setString(PROFILES_UNLOCKED_KEY, id);
};

/**
 * What must be typed before switching from the profile in use to [target]:
 * the target's PIN when it has one, else, when leaving a kids profile, the
 * kids profile's own PIN when it has one.
 */
export const pinNeededToSwitch = (target: string, from: string = getActiveProfileId()): string | undefined => {
  if (hasPin(target)) return target;
  if (target === from) return undefined;
  const current = getProfile(from);
  return current?.kids && hasPin(from) ? from : undefined;
};
