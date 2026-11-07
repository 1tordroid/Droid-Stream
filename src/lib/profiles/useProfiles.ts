import {create} from 'zustand';
import {
  getActiveProfile,
  hasPin,
  isAskOnStart,
  listProfiles,
  prepareSwitch,
  type Profile,
} from './profiles';
import {getActiveProfileId} from './scope';

export interface ProfileView extends Profile {
  locked: boolean;
}

interface ProfilesState {
  profiles: ProfileView[];
  activeId: string;
  /** The profile in use is a kids profile. Fixed for this launch. */
  kids: boolean;
  askOnStart: boolean;
  /** The profile picker is open (start, Home header, Settings). */
  pickerOpen: boolean;
  /** The picker was opened at start and cannot be closed without a pick. */
  pickerRequired: boolean;
  refresh: () => void;
  openPicker: (required?: boolean) => void;
  closePicker: () => void;
}

const read = () => ({
  profiles: listProfiles().map(profile => ({...profile, locked: hasPin(profile.id)})),
  activeId: getActiveProfileId(),
  askOnStart: isAskOnStart(),
});

const useProfilesStore = create<ProfilesState>(set => ({
  ...read(),
  kids: getActiveProfile().kids,
  pickerOpen: false,
  pickerRequired: false,
  refresh: () => set(read()),
  openPicker: (required = false) => set({...read(), pickerOpen: true, pickerRequired: required}),
  closePicker: () => set({pickerOpen: false, pickerRequired: false}),
}));

/** True in a kids profile. */
export const useIsKidsProfile = (): boolean => useProfilesStore(state => state.kids);

/**
 * Starts the app again as [id]. Every store reads the profile once at start,
 * so a restart is the one safe way to swap all of them.
 */
export const switchToProfile = async (id: string): Promise<void> => {
  prepareSwitch(id);
  const {reloadAppAsync} = require('expo') as typeof import('expo');
  await reloadAppAsync('Switch profile');
};

export default useProfilesStore;
