import {useMemo} from 'react';
import {isWatched} from './player/upNext';
import useContinueWatchingStore, {
  type ContinueWatchingItem,
} from './zustand/continueWatchingStore';

export interface TitleWatchState {
  /** Share of the current movie or episode played, 0 to 1. */
  progress?: number;
  /** A movie played past the watched mark. Shows move on to the next episode instead. */
  watched: boolean;
}

export const watchStateFromItem = (
  item: ContinueWatchingItem | undefined,
): TitleWatchState | undefined => {
  if (!item || !(item.duration > 0) || !Number.isFinite(item.position)) {
    return undefined;
  }
  const progress = Math.max(0, Math.min(1, item.position / item.duration));
  const watched = item.type === 'movie' && isWatched(item.position, item.duration);
  if (!watched && progress <= 0) {
    return undefined;
  }
  return {progress, watched};
};

/** Watch state per info link, built from the Continue watching store. */
export const buildWatchStateMap = (
  items: ContinueWatchingItem[],
): Map<string, TitleWatchState> => {
  const map = new Map<string, TitleWatchState>();
  for (const item of items) {
    const state = watchStateFromItem(item);
    if (state && item.infoUrl) {
      map.set(item.infoUrl, state);
    }
  }
  return map;
};

export const useWatchStateMap = (): Map<string, TitleWatchState> => {
  const items = useContinueWatchingStore(state => state.items);
  return useMemo(() => buildWatchStateMap(items), [items]);
};

/** Leaves out watched titles when [hide] is on. */
export const withoutWatched = <T>(
  items: T[],
  states: Map<string, TitleWatchState>,
  hide: boolean,
  linkOf: (item: T) => string | undefined,
): T[] => {
  if (!hide || states.size === 0) {
    return items;
  }
  return items.filter(item => {
    const link = linkOf(item);
    return !link || !states.get(link)?.watched;
  });
};
