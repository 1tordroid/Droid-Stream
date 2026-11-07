import {useEffect, useRef} from 'react';
import {AppState} from 'react-native';
import type {WatchMeta} from '../watchMeta';
import {syncedKey} from '../watchSync';
import {flushScrobbleQueue, ScrobbleSession} from '../watchSync/scrobble';

/** How often the position is checked while a title plays. */
const TICK_MS = 5000;

/**
 * Scrobbles the title the player shows to Trakt: start while it plays, pause
 * when it pauses or the app leaves the foreground, stop when the player
 * closes or moves to another episode. Does nothing unless Trakt is connected
 * with scrobbling on. Also sends stops that were queued while offline.
 */
export const useScrobble = (
  meta: WatchMeta | undefined,
  paused: boolean,
  positionRef: {readonly current: {position: number; duration: number}},
): void => {
  const key = meta?.title ? syncedKey(meta) : '';
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const tickRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const current = metaRef.current;
    if (!key || !current) return;
    flushScrobbleQueue().catch(() => undefined);
    const session = new ScrobbleSession(current);
    const tick = () => {
      const {position, duration} = positionRef.current;
      session.update(position, duration, !pausedRef.current && AppState.currentState === 'active');
    };
    tickRef.current = tick;
    const timer = setInterval(tick, TICK_MS);
    const subscription = AppState.addEventListener('change', tick);
    return () => {
      clearInterval(timer);
      subscription.remove();
      tickRef.current = () => undefined;
      session.stop().catch(() => undefined);
    };
  }, [key, positionRef]);

  useEffect(() => {
    tickRef.current();
  }, [paused]);
};
