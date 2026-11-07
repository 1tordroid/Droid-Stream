import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, {useEffect, useRef, useState} from 'react';
import {Pressable, View} from 'react-native';
import {RawText as Text} from './ui/Text';
import {useTVFocusBorderColor} from '../lib/tv/useTVFocusBorderColor';

/** Largest delay either way, in milliseconds. */
export const MAX_PLAYER_DELAY_MS = 10000;

/** Colors for the control. The default suits the dark player overlay. */
export type PlayerDelayPalette = {
  text: string;
  muted: string;
  surface: string;
  border: string;
  button: string;
  buttonPressed: string;
};

const PLAYER_PALETTE: PlayerDelayPalette = {
  text: 'white',
  muted: 'rgba(255,255,255,0.55)',
  surface: 'rgba(255,255,255,0.045)',
  border: 'rgba(255,255,255,0.07)',
  button: 'rgba(255,255,255,0.1)',
  buttonPressed: 'rgba(255,255,255,0.22)',
};

const STEP_MS = 50;
// Holding a button repeats the step, faster the longer it is held.
const REPEAT_INTERVAL_MS = 110;

export const formatDelay = (delayMs: number) =>
  `${delayMs > 0 ? '+' : ''}${(delayMs / 1000).toFixed(2)}s`;

type RoundButtonProps = {
  icon: keyof typeof MaterialIcons.glyphMap;
  /** Short text shown instead of the icon, e.g. "+1s". */
  label?: string;
  accessibilityLabel: string;
  accentColor: string;
  palette: PlayerDelayPalette;
  disabled?: boolean;
  /** Disabled, out of the focus order and invisible, but still laid out. */
  hidden?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onPressOut?: () => void;
  onTVFocus?: () => void;
};

// Styles are plain objects, not a style function: NativeWind drops the
// function form on Pressable.
const RoundButton = ({
  icon,
  label,
  accessibilityLabel,
  accentColor,
  palette,
  disabled,
  hidden,
  onPress,
  onLongPress,
  onPressOut,
  onTVFocus,
}: RoundButtonProps) => {
  const focusBorderColor = useTVFocusBorderColor(accentColor);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const isDisabled = disabled || hidden;
  // A hidden button that still has TV focus stays focusable until focus moves
  // away, otherwise Android drops focus and nothing takes it.
  const canFocus = !hidden || focused;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{disabled: isDisabled}}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      disabled={isDisabled}
      focusable={canFocus}
      isTVSelectable={canFocus}
      delayLongPress={350}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => {
        setPressed(false);
        onPressOut?.();
      }}
      onFocus={() => {
        setFocused(true);
        onTVFocus?.();
      }}
      onBlur={() => {
        setFocused(false);
        onPressOut?.();
      }}
      style={{
        alignItems: 'center',
        backgroundColor: pressed ? palette.buttonPressed : palette.button,
        borderColor: focused ? focusBorderColor : 'transparent',
        borderRadius: 19,
        borderWidth: 2,
        height: 38,
        justifyContent: 'center',
        opacity: hidden && !focused ? 0 : isDisabled ? 0.35 : 1,
        width: label ? 46 : 38,
      }}>
      {label ? (
        <Text style={{color: palette.text, fontSize: 13, fontWeight: '700'}}>{label}</Text>
      ) : (
        <MaterialIcons name={icon} size={20} color={palette.text} />
      )}
    </Pressable>
  );
};

type PlayerDelayControlProps = {
  title: string;
  /** What a positive value does, e.g. "Text shows later". */
  laterLabel: string;
  /** What a negative value does, e.g. "Text shows earlier". */
  earlierLabel: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  delayMs: number;
  accentColor: string;
  onChange: (delayMs: number) => void;
  onTVFocus?: () => void;
  palette?: PlayerDelayPalette;
  /** One press of minus or plus. Default 0.05 s. */
  stepMs?: number;
  /** Adds bigger -/+ buttons with this step (e.g. 1000 for one second). */
  coarseStepMs?: number;
  /** Largest value either way. Default 10 s. */
  maxMs?: number;
};

/**
 * One row like the track rows: the setting and its effect on the left, a
 * minus/plus stepper on the right. Each press moves 0.05s (or stepMs) and
 * holding repeats; coarseStepMs adds bigger steps on both sides.
 * The reset button shows while the value is not zero. It stays mounted at
 * zero so a focused reset keeps TV focus after it is pressed.
 */
