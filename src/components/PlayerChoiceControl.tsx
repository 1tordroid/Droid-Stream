import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import {RawText as Text} from './ui/Text';
import {useTVFocusBorderColor} from '../lib/tv/useTVFocusBorderColor';
import type {AudioEffectOption} from '../lib/player/audioEffects';

const TEXT = 'white';
const MUTED = 'rgba(255,255,255,0.55)';
const SURFACE = 'rgba(255,255,255,0.045)';
const BORDER = 'rgba(255,255,255,0.07)';
const BUTTON = 'rgba(255,255,255,0.1)';

type ChoiceButtonProps = {
  label: string;
  title: string;
  selected: boolean;
  disabled: boolean;
  accentColor: string;
  onPress: () => void;
  onTVFocus?: () => void;
};

// Styles are plain objects, not a style function: NativeWind drops the
// function form on Pressable.
const ChoiceButton = ({label, title, selected, disabled, accentColor, onPress, onTVFocus}: ChoiceButtonProps) => {
  const focusBorderColor = useTVFocusBorderColor(accentColor);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${title}: ${label}`}
      accessibilityState={{selected, disabled}}
      disabled={disabled}
      focusable={!disabled}
      isTVSelectable={!disabled}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onTVFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={{
        backgroundColor: selected ? accentColor : BUTTON,
        borderColor: focused ? focusBorderColor : 'transparent',
        borderRadius: 16,
        borderWidth: 2,
        marginLeft: 6,
        minWidth: 56,
        opacity: disabled ? 0.35 : 1,
        paddingHorizontal: 10,
        paddingVertical: 5,
      }}>
      <Text
        className="text-sm font-semibold"
        style={{color: selected ? 'black' : TEXT, textAlign: 'center'}}>
        {label}
      </Text>
    </Pressable>
  );
};

type PlayerChoiceControlProps<T extends string> = {
  title: string;
  /** Shown under the title. */
  hint: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  options: AudioEffectOption<T>[];
  value: T;
  accentColor: string;
  /** Replaces the hint and disables the choices, e.g. when the effect cannot apply. */
  unavailable?: string;
  onChange: (value: T) => void;
  onTVFocus?: () => void;
};

/**
 * A row like the delay control: the setting on the left, one button per
 * choice on the right. Every button is a separate TV focus stop, so the
 * D-pad moves between choices and OK picks one.
 */
const PlayerChoiceControl = <T extends string>({
  title,
  hint,
  icon,
  options,
  value,
  accentColor,
  unavailable,
  onChange,
  onTVFocus,
}: PlayerChoiceControlProps<T>) => {
  const active = !unavailable && value !== options[0]?.value;
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={title}
      className="mx-1 my-1 min-h-12 flex-row items-center rounded-xl px-3 py-2"
      style={{backgroundColor: SURFACE, borderColor: BORDER, borderWidth: 1}}>
      <MaterialIcons
        name={icon}
        size={21}
        color={active ? accentColor : MUTED}
        style={{marginRight: 12}}
      />
      <View className="min-w-0 flex-1">
        <Text className="text-base font-semibold" numberOfLines={1} style={{color: TEXT}}>
          {title}
        </Text>
        <Text className="mt-0.5 text-xs" numberOfLines={2} style={{color: MUTED}}>
          {unavailable || hint}
        </Text>
      </View>
      <View className="flex-row items-center">
        {options.map(option => (
          <ChoiceButton
            key={option.value}
            label={option.label}
            title={title}
            selected={option.value === value}
            disabled={Boolean(unavailable)}
            accentColor={accentColor}
            onPress={() => {
              if (option.value !== value) onChange(option.value);
            }}
            onTVFocus={onTVFocus}
          />
        ))}
      </View>
    </View>
  );
};

export default PlayerChoiceControl;
