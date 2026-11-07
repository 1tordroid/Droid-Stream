import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import {View} from 'react-native';
import {UNBLOCK_MODE_OPTIONS} from '../../lib/unblock/unblockService';
import type {UnblockMode} from '../../lib/unblock/routing';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable} from '../tv';
import AppText from '../ui/Text';

interface Props {
  value: UnblockMode;
  onChange: (mode: UnblockMode) => void;
  disabled?: boolean;
  /** Dialogs keep TV focus to themselves. */
  registerScreenFocus?: boolean;
  hasTVPreferredFocus?: boolean;
}

/** The four Smart unblock choices, as radio rows. */
const UnblockModeChoices = ({value, onChange, disabled, registerScreenFocus, hasTVPreferredFocus}: Props) => {
  const colors = useM3Colors();
  return (
    <View accessibilityRole="radiogroup">
      {UNBLOCK_MODE_OPTIONS.map(option => {
        const selected = option.value === value;
        return (
          <TVFocusable
            key={option.value}
            registerScreenFocus={registerScreenFocus}
            hasTVPreferredFocus={hasTVPreferredFocus && selected}
            accessibilityRole="radio"
            accessibilityState={{checked: selected, disabled: Boolean(disabled)}}
            accessibilityLabel={`${option.label}. ${option.description}`}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            focusScale={1.02}
            borderRadius={12}
            style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12}}>
            <MaterialCommunityIcons
              name={selected ? 'radiobox-marked' : 'radiobox-blank'}
              size={22}
              color={selected ? colors.primary : colors.onSurfaceVariant}
            />
            <View style={{flex: 1, marginLeft: 12}}>
              <AppText role="bodyLarge" style={{color: colors.onSurface}}>
                {option.label}
              </AppText>
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
                {option.description}
              </AppText>
            </View>
          </TVFocusable>
        );
      })}
    </View>
  );
};

export default UnblockModeChoices;
