import React, {useRef, useState} from 'react';
import {ToastAndroid, View} from 'react-native';
import AppText, {RawTextInput as TextInput} from '../../../components/ui/Text';
import DropdownField from '../../../components/ui/DropdownField';
import SettingsSection from '../../../components/ui/SettingsSection';
import {LANGUAGES} from '../../../lib/languagePrefs';
import {
  readSecondSubtitleStyle,
  SECOND_SUBTITLE_COLORS,
  SECOND_SUBTITLE_SIZES,
  writeSecondSubtitleStyle,
  type SecondSubtitlePosition,
  type SecondSubtitleStyle,
} from '../../../lib/subtitles/dualSubtitles';
import {
  readTranslationKey,
  readTranslationSettings,
  TRANSLATION_SERVICE_NAMES,
  writeTranslationKey,
  writeTranslationSettings,
  type TranslationService,
  type TranslationSettings,
} from '../../../lib/subtitles/translation';
import {useM3Colors} from '../../../theme/M3PaletteContext';

type Option<T> = {value: T; label: string};

const POSITIONS: Option<SecondSubtitlePosition>[] = [
  {value: 'above', label: 'Above the main subtitle'},
  {value: 'top', label: 'Top of the screen'},
];

const SERVICES: Option<TranslationService>[] = (['off', 'libretranslate', 'deepl', 'google'] as const).map(value => ({
  value,
  label: TRANSLATION_SERVICE_NAMES[value],
}));

const TARGETS: Option<string>[] = [
  {value: '', label: 'My subtitle language'},
  ...LANGUAGES.map(language => ({value: language.code, label: language.name})),
];

const SERVICE_HELP: Record<TranslationService, string> = {
  off: 'Nothing is ever sent. Turn it on to translate subtitles in the player with your own service.',
  libretranslate: 'Your own or a public LibreTranslate server. Some servers need an API key.',
  deepl: 'Uses your DeepL API key (Free keys end in :fx).',
  google: 'Uses your Google Cloud Translation API key (Basic, v2).',
};

/** A titled dropdown row. */
function Choice<T extends string | number>({title, description, options, value, onChange}: {
  title: string;
  description?: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const colors = useM3Colors();
  return (
    <View className="px-4 py-3" style={{borderBottomColor: colors.outlineVariant, borderBottomWidth: 1}}>
      <AppText role="bodyLarge" style={{color: colors.onSurface}}>{title}</AppText>
      {description ? <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 3}}>{description}</AppText> : null}
      <View style={{width: '100%', minHeight: 56, marginTop: 12}}>
        <DropdownField
          placeholder={title}
          options={options}
          value={options.find(option => option.value === value)}
          getKey={option => String(option.value)}
          getLabel={option => option.label}
          onChange={option => onChange(option.value)}
        />
      </View>
    </View>
  );
}

function Field({label, value, secret, placeholder, onSave}: {
  label: string;
  value: string;
  secret?: boolean;
  placeholder: string;
  onSave: (value: string) => void;
}) {
  const colors = useM3Colors();
  const [draft, setDraft] = useState(value);
  const saved = useRef(value);
  const save = (text = draft) => {
    if (text.trim() === saved.current) return;
    saved.current = text.trim();
    onSave(text.trim());
    ToastAndroid.show(`${label} saved`, ToastAndroid.SHORT);
  };
  return (
    <View className="px-4 py-3" style={{borderBottomColor: colors.outlineVariant, borderBottomWidth: 1}}>
      <AppText role="bodyLarge" style={{color: colors.onSurface}}>{label}</AppText>
      <TextInput
        accessibilityLabel={label}
        value={draft}
        onChangeText={setDraft}
        onBlur={() => save()}
        onSubmitEditing={() => save()}
        onEndEditing={event => {
          const text = event?.nativeEvent?.text;
          if (typeof text === 'string') save(text);
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.outline}
        secureTextEntry={secret}
        autoCapitalize="none"
        autoCorrect={false}
        importantForAutofill="no"
        returnKeyType="done"
        style={{color: colors.onSurface, minHeight: 44, borderBottomWidth: 1, borderColor: colors.outlineVariant, marginTop: 4}}
      />
    </View>
  );
}

/** Settings > Subtitle style: the second subtitle's look and the translation service. */
export default function SubtitleExtrasPreference() {
  const colors = useM3Colors();
  const [style, setStyle] = useState<SecondSubtitleStyle>(readSecondSubtitleStyle);
  const [translation, setTranslation] = useState<TranslationSettings>(readTranslationSettings);
  const [keyVersion, setKeyVersion] = useState(0);
  const updateStyle = (patch: Partial<SecondSubtitleStyle>) => {
    const next = {...style, ...patch};
    writeSecondSubtitleStyle(next);
    setStyle(next);
  };
  const updateTranslation = (patch: Partial<TranslationSettings>) => {
    const next = {...translation, ...patch};
    writeTranslationSettings(next);
    setTranslation(next);
  };
  const service = translation.service;
  return (
    <>
      <SettingsSection title="Second subtitle">
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, paddingHorizontal: 16, paddingTop: 12}}>
          Dual subtitles: pick a second track in the player under Subtitles, Second subtitle.
        </AppText>
        <Choice
          title="Size"
          options={SECOND_SUBTITLE_SIZES.map(size => ({value: size, label: `${size}`}))}
          value={style.fontSize}
          onChange={fontSize => updateStyle({fontSize})}
        />
        <Choice
          title="Colour"
          options={SECOND_SUBTITLE_COLORS}
          value={style.color}
          onChange={color => updateStyle({color})}
        />
        <Choice
          title="Position"
          options={POSITIONS}
          value={style.position}
          onChange={position => updateStyle({position})}
        />
      </SettingsSection>

      <SettingsSection title="Translation">
        <Choice
          title="Translation service"
          description={SERVICE_HELP[service]}
          options={SERVICES}
          value={service}
          onChange={next => {
            updateTranslation({service: next});
            setKeyVersion(version => version + 1);
          }}
        />
        {service === 'libretranslate' ? (
          <Field
            key={`url-${keyVersion}`}
            label="Server address"
            value={translation.libreUrl}
            placeholder="https://libretranslate.example.org"
            onSave={libreUrl => updateTranslation({libreUrl})}
          />
        ) : null}
        {service !== 'off' ? (
          <Field
            key={`key-${service}-${keyVersion}`}
            label={service === 'libretranslate' ? 'API key (optional)' : 'API key'}
            value={readTranslationKey(service)}
            secret
            placeholder="Paste your API key"
            onSave={value => writeTranslationKey(service, value)}
          />
        ) : null}
        {service !== 'off' ? (
          <Choice
            title="Translate into"
            options={TARGETS}
            value={translation.target}
            onChange={target => updateTranslation({target})}
          />
        ) : null}
        {service !== 'off' ? (
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, padding: 16}}>
            Nothing is sent until you press Translate in the player. Then the lines of that subtitle go to {TRANSLATION_SERVICE_NAMES[service]}. Translated subtitles are kept on this device.
          </AppText>
        ) : null}
      </SettingsSection>
    </>
  );
}
