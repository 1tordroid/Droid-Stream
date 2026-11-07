/**
 * Automatic frame-rate matching: when a video starts, ask the display for a
 * refresh rate that fits the video's frame rate (24p film on a 24 Hz or 48 Hz
 * mode, 25p on 50 Hz), so motion does not judder. The display goes back to
 * its own mode when the player closes.
 */
import {mainStorage} from '../storage/StorageService';

export type FrameRateMatching = 'off' | 'seamless' | 'always';

const KEY = 'frameRateMatching';

/** Seamless switching is what the player did before this setting existed. */
export const DEFAULT_FRAME_RATE_MATCHING: FrameRateMatching = 'seamless';

export const normalizeFrameRateMatching = (value: unknown): FrameRateMatching =>
  value === 'off' || value === 'seamless' || value === 'always' ? value : DEFAULT_FRAME_RATE_MATCHING;

export const getFrameRateMatching = (): FrameRateMatching => normalizeFrameRateMatching(mainStorage.getString(KEY));

export const setFrameRateMatching = (mode: FrameRateMatching): void => {
  mainStorage.setString(KEY, normalizeFrameRateMatching(mode));
};

/** The native prop: 0 off, 1 only when seamless, 2 always (may blank briefly). */
export const frameRateMatchingNativeValue = (mode: FrameRateMatching): number =>
  mode === 'off' ? 0 : mode === 'always' ? 2 : 1;

export const FRAME_RATE_OPTIONS: {value: FrameRateMatching; label: string; description: string}[] = [
  {value: 'off', label: 'Off', description: 'The display keeps its refresh rate'},
  {value: 'seamless', label: 'On (seamless only)', description: 'Only when the display can switch without a blank screen'},
  {value: 'always', label: 'On (always)', description: 'The screen may go black for a moment when a video starts'},
];
