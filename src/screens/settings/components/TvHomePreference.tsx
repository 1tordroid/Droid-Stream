import React, {useState} from 'react';
import {View} from 'react-native';
import AppText from '../../../components/ui/Text';
import DropdownField from '../../../components/ui/DropdownField';
import SettingsSection from '../../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../../components/ui/SettingsSwitchRow';
import {idleMinutesLabel, TV_IDLE_MINUTE_OPTIONS, tvHomeSettings} from '../../../lib/tv/tvHomeSettings';
import {useM3Colors} from '../../../theme/M3PaletteContext';

const MinutesRow = ({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description: string;
  value: number;
  onChange: (minutes: number) => void;
}) => {
  const colors = useM3Colors();
  return (
    <View className="px-4 py-3" style={{borderBottomColor: colors.outlineVariant, borderBottomWidth: 1}}>
      <AppText role="bodyLarge" style={{color: colors.onSurface}}>{title}</AppText>
      <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 3}}>{description}</AppText>
      <View style={{width: '100%', minHeight: 56, marginTop: 12}}>
        <DropdownField
          placeholder={title}
          options={TV_IDLE_MINUTE_OPTIONS}
          value={value}
          getKey={option => String(option)}
          getLabel={idleMinutesLabel}
          onChange={onChange}
        />
      </View>
    </View>
  );
};

/** Android TV only: Play Next on the TV home screen, the pause screen and the screensaver. */
const TvHomePreference = () => {
  const [watchNext, setWatchNext] = useState(() => tvHomeSettings.isWatchNextEnabled());
  const [pauseMinutes, setPauseMinutes] = useState(() => tvHomeSettings.getPauseScreenMinutes());
  const [saverMinutes, setSaverMinutes] = useState(() => tvHomeSettings.getScreensaverMinutes());
  return (
    <SettingsSection title="TV">
      <SettingsSwitchRow
        title="Show on the TV home screen"
        description="Continue watching and next episodes in Play Next"
        value={watchNext}
        onValueChange={next => {
          tvHomeSettings.setWatchNextEnabled(next);
          setWatchNext(next);
        }}
      />
      <MinutesRow
        title="Pause screen"
        description="When a video is paused this long, show its artwork and the clock"
        value={pauseMinutes}
        onChange={next => {
          tvHomeSettings.setPauseScreenMinutes(next);
          setPauseMinutes(next);
        }}
      />
      <MinutesRow
        title="Screensaver"
        description="When the app is idle this long, show artwork from your library and the clock"
        value={saverMinutes}
        onChange={next => {
          tvHomeSettings.setScreensaverMinutes(next);
          setSaverMinutes(next);
        }}
      />
    </SettingsSection>
  );
};

export default TvHomePreference;
