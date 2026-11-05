import React, {useMemo, useState} from 'react';
import {ScrollView, Switch, TextInput, View} from 'react-native';
import Chip from '../../components/torrentSearch/Chip';
import AppText from '../../components/ui/Text';
import {
  LANGUAGES,
  languageNameFor,
  readLanguagePrefs,
  writeLanguagePrefs,
  type LanguagePrefs,
  type SubtitleMode,
} from '../../lib/languagePrefs';
import {useM3Colors} from '../../theme/M3PaletteContext';

type Slot = 'audioPrimary' | 'audioSecondary' | 'subtitlePrimary' | 'subtitleSecondary';

const SLOTS: {key: Slot; title: string; detail: string}[] = [
  {key: 'audioPrimary', title: 'Primary audio language', detail: 'Played first when a video has it'},
  {key: 'audioSecondary', title: 'Secondary audio language', detail: 'Used when the primary one is missing'},
  {key: 'subtitlePrimary', title: 'Primary subtitle language', detail: 'Shown first'},
  {key: 'subtitleSecondary', title: 'Secondary subtitle language', detail: 'Used when the primary one is missing'},
];

const MODES: {id: SubtitleMode; label: string; detail: string}[] = [
  {id: 'foreign', label: 'When needed', detail: 'Only when the audio is not in one of your audio languages (forced signs still show)'},
  {id: 'always', label: 'Always', detail: 'Whenever a subtitle in your languages exists'},
  {id: 'forced', label: 'Forced only', detail: 'Only signs and foreign-language parts'},
  {id: 'off', label: 'Off', detail: 'Start with subtitles off'},
];

const LanguageSettings = () => {
  const colors = useM3Colors();
  const [prefs, setPrefs] = useState<LanguagePrefs>(readLanguagePrefs);
  const [open, setOpen] = useState<Slot>();
  const [filter, setFilter] = useState('');

  const save = (next: LanguagePrefs) => {
    setPrefs(next);
    writeLanguagePrefs(next);
  };

  const list = useMemo(() => {
    const text = filter.trim().toLowerCase();
    return LANGUAGES.filter(language => !text || language.name.toLowerCase().includes(text) || language.aliases.some(alias => alias.includes(text)));
  }, [filter]);

  const toggle = (label: string, value: boolean, key: 'rememberLast' | 'autoDownloadSubtitles', detail: string) => (
    <View style={{flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 12}}>
      <View style={{flex: 1}}>
        <AppText role="bodyLarge" style={{color: colors.onSurface}}>{label}</AppText>
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{detail}</AppText>
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={next => save({...prefs, [key]: next})} thumbColor={value ? colors.primary : undefined} />
    </View>
  );

  return (
    <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={{padding: 16, paddingBottom: 96}} keyboardShouldPersistTaps="handled">
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Languages</AppText>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
        The player picks audio and subtitles in these languages when a video starts. You can still change them any time while playing, from the audio and subtitle buttons.
      </AppText>

      {SLOTS.map(slot => (
        <View key={slot.key} style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 12, marginTop: 12}}>
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <View style={{flex: 1}}>
              <AppText role="titleMedium" style={{color: colors.onSurface}}>{slot.title}</AppText>
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{slot.detail}</AppText>
            </View>
            <Chip label={prefs[slot.key] ? languageNameFor(prefs[slot.key]) : 'Not set'} selected={open === slot.key} onPress={() => { setOpen(open === slot.key ? undefined : slot.key); setFilter(''); }} />
          </View>
          {open === slot.key ? (
            <View style={{marginTop: 8}}>
              <TextInput accessibilityLabel="Find a language" value={filter} onChangeText={setFilter} placeholder="Find a language" placeholderTextColor={colors.outline}
                style={{color: colors.onSurface, minHeight: 44, borderBottomWidth: 1, borderColor: colors.outlineVariant, marginBottom: 8}} />
              <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
                <Chip label="None" selected={!prefs[slot.key]} onPress={() => { save({...prefs, [slot.key]: ''}); setOpen(undefined); }} />
                {list.map(language => (
                  <Chip key={language.code} label={language.name} selected={prefs[slot.key] === language.code} onPress={() => { save({...prefs, [slot.key]: language.code}); setOpen(undefined); }} />
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ))}

      <AppText role="titleMedium" style={{color: colors.primary, marginTop: 20, marginBottom: 8}}>When to show subtitles</AppText>
      <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 4}}>
        {MODES.map(mode => (
          <View key={mode.id} style={{flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 12}}>
            <View style={{flex: 1}}>
              <AppText role="bodyLarge" style={{color: colors.onSurface}}>{mode.label}</AppText>
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{mode.detail}</AppText>
            </View>
            <Chip label={prefs.subtitleMode === mode.id ? 'On' : 'Use'} selected={prefs.subtitleMode === mode.id} onPress={() => save({...prefs, subtitleMode: mode.id})} />
          </View>
        ))}
      </View>

      <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, paddingVertical: 4, marginTop: 12}}>
        {toggle('Download missing subtitles', prefs.autoDownloadSubtitles, 'autoDownloadSubtitles', 'When a video has none in your languages, fetch one matched to the file (OpenSubtitles)')}
        {toggle('Remember my last choice', prefs.rememberLast, 'rememberLast', 'Use the language you picked while playing when none of the above match')}
      </View>
    </ScrollView>
  );
};

export default LanguageSettings;
