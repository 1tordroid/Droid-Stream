import {DeviceEventEmitter, NativeModules, Platform} from 'react-native';
import type {WatchNextEntry} from './plan';

/** Kotlin side: TvHomeModule.kt. Missing on iOS and in tests. */
interface TvHomeNative {
  isWatchNextSupported?: () => boolean;
  listWatchNext: () => Promise<{key: string; browsable: boolean}[]>;
  applyWatchNext: (upserts: WatchNextEntry[], removes: string[]) => Promise<{failed: string[]}>;
  takeDismissedWatchNext: () => Promise<{key: string; at: number}[]>;
  setScreenOnWhilePlaying: (playing: boolean) => void;
}

const native = (): TvHomeNative | undefined =>
  Platform.OS === 'android' ? (NativeModules.VegaTvHome as TvHomeNative | undefined) : undefined;

/** True on a TV whose home screen has Play Next (the TV provider is there). */
export const watchNextSupported = (): boolean => {
  try {
    return native()?.isWatchNextSupported?.() === true;
  } catch {
    return false;
  }
};

export const listWatchNext = async () => (await native()?.listWatchNext()) ?? [];

export const applyWatchNext = async (upserts: WatchNextEntry[], removes: string[]) =>
  (await native()?.applyWatchNext(upserts, removes)) ?? {failed: [...upserts.map(entry => entry.key), ...removes]};

export const takeDismissedWatchNext = async () => (await native()?.takeDismissedWatchNext()) ?? [];

/** Sent by the native receiver when the user removes a program from the TV home. */
export const WATCH_NEXT_DISMISSED_EVENT = 'VegaWatchNextDismissed';

export const subscribeWatchNextDismissed = (listener: () => void): (() => void) => {
  const subscription = DeviceEventEmitter.addListener(WATCH_NEXT_DISMISSED_EVENT, listener);
  return () => subscription.remove();
};

/**
 * Keeps the screen on only while a video plays, so the system screensaver can
 * start while one is paused.
 */
export const setScreenOnWhilePlaying = (playing: boolean): void => {
  try {
    native()?.setScreenOnWhilePlaying(playing);
  } catch {}
};