const PlayerDelayControl = ({
  title,
  laterLabel,
  earlierLabel,
  icon,
  delayMs,
  accentColor,
  onChange,
  onTVFocus,
  palette = PLAYER_PALETTE,
  stepMs = STEP_MS,
  coarseStepMs,
  maxMs = MAX_PLAYER_DELAY_MS,
}: PlayerDelayControlProps) => {
  const clamp = (value: number) => Math.max(-maxMs, Math.min(maxMs, value));
  const seconds = (ms: number) => `${ms / 1000} seconds`;
  const valueRef = useRef(delayMs);
  valueRef.current = delayMs;
  const repeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopRepeat = () => {
    if (repeatRef.current) {
      clearInterval(repeatRef.current);
      repeatRef.current = null;
    }
  };
  useEffect(() => stopRepeat, []);

  const step = (direction: 1 | -1, amount = stepMs) => {
    const next = clamp(valueRef.current + direction * amount);
    valueRef.current = next;
    onChange(next);
  };

  const startRepeat = (direction: 1 | -1) => {
    stopRepeat();
    let count = 0;
    repeatRef.current = setInterval(() => {
      count++;
      step(direction, count > 20 ? Math.max(250, stepMs) : count > 8 ? Math.max(100, stepMs) : stepMs);
    }, REPEAT_INTERVAL_MS);
  };

  const effect =
    delayMs === 0 ? 'In sync' : delayMs > 0 ? laterLabel : earlierLabel;

  return (
    <View
      className="mx-1 my-1 min-h-12 flex-row items-center rounded-xl px-3 py-2"
      style={{
        backgroundColor: palette.surface,
        borderColor: palette.border,
        borderWidth: 1,
      }}>
      <MaterialIcons
        name={icon}
        size={21}
        color={delayMs === 0 ? palette.muted : accentColor}
        style={{marginRight: 12}}
      />
      <View className="min-w-0 flex-1">
        <Text
          className="text-base font-semibold"
          numberOfLines={1}
          style={{color: palette.text}}>
          {title}
        </Text>
        <Text
          className="mt-0.5 text-xs"
          numberOfLines={1}
          style={{color: palette.muted}}>
          {effect}
        </Text>
      </View>
      <View className="flex-row items-center">
        <View style={{marginRight: 6}}>
          <RoundButton
            icon="restart-alt"
            accessibilityLabel={`Reset ${title.toLowerCase()}`}
            accentColor={accentColor}
            palette={palette}
            hidden={delayMs === 0}
            onPress={() => onChange(0)}
            onTVFocus={onTVFocus}
          />
        </View>
        {coarseStepMs ? (
          <View style={{marginRight: 6}}>
            <RoundButton
              icon="remove"
              label={`-${coarseStepMs / 1000}s`}
              accessibilityLabel={`${title}: ${seconds(coarseStepMs)} earlier`}
              accentColor={accentColor}
              palette={palette}
              disabled={delayMs <= -maxMs}
              onPress={() => step(-1, coarseStepMs)}
              onTVFocus={onTVFocus}
            />
          </View>
        ) : null}
        <RoundButton
          icon="remove"
          accessibilityLabel={`${title}: ${seconds(stepMs)} earlier`}
          accentColor={accentColor}
          palette={palette}
          disabled={delayMs <= -maxMs}
          onPress={() => step(-1)}
          onLongPress={() => startRepeat(-1)}
          onPressOut={stopRepeat}
          onTVFocus={onTVFocus}
        />
        <Text
          accessibilityLabel={`${title} ${formatDelay(delayMs)}`}
          className="text-base font-bold"
          style={{
            color: delayMs === 0 ? palette.text : accentColor,
            fontVariant: ['tabular-nums'],
            minWidth: 72,
            textAlign: 'center',
          }}>
          {formatDelay(delayMs)}
        </Text>
        <RoundButton
          icon="add"
          accessibilityLabel={`${title}: ${seconds(stepMs)} later`}
          accentColor={accentColor}
          palette={palette}
          disabled={delayMs >= maxMs}
          onPress={() => step(1)}
          onLongPress={() => startRepeat(1)}
          onPressOut={stopRepeat}
          onTVFocus={onTVFocus}
        />
        {coarseStepMs ? (
          <View style={{marginLeft: 6}}>
            <RoundButton
              icon="add"
              label={`+${coarseStepMs / 1000}s`}
              accessibilityLabel={`${title}: ${seconds(coarseStepMs)} later`}
              accentColor={accentColor}
              palette={palette}
              disabled={delayMs >= maxMs}
              onPress={() => step(1, coarseStepMs)}
              onTVFocus={onTVFocus}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
};

export default PlayerDelayControl;
