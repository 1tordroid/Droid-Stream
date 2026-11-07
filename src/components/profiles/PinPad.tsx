import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useCallback, useState} from 'react';
import {View} from 'react-native';
import {PIN_LENGTH} from '../../lib/profiles/pin';
import {isTV} from '../../lib/tv';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable} from '../tv';
import AppText from '../ui/Text';

type Key = string | 'back' | 'cancel';
const ROWS: Key[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['cancel', '0', 'back'],
];

export interface PinPadProps {
  title: string;
  message?: string;
  /** Called with 4 digits. Return an error to show and clear the dots, or nothing when done. */
  onComplete: (pin: string) => string | undefined | void;
  onCancel?: () => void;
}

/**
 * Number pad for a 4-digit PIN. Every key is a focusable button, so it works
 * with a TV remote's D-pad as well as touch.
 */
const PinPad = ({title, message, onComplete, onCancel}: PinPadProps) => {
  const colors = useM3Colors();
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string>();
  const size = isTV ? 64 : 72;

  const press = useCallback((key: Key) => {
    if (key === 'cancel') {
      onCancel?.();
      return;
    }
    setError(undefined);
    if (key === 'back') {
      setDigits(digits.slice(0, -1));
      return;
    }
    const next = digits.length < PIN_LENGTH ? digits + key : digits;
    if (next.length < PIN_LENGTH) {
      setDigits(next);
      return;
    }
    // The PIN is checked once, here; the dots clear for the next try.
    setDigits('');
    const result = onComplete(next);
    if (typeof result === 'string') setError(result);
  }, [digits, onCancel, onComplete]);

  return (
    <View style={{alignItems: 'center'}}>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onSurface, textAlign: 'center'}}>{title}</AppText>
      {message ? (
        <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, textAlign: 'center', marginTop: 6}}>{message}</AppText>
      ) : null}
      <View accessibilityLabel={`${digits.length} of ${PIN_LENGTH} digits entered`} style={{flexDirection: 'row', gap: 16, marginVertical: 20}}>
        {Array.from({length: PIN_LENGTH}, (_, index) => (
          <View
            key={index}
            style={{width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.primary,
              backgroundColor: index < digits.length ? colors.primary : 'transparent'}}
          />
        ))}
      </View>
      <AppText role="bodyMedium" style={{color: colors.error, minHeight: 22, textAlign: 'center', marginBottom: 8}}>{error || ''}</AppText>
      {ROWS.map((row, rowIndex) => (
        <View key={rowIndex} style={{flexDirection: 'row', gap: 16, marginBottom: 12}}>
          {row.map(key => {
            if (key === 'cancel' && !onCancel) return <View key={key} style={{width: size, height: size}} />;
            const label = key === 'back' ? 'Delete digit' : key === 'cancel' ? 'Cancel' : key;
            return (
              <TVFocusable
                key={key}
                testID={`pin-key-${key}`}
                accessibilityLabel={label}
                accessibilityRole="button"
                hasTVPreferredFocus={key === '1'}
                registerScreenFocus={false}
                borderRadius={size / 2}
                onPress={() => press(key)}
                style={{width: size, height: size, borderRadius: size / 2}}>
                {({focused}) => (
                  <View
                    style={{flex: 1, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: focused ? colors.primary : colors.surfaceContainerHigh}}>
                    {key === 'back' ? (
                      <MaterialCommunityIcons name="backspace-outline" size={24} color={focused ? colors.onPrimary : colors.onSurface} />
                    ) : key === 'cancel' ? (
                      <MaterialCommunityIcons name="close" size={24} color={focused ? colors.onPrimary : colors.onSurface} />
                    ) : (
                      <AppText role="headlineSmall" style={{color: focused ? colors.onPrimary : colors.onSurface}}>{key}</AppText>
                    )}
                  </View>
                )}
              </TVFocusable>
            );
          })}
        </View>
      ))}
    </View>
  );
};

export default PinPad;
