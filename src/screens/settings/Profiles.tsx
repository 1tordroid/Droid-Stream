import React, {useCallback, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {SettingsStackParamList} from '../../App';
import PinDialog, {type PinDialogRequest} from '../../components/profiles/PinDialog';
import SettingsPage from '../../components/ui/SettingsPage';
import SettingsRow from '../../components/ui/SettingsRow';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import {MAX_PROFILES, setAskOnStart} from '../../lib/profiles/profiles';
import useProfilesStore, {type ProfileView} from '../../lib/profiles/useProfiles';
import {isTV} from '../../lib/tv';

type Props = NativeStackScreenProps<SettingsStackParamList, 'Profiles'>;

const describe = (profile: ProfileView, activeId: string) =>
  [profile.id === activeId ? 'In use' : '', profile.kids ? 'Kids' : '', profile.locked ? 'PIN' : '']
    .filter(Boolean)
    .join(' · ') || 'No PIN';

const Profiles = ({navigation}: Props) => {
  const profiles = useProfilesStore(state => state.profiles);
  const activeId = useProfilesStore(state => state.activeId);
  const askOnStart = useProfilesStore(state => state.askOnStart);
  const refresh = useProfilesStore(state => state.refresh);
  const openPicker = useProfilesStore(state => state.openPicker);
  const [pin, setPin] = useState<PinDialogRequest>();

  useFocusEffect(useCallback(() => refresh(), [refresh]));

  const edit = (profile: ProfileView) => {
    const open = () => navigation.navigate('ProfileEdit', {id: profile.id});
    if (!profile.locked) {
      open();
      return;
    }
    setPin({kind: 'verify', profileId: profile.id, title: `Enter the PIN for ${profile.name}`, onDone: open});
  };

  return (
    <>
      <SettingsPage>
        <SettingsSection key="switch" title="Profile in use">
          <SettingsRow
            title="Switch profile"
            description="Pick who is watching"
            icon="account-switch-outline"
            hasTVPreferredFocus={isTV}
            onPress={() => openPicker()}
          />
          <SettingsSwitchRow
            title="Ask on start"
            description="Show the profile picker every time the app opens"
            value={askOnStart}
            onValueChange={value => {
              setAskOnStart(value);
              refresh();
            }}
          />
        </SettingsSection>
        <SettingsSection key="list" title="Profiles">
          {profiles.map(profile => (
            <SettingsRow
              key={profile.id}
              title={`${profile.emoji}  ${profile.name}`}
              description={describe(profile, activeId)}
              onPress={() => edit(profile)}
            />
          ))}
          {profiles.length < MAX_PROFILES ? (
            <SettingsRow
              key="add"
              title="Add profile"
              description="Each profile has its own library, history and sign-ins"
              icon="account-plus-outline"
              onPress={() => navigation.navigate('ProfileEdit', {})}
            />
          ) : null}
        </SettingsSection>
      </SettingsPage>
      <PinDialog request={pin} onClose={() => setPin(undefined)} />
    </>
  );
};

export default Profiles;
