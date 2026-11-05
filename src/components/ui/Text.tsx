import React, {ComponentProps, ComponentPropsWithRef} from 'react';
import {StyleSheet, Text as NativeText, TextInput as NativeTextInput, TextProps} from 'react-native';
import {M3_TYPE, M3TypeRole} from '../../theme/typography';

const DEFAULT_FONT = {fontFamily: 'Inter_400Regular'};

// Android clips text drawn in a phone's own custom font, so every label uses the bundled one.
export const RawText = ({style, ...props}: ComponentProps<typeof NativeText>) => (
  <NativeText {...props} style={StyleSheet.flatten([DEFAULT_FONT, style])} />
);

export type RawTextInput = NativeTextInput;

export const RawTextInput = ({style, ...props}: ComponentPropsWithRef<typeof NativeTextInput>) => (
  <NativeTextInput {...props} style={StyleSheet.flatten([DEFAULT_FONT, style])} />
);

interface AppTextProps extends Omit<TextProps, 'role'> {
  role?: M3TypeRole;
}

const AppText = ({role = 'bodyMedium', style, ...props}: AppTextProps) => (
  <NativeText {...props} style={[M3_TYPE[role], style]} />
);

export default AppText;
