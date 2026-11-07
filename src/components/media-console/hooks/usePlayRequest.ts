import {useEffect, useRef} from 'react';

/**
 * Starts playback each time `request` changes to a new number, for example
 * when the viewer taps Go live. The phone controls keep their own pause
 * state, so a pause made there would otherwise stay in force. The first
 * value only sets the starting point and plays nothing.
 */
export const usePlayRequest = (request: number | undefined, play: () => void): void => {
  const last = useRef(request);
  const playRef = useRef(play);
  playRef.current = play;
  useEffect(() => {
    if (request === undefined || request === last.current) return;
    last.current = request;
    playRef.current();
  }, [request]);
};
