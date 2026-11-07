/**
 * Calls [onIdle] once nothing happened for [delayMs]. poke() is activity and
 * starts the wait again; a delay of 0 or less turns it off.
 */
export interface IdleTimer {
  poke: () => void;
  /** Stops waiting until the next poke(). */
  stop: () => void;
  setDelay: (delayMs: number) => void;
  isWaiting: () => boolean;
}

export const createIdleTimer = (onIdle: () => void, initialDelayMs: number): IdleTimer => {
  let delayMs = initialDelayMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const poke = () => {
    clear();
    if (delayMs > 0) {
      timer = setTimeout(() => {
        timer = undefined;
        onIdle();
      }, delayMs);
    }
  };
  return {
    poke,
    stop: clear,
    setDelay: next => {
      delayMs = next;
      if (timer || next <= 0) poke();
    },
    isWaiting: () => timer !== undefined,
  };
};

export const minutesToMs = (minutes: number): number => (minutes > 0 ? minutes * 60 * 1000 : 0);

/** Screens that play video themselves: no screensaver over them. */
const PLAYBACK_ROUTES = new Set(['Player', 'MultiView', 'Browser', 'Webview', 'VlcPlayer']);

export const isPlaybackRoute = (name: string | undefined): boolean => Boolean(name) && PLAYBACK_ROUTES.has(name as string);
