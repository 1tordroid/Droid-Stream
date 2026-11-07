import {openStore} from '../storage/openStore';
import type {SocialQuality} from './select';

const storage = openStore('droid-stream-social');
const KEY = 'settings';

export interface SocialSettings {
  quality: SocialQuality;
  photosOnly: boolean;
  /** Latest posts to read from a profile. */
  profileLimit: number;
  /** Pause between profile pages, in ms, so the site does not limit the account. */
  profileDelayMs: number;
  /** Seconds per photo in a "photo with song" slideshow. */
  secondsPerImage: number;
  crossfade: boolean;
}

export const DEFAULT_SOCIAL_SETTINGS: SocialSettings = {
  quality: 'original',
  photosOnly: false,
  profileLimit: 24,
  profileDelayMs: 2500,
  secondsPerImage: 3,
  crossfade: true,
};

export const PROFILE_LIMITS = [12, 24, 50, 100, 200];

export const readSocialSettings = (): SocialSettings => {
  try {
    const stored = JSON.parse(storage.getString(KEY) || '{}');
    return {...DEFAULT_SOCIAL_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {})};
  } catch {
    return {...DEFAULT_SOCIAL_SETTINGS};
  }
};

export const updateSocialSettings = (patch: Partial<SocialSettings>): SocialSettings => {
  const next = {...readSocialSettings(), ...patch};
  storage.setString(KEY, JSON.stringify(next));
  return next;
};
