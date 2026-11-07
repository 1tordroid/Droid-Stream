import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import {View, type HostInstance} from 'react-native';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable} from '../tv';
import AppText from '../ui/Text';

const Chip = React.forwardRef<HostInstance, {
  label: string;
  selected?: boolean;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  tone?: 'default' | 'good' | 'warn';
  /** A number shown after the label, such as how many items the choice has. */
  count?: number;
}>(function ChipView({label, selected, icon, onPress, onLongPress, accessibilityLabel, tone = 'default', count}, ref) {
  const colors = useM3Colors();
  const background = selected
    ? colors.secondaryContainer
    : tone === 'good'
      ? colors.tertiaryContainer
      : tone === 'warn'
        ? colors.errorContainer
        : colors.surfaceContainerHigh;
  const foreground = selected
    ? colors.onSecondaryContainer
    : tone === 'good'
      ? colors.onTertiaryContainer
      : tone === 'warn'
        ? colors.onErrorContainer
        : colors.onSurfaceVariant;
  const body = (
    <>
      {icon ? <MaterialCommunityIcons name={icon} size={16} color={foreground} style={{marginRight: 6}} /> : null}
      <AppText role="labelLarge" numberOfLines={1} style={{color: foreground}}>{label}</AppText>
      {count !== undefined ? (
        <AppText role="labelMedium" numberOfLines={1} style={{color: foreground, opacity: 0.75, marginLeft: 6}}>{count}</AppText>
      ) : null}
    </>
  );
  const style = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    minHeight: onPress ? 40 : 28,
    paddingHorizontal: onPress ? 14 : 10,
    borderRadius: onPress ? 12 : 8,
    backgroundColor: background,
    borderWidth: selected ? 0 : onPress ? 1 : 0,
    borderColor: colors.outlineVariant,
  };
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <TVFocusable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || (count !== undefined ? `${label}, ${count}` : label)}
      accessibilityState={{selected}}
      onPress={onPress}
      onLongPress={onLongPress}
      style={style}>
      {body}
    </TVFocusable>
  );
});

export default Chip;
