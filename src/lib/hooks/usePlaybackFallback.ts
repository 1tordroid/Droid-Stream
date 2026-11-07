import {MutableRefObject, useCallback, useEffect, useRef, useState} from 'react';
import {AppState, ToastAndroid} from 'react-native';
import type {Stream} from '../providers/types';
import {isTorrentStream} from '../torrentStream';
import {
  fallbackReducer,
  initialFallbackState,
  nextSourceMessage,
  type FallbackEvent,
  type FallbackState,
} from '../streams/fallback';
import {forgetFailure, rememberFailure} from '../streams/failedSources';
import {resolveCandidateStream, type PlayBestPlan} from '../streams/play';

const TICK_MS = 1000;
/** Times the player may put back a source that already failed before the fallback gives up control. */
const MAX_REAPPLY = 2;

interface Options {
  /** route.params.playBest: present only when Play best started this player. */
  plan?: PlayBestPlan;
  selectedStream: Stream;
  setSelectedStream: (stream: Stream) => void;
  videoPositionRef: MutableRefObject<{position: number}>;
  paused?: boolean;
}

/**
 * Play best fallback for the player. While a Play best list is active it
 * watches the current source: an error, no first frame in time, or buffering
 * that never gets going at the start moves to the next source in the list
 * with a short toast. The resume position carries over through the player's
 * usual stream switch. Picking a source by hand hands control back.
 *
 * - handleLoad: call from the video onLoad.
 * - handleError: call on a playback error; true when the fallback took it.
 * - exhausted: every source failed; show the error with "Choose source".
 */
export const usePlaybackFallback = ({plan, selectedStream, setSelectedStream, videoPositionRef, paused}: Options) => {
  const usable = Boolean(plan && plan.candidates.length > 1);
  const stateRef = useRef<FallbackState>(
    usable
      ? initialFallbackState(plan!.candidates.length, plan!.index, Date.now(), isTorrentStream(selectedStream))
      : initialFallbackState(0),
  );
  const currentStreamRef = useRef<Stream>(selectedStream);
  const failedLinksRef = useRef(new Set<string>());
  const reappliedRef = useRef(0);
  const mountedRef = useRef(true);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [exhausted, setExhausted] = useState(false);
  const planRef = useRef(plan);
  planRef.current = plan;
  const setSelectedStreamRef = useRef(setSelectedStream);
  setSelectedStreamRef.current = setSelectedStream;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const dispatch = useCallback((event: FallbackEvent): void => {
    const active = planRef.current;
    if (!active) return;
    const before = stateRef.current;
    const {state, action} = fallbackReducer(before, event, active.timeouts);
    stateRef.current = state;
    const candidate = active.candidates[before.index];
    if (state.phase === 'playing' && before.phase !== 'playing' && candidate) {
      forgetFailure(active.want, candidate.id);
    }
    if (action === 'none') return;
    if (candidate) rememberFailure(active.want, candidate.id);
    if (currentStreamRef.current.link) failedLinksRef.current.add(currentStreamRef.current.link);
    if (action === 'exhausted') {
      setExhausted(true);
      return;
    }
    const nextIndex = before.index + 1;
    stateRef.current = {...stateRef.current, index: nextIndex};
    ToastAndroid.show(nextSourceMessage(nextIndex, active.candidates.length), ToastAndroid.SHORT);
    resolveCandidateStream(active.candidates[nextIndex], active.want)
      .then(stream => {
        if (!mountedRef.current || stateRef.current.phase !== 'switching' || stateRef.current.index !== nextIndex) return;
        currentStreamRef.current = stream;
        reappliedRef.current = 0;
        dispatch({type: 'start', now: Date.now(), index: nextIndex, torrent: isTorrentStream(stream)});
        setSelectedStreamRef.current(stream);
      })
      .catch(() => {
        if (!mountedRef.current || stateRef.current.index !== nextIndex) return;
        dispatch({type: 'resolveFailed', now: Date.now()});
      });
  }, []);

  // Timeouts: polled once a second while the current source is starting.
  useEffect(() => {
    if (!usable) return;
    const timer = setInterval(() => {
      const phase = stateRef.current.phase;
      if (phase !== 'starting' && phase !== 'loaded') return;
      // The app in the background is not a dead link.
      if (AppState.currentState === 'background') {
        stateRef.current = {...stateRef.current, since: Date.now(), lastMovedAt: Date.now()};
        return;
      }
      dispatch({type: 'tick', now: Date.now(), position: videoPositionRef.current.position, paused: pausedRef.current});
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [usable, dispatch, videoPositionRef]);

  // Another source was selected: a revert to a failed one is undone, anything else was the user's choice.
  useEffect(() => {
    if (!usable) return;
    const phase = stateRef.current.phase;
    if (phase === 'off' || phase === 'exhausted') return;
    const link = selectedStream?.link;
    if (!link || link === currentStreamRef.current.link) return;
    if (failedLinksRef.current.has(link) && reappliedRef.current < MAX_REAPPLY && phase !== 'switching') {
      reappliedRef.current += 1;
      setSelectedStreamRef.current(currentStreamRef.current);
      return;
    }
    if (phase === 'switching' && failedLinksRef.current.has(link)) return;
    dispatch({type: 'userPicked', now: Date.now()});
  }, [selectedStream?.link, usable, dispatch]);

  const handleLoad = useCallback(() => {
    dispatch({type: 'load', now: Date.now()});
  }, [dispatch]);

  const handleError = useCallback((): boolean => {
    const phase = stateRef.current.phase;
    if (!usable || phase === 'off') return false;
    if (phase === 'exhausted') return true;
    dispatch({type: 'error', now: Date.now()});
    return true;
  }, [usable, dispatch]);

  return {active: usable, exhausted, handleLoad, handleError};
};
