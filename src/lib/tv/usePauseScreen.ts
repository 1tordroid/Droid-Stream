import {useCallback, useEffect, useRef, useState} from 'react';
import {isTV} from './constants';
import {createIdleTimer, minutesToMs, type IdleTimer} from './idleTimer';
import {useTVRemote} from './useTVRemote';

/**
 * TV pause screen: visible once playback has been paused for [minutes]
 * without a key press. 0 minutes turns it off. Playing again hides it;
 * after dismiss() it comes back after another wait if still paused.
 */
export const usePauseScreen = ({
  paused,
  minutes,
  enabled = isTV,
}: {
  paused: boolean;
  minutes: number;
  enabled?: boolean;
}) => {
  const [visible, setVisible] = useState(false);
  const active = enabled && minutes > 0;
  const timerRef = useRef<IdleTimer | null>(null);
  if (!timerRef.current) timerRef.current = createIdleTimer(() => setVisible(true), minutesToMs(minutes));
  const state = useRef({paused, visible, active});
  state.current = {paused, visible, active};

  useEffect(() => {
    const timer = timerRef.current!;
    timer.setDelay(active ? minutesToMs(minutes) : 0);
    if (active && paused) {
      timer.poke();
    } else {
      timer.stop();
      setVisible(false);
    }
  }, [active, minutes, paused]);

  useEffect(() => () => timerRef.current?.stop(), []);

  // Using the remote while paused (menus, seeking) starts the wait again.
  useTVRemote(
    useCallback(() => {
      const {paused: isPaused, visible: shown, active: on} = state.current;
      if (on && isPaused && !shown) timerRef.current?.poke();
    }, []),
    active,
  );

  const dismiss = useCallback(() => {
    setVisible(false);
    if (state.current.active && state.current.paused) timerRef.current?.poke();
  }, []);

  return {visible: active && paused && visible, dismiss};
};
