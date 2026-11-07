import React from 'react';
import {View, type TextInputProps} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {TVFocusable} from '../../../components/tv';
import AppText, {RawTextInput as TextInput} from '../../../components/ui/Text';
import {isTV} from '../../../lib/tv';
import {useM3Colors} from '../../../theme/M3PaletteContext';

/** Back button and title, like the other settings pages. */
export const SyncHeader = ({title, subtitle, onBack, focusBack = isTV}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  focusBack?: boolean;
}) => {
  const colors = useM3Colors();
  return (
    <>
      <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 12}}>
        <TVFocusable
          hasTVPreferredFocus={focusBack}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={onBack}
          borderRadius={22}
          style={{alignItems: 'center', height: 44, justifyContent: 'center', marginRight: 10, width: 44}}>
          <MaterialCommunityIcons name="arrow-left" size={28} color={colors.onBackground} />
        </TVFocusable>
        <AppText role="headlineLargeEmphasized" className="text-m3-on-background" style={{flexShrink: 1}}>
          {title}
        </AppText>
      </View>
      {subtitle ? (
        <AppText role="bodyLarge" className="mb-6 mt-1 text-m3-on-surface-variant">
          {subtitle}
        </AppText>
      ) : null}
    </>
  );
};

/** A labelled text field that works with a D-pad and a phone keyboard. */
export const SyncField = ({label, ...props}: TextInputProps & {label: string}) => {
  const colors = useM3Colors();
  return (
    <View style={{marginBottom: 14}}>
      <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 4}}>
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.onSurfaceVariant}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        style={[
          {
            color: colors.onSurface,
            minHeight: 48,
            borderBottomWidth: 1,
            borderBottomColor: colors.outlineVariant,
            paddingHorizontal: 4,
          },
          props.style,
        ]}
      />
    </View>
  );
};

export const SyncNote = ({children, error}: {children: React.ReactNode; error?: boolean}) => {
  const colors = useM3Colors();
  return (
    <AppText role="bodyMedium" style={{color: error ? colors.error : colors.onSurfaceVariant, marginBottom: 12}}>
      {children}
    </AppText>
  );
};
