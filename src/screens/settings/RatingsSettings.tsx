import React, {useState} from 'react';
import {ToastAndroid, View} from 'react-native';
import Button from '../../components/ui/Button';
import SettingsPage from '../../components/ui/SettingsPage';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import type {RatingId} from '../../lib/ratings/ratings';
import useRatingSettings from '../../lib/ratings/settings';
import {useM3Colors} from '../../theme/M3PaletteContext';
import SubpageHeader from './components/SubpageHeader';

const CHOICES: {id: RatingId; title: string; description: string}[] = [
  {id: 'imdb', title: 'IMDb', description: 'Score out of 10 and number of votes'},
  {id: 'rt', title: 'Rotten Tomatoes', description: 'Critics score'},
  {id: 'rtAudience', title: 'Rotten Tomatoes audience', description: 'Shown only when OMDb has it, which is rare'},
  {id: 'metacritic', title: 'Metacritic', description: 'Metascore out of 100'},
  {id: 'tmdb', title: 'TMDB', description: 'User score, shown when there is no IMDb score'},
];

/** Settings > Ratings: which scores title pages show, and an OMDb key. */
export default function RatingsSettings() {
  const colors = useM3Colors();
  const show = useRatingSettings(state => state.show);
  const setShown = useRatingSettings(state => state.setShown);
  const savedKey = useRatingSettings(state => state.omdbKey);
  const setOmdbKey = useRatingSettings(state => state.setOmdbKey);
  const [draft, setDraft] = useState(savedKey);

  const saveKey = (value: string) => {
    setOmdbKey(value);
    setDraft(value.trim());
    ToastAndroid.show(value.trim() ? 'OMDb key saved' : 'Using the shared key', ToastAndroid.SHORT);
  };

  return (
    <SettingsPage>
      <SubpageHeader title="Ratings" subtitle="Scores on title pages" />
      <SettingsSection title="Show on title pages">
        {CHOICES.map((choice, index) => (
          <SettingsSwitchRow
            key={choice.id}
            title={choice.title}
            description={choice.description}
            value={show[choice.id]}
            onValueChange={value => setShown(choice.id, value)}
            divider={index < CHOICES.length - 1}
          />
        ))}
      </SettingsSection>
      <SettingsSection title="OMDb key">
        <View style={{padding: 16}}>
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, lineHeight: 19}}>
            IMDb, Rotten Tomatoes and Metacritic scores come from OMDb. The app shares one free key with
            everyone, so it can run out for the day. Get your own free key at omdbapi.com and paste it here.
            Scores are kept for 7 days.
          </AppText>
          <TextInput
            accessibilityLabel="OMDb key"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => saveKey(draft)}
            placeholder="Paste your OMDb key"
            placeholderTextColor={colors.outline}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              borderBottomWidth: 1,
              borderColor: colors.outlineVariant,
              color: colors.onSurface,
              marginTop: 12,
              minHeight: 44,
            }}
          />
          <View style={{flexDirection: 'row', gap: 8, marginTop: 12}}>
            <Button compact disabled={draft.trim() === savedKey} onPress={() => saveKey(draft)}>
              Save
            </Button>
            {savedKey ? (
              <Button compact variant="tonal" onPress={() => saveKey('')}>
                Use shared key
              </Button>
            ) : null}
          </View>
        </View>
      </SettingsSection>
    </SettingsPage>
  );
}
