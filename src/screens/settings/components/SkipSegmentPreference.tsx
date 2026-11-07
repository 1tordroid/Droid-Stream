import React, {useState} from 'react';
import {View} from 'react-native';
import DropdownField from '../../../components/ui/DropdownField';
import SettingsSection from '../../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../../components/ui/SettingsSwitchRow';
import AppText from '../../../components/ui/Text';
import {getSkipModes, isIntroDbEnabled, setIntroDbEnabled, setSkipMode} from '../../../lib/playback/skipSources';
import {SEGMENT_KINDS, type SegmentKind, type SkipMode} from '../../../lib/playback/skipSegmentModel';
import {useM3Colors} from '../../../theme/M3PaletteContext';

const MODES: {mode: SkipMode; label: string}[] = [
  {mode: 'off', label: 'Off'},
  {mode: 'button', label: 'Show button'},
  {mode: 'auto', label: 'Auto skip'},
];

const TITLES: Record<SegmentKind, string> = {
  intro: 'Intro',
  recap: 'Recap',
  credits: 'Credits and outro',
  preview: 'Preview',
};

/** Off, Show button or Auto skip for each kind of segment. */
const SkipSegmentPreference = () => {
  const colors = useM3Colors();
  const [modes, setModes] = useState(getSkipModes);
  const [introDb, setIntroDb] = useState(isIntroDbEnabled);
  return (
    <SettingsSection title="Skip intro and credits">
      <AppText role="bodySmall" className="px-4 pt-3" style={{color: colors.onSurfaceVariant}}>
        Times come from the provider, your Jellyfin server, AniSkip, IntroDB, or your own marks. Mark them in the player menu.
      </AppText>
      {SEGMENT_KINDS.map(kind => (
        <View key={kind} className="px-4 py-3" style={{borderBottomColor: colors.outlineVariant, borderBottomWidth: 1}}>
          <AppText role="bodyLarge" style={{color: colors.onSurface}}>
            {TITLES[kind]}
          </AppText>
          <View style={{width: '100%', minHeight: 56, marginTop: 12}}>
            <DropdownField
              placeholder={TITLES[kind]}
              options={MODES}
              value={MODES.find(option => option.mode === modes[kind])}
              getKey={option => option.mode}
              getLabel={option => option.label}
              onChange={option => {
                setSkipMode(kind, option.mode);
                setModes(previous => ({...previous, [kind]: option.mode}));
              }}
            />
          </View>
        </View>
      ))}
      <SettingsSwitchRow
        title="IntroDB times"
        description="Look up times on introdb.app for shows with an IMDb id"
        value={introDb}
        divider={false}
        onValueChange={next => {
          setIntroDbEnabled(next);
          setIntroDb(next);
        }}
      />
    </SettingsSection>
  );
};

export default SkipSegmentPreference;
