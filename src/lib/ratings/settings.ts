/**
 * Which ratings the title page shows, and an optional OMDb key of your own.
 * Shared by every profile, like the other app settings.
 */
import {create} from 'zustand';
import {mainStorage} from '../storage/StorageService';
import {DEFAULT_RATING_PREFS, RATING_IDS, type RatingId, type RatingPrefs} from './ratings';

export const RATING_SETTINGS_KEY = 'titleRatings';

export interface RatingSettings {
  show: RatingPrefs;
  /** Empty: the app's shared key. */
  omdbKey: string;
  /** When the OMDb key last changed. Failed lookups before it are tried again. */
  omdbKeyChangedAt: number;
}

export const readRatingSettings = (): RatingSettings => {
  let saved: Partial<RatingSettings> = {};
  try {
    saved = JSON.parse(mainStorage.getString(RATING_SETTINGS_KEY) || '{}') || {};
  } catch {}
  const show = {...DEFAULT_RATING_PREFS};
  for (const id of RATING_IDS) {
    if (typeof saved.show?.[id] === 'boolean') show[id] = saved.show[id];
  }
  return {
    show,
    omdbKey: typeof saved.omdbKey === 'string' ? saved.omdbKey.trim() : '',
    omdbKeyChangedAt: typeof saved.omdbKeyChangedAt === 'number' ? saved.omdbKeyChangedAt : 0,
  };
};

const writeRatingSettings = (settings: RatingSettings) =>
  mainStorage.setString(RATING_SETTINGS_KEY, JSON.stringify(settings));

interface RatingSettingsState extends RatingSettings {
  setShown: (id: RatingId, shown: boolean) => void;
  setOmdbKey: (key: string) => void;
}

const useRatingSettings = create<RatingSettingsState>((set, get) => {
  const save = (next: RatingSettings) => {
    writeRatingSettings(next);
    set(next);
  };
  const current = (): RatingSettings => {
    const {show, omdbKey, omdbKeyChangedAt} = get();
    return {show, omdbKey, omdbKeyChangedAt};
  };
  return {
    ...readRatingSettings(),
    setShown: (id, shown) => save({...current(), show: {...get().show, [id]: shown}}),
    setOmdbKey: key => save({...current(), omdbKey: key.trim(), omdbKeyChangedAt: Date.now()}),
  };
});

export default useRatingSettings;
