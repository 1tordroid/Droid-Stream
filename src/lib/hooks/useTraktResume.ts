import {useMemo} from 'react';
import type {WatchMeta} from '../watchMeta';
import {traktResumePercent, traktResumeSeconds} from '../watchSync/traktProgress';

/**
 * Where Trakt says this title or episode was paused, in seconds, once the
 * video's length is known. 0 when Trakt has no position for it. The player
 * uses it only when this device has no progress of its own.
 */
export const useTraktResume = (meta: WatchMeta | undefined, durationSeconds: number): number => {
  const percent = useMemo(
    () => traktResumePercent(meta),
    // The match only depends on these.
    [meta?.title, meta?.type, meta?.year, meta?.imdbId, meta?.tmdbId, meta?.season, meta?.episode],
  );
  return traktResumeSeconds(percent, durationSeconds);
};
