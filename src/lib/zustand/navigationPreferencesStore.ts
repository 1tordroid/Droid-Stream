import {create} from 'zustand';
import {settingsStorage} from '../storage';

interface NavigationPreferencesState {
  showContinueWatching: boolean;
  setShowContinueWatching: (show: boolean) => void;
  hideWatched: boolean;
  setHideWatched: (hide: boolean) => void;
}

const useNavigationPreferencesStore = create<NavigationPreferencesState>(
  set => ({
    showContinueWatching: settingsStorage.showContinueWatching(),
    setShowContinueWatching: show => {
      settingsStorage.setShowContinueWatching(show);
      set({showContinueWatching: show});
    },
    hideWatched: settingsStorage.hideWatched(),
    setHideWatched: hide => {
      settingsStorage.setHideWatched(hide);
      set({hideWatched: hide});
    },
  }),
);

export default useNavigationPreferencesStore;
