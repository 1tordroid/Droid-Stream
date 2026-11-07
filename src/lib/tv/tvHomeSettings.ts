import {mainStorage} from '../storage/StorageService';

/** TV-only settings: the Play Next row on the TV home screen, the pause screen and the screensaver. */
const KEYS = {
  watchNext: 'tvWatchNext',
  pauseScreen: 'tvPauseScreenMinutes',
  screensaver: 'tvScreensaverMinutes',
} as const;

/** Minutes for the pause screen and the screensaver; 0 is Off. */
export const TV_IDLE_MINUTE_OPTIONS = [0, 1, 3, 5, 10] as const;
export const DEFAULT_PAUSE_SCREEN_MINUTES = 3;
export const DEFAULT_SCREENSAVER_MINUTES = 5;

export const idleMinutesLabel = (minutes: number): string =>
  minutes <= 0 ? 'Off' : minutes === 1 ? '1 minute' : `${minutes} minutes`;

const readMinutes = (key: string, fallback: number): number => {
  const value = mainStorage.getNumber(key);
  return typeof value === 'number' && (TV_IDLE_MINUTE_OPTIONS as readonly number[]).includes(value) ? value : fallback;
};

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

export const subscribeTvHomeSettings = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const tvHomeSettings = {
  /** Continue watching and next episodes in Play Next. On by default. */
  isWatchNextEnabled: (): boolean => mainStorage.getBool(KEYS.watchNext, true),
  setWatchNextEnabled: (value: boolean): void => {
    mainStorage.setBool(KEYS.watchNext, value);
    notify();
  },
  getPauseScreenMinutes: (): number => readMinutes(KEYS.pauseScreen, DEFAULT_PAUSE_SCREEN_MINUTES),
  setPauseScreenMinutes: (minutes: number): void => {
    mainStorage.setNumber(KEYS.pauseScreen, minutes);
    notify();
  },
  getScreensaverMinutes: (): number => readMinutes(KEYS.screensaver, DEFAULT_SCREENSAVER_MINUTES),
  setScreensaverMinutes: (minutes: number): void => {
    mainStorage.setNumber(KEYS.screensaver, minutes);
    notify();
  },
};
