/**
 * Subtitle sync: the delay remembered per title, the delay that lines up a
 * picked line, and the audio-based estimate behind Auto sync.
 *
 * Auto sync works like this (an approach in the spirit of ffsubsync, written
 * here from scratch): the speech band of a few minutes of audio is turned
 * into "speech / no speech" per 10 ms, and the subtitle lines are slid over
 * it. The shift where the lines cover the most speech and the least silence
 * is the delay.
 */
import {mainStorage} from '../storage/StorageService';
import {profileKey} from '../profiles/scope';
import type {SubtitleCue} from './cueParser';

/** Largest subtitle delay either way, in milliseconds. */
export const MAX_SUBTITLE_DELAY_MS = 120000;

export const clampSubtitleDelay = (delayMs: number): number =>
  Math.max(-MAX_SUBTITLE_DELAY_MS, Math.min(MAX_SUBTITLE_DELAY_MS, Math.round(delayMs / 10) * 10));

// Delay per title

const DELAYS_KEY = 'subtitle-delays';
const MAX_REMEMBERED = 300;

type DelayMap = Record<string, {ms: number; at: number}>;

const readDelays = (): DelayMap => {
  const value = mainStorage.getObject<DelayMap>(profileKey(DELAYS_KEY));
  return value && typeof value === 'object' ? value : {};
};

/** The delay last used for this title, or 0. */
export const readTitleSubtitleDelay = (titleKey: string | undefined): number => {
  if (!titleKey) return 0;
  const entry = readDelays()[titleKey];
  return entry && Number.isFinite(entry.ms) ? clampSubtitleDelay(entry.ms) : 0;
};

/** Keeps the delay for this title. Zero forgets it. The oldest titles drop out after 300. */
export const writeTitleSubtitleDelay = (titleKey: string | undefined, delayMs: number, now = Date.now()): void => {
  if (!titleKey) return;
  const delays = readDelays();
  if (!delayMs) {
    if (!(titleKey in delays)) return;
    delete delays[titleKey];
  } else {
    delays[titleKey] = {ms: clampSubtitleDelay(delayMs), at: now};
    const keys = Object.keys(delays);
    if (keys.length > MAX_REMEMBERED) {
      keys
        .sort((a, b) => delays[a].at - delays[b].at)
        .slice(0, keys.length - MAX_REMEMBERED)
        .forEach(key => delete delays[key]);
    }
  }
  mainStorage.setObject(profileKey(DELAYS_KEY), delays);
};

/**
 * The delay that shows [cue] at [heardAt] (seconds of video time): the line
 * the viewer hears now. A positive delay shows text later.
 */
export const delayForLine = (cue: SubtitleCue, heardAt: number): number => clampSubtitleDelay((heardAt - cue.start) * 1000);

// Auto sync

export const FRAME_MS = 10;

const percentile = (sorted: number[], fraction: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))))] : 0;

/**
 * Speech per 10 ms frame from speech-band levels in dB. The threshold sits
 * between the quiet floor and the loud end of this slice, so it adapts to
 * the mix. Gaps under 200 ms are bridged and bursts under 100 ms dropped.
 */
export const speechFromLevels = (levels: number[]): Uint8Array => {
  const speech = new Uint8Array(levels.length);
  if (!levels.length) return speech;
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = percentile(sorted, 0.2);
  const loud = percentile(sorted, 0.95);
  const threshold = floor + Math.max(6, (loud - floor) * 0.35);
  for (let index = 0; index < levels.length; index++) speech[index] = levels[index] > threshold ? 1 : 0;
  // Bridge short pauses inside speech.
  let lastSpeech = -1;
  for (let index = 0; index < speech.length; index++) {
    if (!speech[index]) continue;
    if (lastSpeech >= 0 && index - lastSpeech > 1 && index - lastSpeech <= 20) speech.fill(1, lastSpeech + 1, index);
    lastSpeech = index;
  }
  // Drop clicks and other very short bursts.
  let runStart = -1;
  for (let index = 0; index <= speech.length; index++) {
    const on = index < speech.length && speech[index] === 1;
    if (on && runStart < 0) runStart = index;
    if (!on && runStart >= 0) {
      if (index - runStart < 10) speech.fill(0, runStart, index);
      runStart = -1;
    }
  }
  return speech;
};

export interface SyncEstimate {
  /** Delay to set, in ms (positive shows text later). */
  delayMs: number;
  /** How clearly the best shift beats every other shift, 0 to 1. */
  confidence: number;
  /** Lines that fell in the listened slice. */
  linesUsed: number;
}

/**
 * The shift of [cues] (source times, seconds) that best matches [speech],
 * which starts at [sliceStart] seconds of video time. Shifts up to
 * [maxShiftSeconds] either way are tried in 10 ms steps. Each cue scores
 * +1 for every speech frame it covers and -1 for every silent one, read
 * from prefix sums so a cue costs the same at any length.
 */
export const estimateSubtitleDelay = (
  speech: Uint8Array,
  cues: SubtitleCue[],
  sliceStart: number,
  maxShiftSeconds = 30,
): SyncEstimate | undefined => {
  const frames = speech.length;
  if (frames < 100) return undefined;
  const sliceEnd = sliceStart + (frames * FRAME_MS) / 1000;
  const used = cues.filter(cue => cue.end > sliceStart - maxShiftSeconds && cue.start < sliceEnd + maxShiftSeconds);
  if (used.length < 3) return undefined;
  const prefix = new Int32Array(frames + 1);
  for (let index = 0; index < frames; index++) prefix[index + 1] = prefix[index] + (speech[index] ? 1 : -1);
  const framesPerSecond = 1000 / FRAME_MS;
  const starts = used.map(cue => Math.round((cue.start - sliceStart) * framesPerSecond));
  const ends = used.map(cue => Math.round((cue.end - sliceStart) * framesPerSecond));
  const maxShift = Math.round(maxShiftSeconds * framesPerSecond);
  const clip = (value: number) => (value < 0 ? 0 : value > frames ? frames : value);
  const scores = new Float64Array(maxShift * 2 + 1);
  let best = -Infinity;
  let bestShift = 0;
  for (let shift = -maxShift; shift <= maxShift; shift++) {
    let score = 0;
    for (let index = 0; index < starts.length; index++) {
      score += prefix[clip(ends[index] + shift)] - prefix[clip(starts[index] + shift)];
    }
    scores[shift + maxShift] = score;
    if (score > best) {
      best = score;
      bestShift = shift;
    }
  }
  // The best score more than a second away from the winner.
  let runnerUp = -Infinity;
  for (let shift = -maxShift; shift <= maxShift; shift++) {
    if (Math.abs(shift - bestShift) > framesPerSecond) runnerUp = Math.max(runnerUp, scores[shift + maxShift]);
  }
  const speechFrames = prefix[frames] + frames; // = 2 x speech frames
  const scale = Math.max(1, speechFrames / 2);
  const confidence = best <= 0 ? 0 : Math.max(0, Math.min(1, (best - Math.max(runnerUp, 0)) / scale));
  return {delayMs: clampSubtitleDelay(bestShift * FRAME_MS), confidence, linesUsed: used.length};
};

/** Below this, Auto sync asks the viewer to sync to a line instead. */
export const MIN_SYNC_CONFIDENCE = 0.04;
