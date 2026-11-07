import {useEffect, useMemo, useRef} from 'react';
import {AppState} from 'react-native';
import {
  findServerItem,
  flushServerProgressQueue,
  isServerProgressSyncEnabled,
  ServerProgressSession,
  serverItemKey,
} from '../sources/serverProgress';

/** How often the position is checked; the session reports every 10 seconds. */
const TICK_MS = 2000;

/**
 * Reports playback of an item from the viewer's Jellyfin, Emby or Plex
 * server back to that server: start, every 10 seconds, pause and resume,
 * played at 90%, and stop when the player closes or moves on. Does nothing
 * for other videos or with "Sync progress with my servers" off. Also sends
 * stops that were queued while offline.
 */
export const useServerProgress = (
  streamUrls: (string | undefined)[],
  paused: boolean,
  positionRef: {readonly current: {position: number; duration: number}},
): void => {
  const item = useMemo(() => (isServerProgressSyncEnabled() ? findServerItem(streamUrls) : undefined), [streamUrls]);
  const key = item ? `${item.kind}:${serverItemKey(item)}` : '';
  const itemRef = useRef(item);
  itemRef.current = item;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const tickRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    flushServerProgressQueue().catch(() => undefined);
    const current = itemRef.current;
    if (!key || !current) return;
    const session = new ServerProgressSession(current);
    const tick = () => {
      const {position, duration} = positionRef.current;
      // Only a move to the background counts as stopped; the state can read 'unknown' at launch.
      session.update(position, duration, !pausedRef.current && AppState.currentState !== 'background');
    };
    tickRef.current = tick;
    const timer = setInterval(tick, TICK_MS);
    const subscription = AppState.addEventListener('change', tick);
    return () => {
      clearInterval(timer);
      subscription.remove();
      tickRef.current = () => undefined;
      // Stops at the last position seen; the player may already show the next item.
      session.stop().catch(() => undefined);
    };
  }, [key, positionRef]);

  useEffect(() => {
    tickRef.current();
  }, [paused]);
};
