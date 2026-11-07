/**
 * Keeps the Play Next row on the Android TV home screen in line with
 * Continue watching of the profile in use. Does nothing on phones.
 */
import {AppState} from 'react-native';
import {collectContinueWatchingItems} from '../../player/continueWatchingItems';
import {getNetlibHistorySnapshot, subscribeNetlibHistory} from '../../netlib/history';
import {isKidsProfileActive} from '../../profiles/profiles';
import {getActiveProfileId} from '../../profiles/scope';
import {openStore} from '../../storage/openStore';
import {watchProgressStorage} from '../../storage';
import useContinueWatchingStore from '../../zustand/continueWatchingStore';
import useLocalContentStore from '../../zustand/localContentStore';
import {isAndroidTV} from '../constants';
import {subscribeTvHomeSettings, tvHomeSettings} from '../tvHomeSettings';
import {
  applyWatchNext,
  listWatchNext,
  subscribeWatchNextDismissed,
  takeDismissedWatchNext,
  watchNextSupported,
} from './native';
import {buildWatchNextEntries, type WatchNextState} from './plan';
import {createWatchNextSyncer, type WatchNextSyncer} from './syncer';

const STATE_KEY = 'state';
let store: ReturnType<typeof openStore> | undefined;
const stateStore = () => (store ||= openStore('droid-stream-watch-next'));

let syncer: WatchNextSyncer | undefined;

const readEntries = () => {
  if (!tvHomeSettings.isWatchNextEnabled()) return [];
  const items = collectContinueWatchingItems({
    stored: useContinueWatchingStore.getState().items,
    localTitles: useLocalContentStore.getState().titles,
    netlibHistory: getNetlibHistorySnapshot(),
  });
  return buildWatchNextEntries(items, {profileId: getActiveProfileId(), kids: isKidsProfileActive()});
};

const whenHydrated = (persisted: {persist?: {hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void}}) =>
  new Promise<void>(resolve => {
    if (!persisted.persist || persisted.persist.hasHydrated()) resolve();
    else {
      const unsubscribe = persisted.persist.onFinishHydration(() => {
        unsubscribe();
        resolve();
      });
    }
  });

/** Writes the latest positions soon, without waiting for the throttle (leaving the player). */
export const flushWatchNext = (): void => syncer?.schedule(true);

/** Starts the sync. Returns the stop function. */
export const startWatchNextSync = (): (() => void) => {
  if (!isAndroidTV || syncer || !watchNextSupported()) return () => {};
  const current = createWatchNextSyncer({
    backend: {list: listWatchNext, apply: applyWatchNext, takeDismissed: takeDismissedWatchNext},
    readEntries,
    loadState: () => {
      try {
        const raw = stateStore().getString(STATE_KEY);
        const parsed = raw ? (JSON.parse(raw) as WatchNextState) : undefined;
        return parsed && typeof parsed.published === 'object' && typeof parsed.dismissed === 'object' ? parsed : undefined;
      } catch {
        return undefined;
      }
    },
    saveState: state => stateStore().setString(STATE_KEY, JSON.stringify(state)),
  });
  syncer = current;
  const schedule = () => current.schedule();
  const unsubscribers = [
    useContinueWatchingStore.subscribe(schedule),
    useLocalContentStore.subscribe(schedule),
    subscribeNetlibHistory(schedule),
    watchProgressStorage.subscribe(schedule),
    subscribeTvHomeSettings(() => current.schedule(true)),
    subscribeWatchNextDismissed(() => {
      current.dismissed().catch(() => undefined);
    }),
  ];
  const appState = AppState.addEventListener('change', next => {
    if (next !== 'active') current.schedule(true);
  });
  // An empty list before the stores load would clear the row.
  Promise.all([whenHydrated(useContinueWatchingStore), whenHydrated(useLocalContentStore)])
    .then(() => current.start())
    .catch(error => console.warn('Play Next sync failed:', error));
  return () => {
    unsubscribers.forEach(unsubscribe => unsubscribe());
    appState.remove();
    current.stop();
    if (syncer === current) syncer = undefined;
  };
};
