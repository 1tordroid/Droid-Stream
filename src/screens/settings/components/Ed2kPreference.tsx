import {useNavigation} from '@react-navigation/native';
import React, {useState} from 'react';
import SettingsRow from '../../../components/ui/SettingsRow';
import SettingsSwitchRow from '../../../components/ui/SettingsSwitchRow';
import {isEd2kSupported} from '../../../lib/ed2k/native';
import {isEd2kEnabled, setEd2kEnabled} from '../../../lib/ed2k/settings';

/** The eD2k switch for the Downloads settings, and a way into its screen. */
const Ed2kPreference = () => {
  const navigation = useNavigation<any>();
  const [enabled, setEnabled] = useState(isEd2kEnabled);
  if (!isEd2kSupported()) return null;
  return (
    <>
      <SettingsSwitchRow
        title="eD2k downloads"
        description="Download ed2k:// links from eMule servers and peers. Off by default."
        value={enabled}
        divider={enabled}
        onValueChange={next => {
          setEd2kEnabled(next);
          setEnabled(next);
        }}
      />
      {enabled ? (
        <SettingsRow
          title="eD2k search and servers"
          description="Paste a link, search, or manage servers"
          icon="lan-connect"
          divider={false}
          onPress={() => navigation.navigate('Ed2k')}
        />
      ) : null}
    </>
  );
};

export default Ed2kPreference;
