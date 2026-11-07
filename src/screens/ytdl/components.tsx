import React from 'react';
import {Switch, View} from 'react-native';
import Chip from '../../components/torrentSearch/Chip';
import AppText from '../../components/ui/Text';
import {RawTextInput as TextInput} from '../../components/ui/Text';
import {useM3Colors} from '../../theme/M3PaletteContext';

export const Section = ({title, children, hint}: {title: string; hint?: string; children: React.ReactNode}) => {
  const colors = useM3Colors();
  return (
    <View
      style={{
        backgroundColor: colors.surfaceContainerLow,
        borderRadius: 24,
        padding: 16,
        marginBottom: 12,
      }}>
      <AppText role="titleSmall" style={{color: colors.onSurface, marginBottom: hint ? 2 : 10}}>
        {title}
      </AppText>
      {hint ? (
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginBottom: 10}}>
          {hint}
        </AppText>
      ) : null}
      {children}
    </View>
  );
};

export const ChipRow = ({children}: {children: React.ReactNode}) => (
  <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>{children}</View>
);

export function Choice<T extends string | number | null>({
  options,
  value,
  onChange,
}: {
  options: {value: T; label: string}[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <ChipRow>
      {options.map(option => (
        <Chip
          key={String(option.value)}
          label={option.label}
          selected={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </ChipRow>
  );
}

export const ToggleRow = ({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) => {
  const colors = useM3Colors();
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', minHeight: 48, opacity: disabled ? 0.5 : 1}}>
      <View style={{flex: 1, paddingRight: 12}}>
        <AppText role="bodyLarge" style={{color: colors.onSurface}}>{label}</AppText>
        {description ? (
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{description}</AppText>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{true: colors.primary, false: colors.surfaceContainerHighest}}
        thumbColor={value ? colors.onPrimary : colors.outline}
      />
    </View>
  );
};

export const Field = ({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'url' | 'numbers-and-punctuation';
}) => {
  const colors = useM3Colors();
  return (
    <View style={{flex: 1, minWidth: 120}}>
      <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginBottom: 4}}>{label}</AppText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.onSurfaceVariant}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={multiline}
        keyboardType={keyboardType}
        style={{
          color: colors.onSurface,
          backgroundColor: colors.surfaceContainerHighest,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 10,
          minHeight: 44,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
};

export const formatDuration = (seconds?: number | null): string => {
  if (!seconds || seconds <= 0) return '';
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
};
