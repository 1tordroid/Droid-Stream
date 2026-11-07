import {useEffect, useRef} from 'react';
import {AppState} from 'react-native';
import type {WatchMeta} from '../watchMeta';
import {syncedKey} from '../watchSync';
import {flushAllScrobbleQueues, SCROBBLERS, ScrobbleSession} from '../watchSync/scrobble';

/** How often the position is checked while a title plays. */
const TICK_MS = 5000;

/**
 * Scrobbles the title the player shows to Trakt and Simkl: start while it
 * plays, pause when it pauses or the app leaves the foreground, stop when the
 * player closes or moves to another episode. Each service takes part only
 * while it is connected with scrobbling on. Also sends stops that were queued
 * while offline.
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
    flushAllScrobbleQueues().catch(() => undefined);
    const sessions = SCROBBLERS.filter(scrobbler => scrobbler.enabled()).map(scrobbler => new ScrobbleSession(current, scrobbler));
    if (!sessions.length) return;
    const tick = () => {
      const {position, duration} = positionRef.current;
      const playing = !pausedRef.current && AppState.currentState === 'active';
      sessions.forEach(session => session.update(position, duration, playing));
    };
    tickRef.current = tick;
    const timer = setInterval(tick, TICK_MS);
    const subscription = AppState.addEventListener('change', tick);
    return () => {
      clearInterval(timer);
      subscription.remove();
      tickRef.current = () => undefined;
      sessions.forEach(session => session.stop().catch(() => undefined));
    };
  }, [key, positionRef]);

  useEffect(() => {
    tickRef.current();
  }, [paused]);
};
