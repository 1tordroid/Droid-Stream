import {create} from 'zustand';
import {settingsStorage} from '../storage';

interface NavigationPreferencesState {
  showContinueWatching: boolean;
  setShowContinueWatching: (show: boolean) => void;
}

const useNavigationPreferencesStore = create<NavigationPreferencesState>(
  set => ({
    showContinueWatching: settingsStorage.showContinueWatching(),
    setShowContinueWatching: show => {
      settingsStorage.setShowContinueWatching(show);
      set({showContinueWatching: show});
    },
  }),
);

export default useNavigationPreferencesStore;
