import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import {Modal, Pressable, ScrollView, Switch, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {TVFocusable} from '../../components/tv';
import AppText from '../../components/ui/Text';
import {isTV} from '../../lib/tv';
import {useM3Colors} from '../../theme/M3PaletteContext';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** A bottom sheet for the browser's menus and lists. D-pad friendly: every row is focusable. */
export const Sheet = ({
  visible,
  onClose,
  title,
  children,
  scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  scroll?: boolean;
}) => {
  const colors = useM3Colors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{flex: 1, justifyContent: 'flex-end'}}>
        <Pressable accessibilityLabel="Close" onPress={onClose} focusable={false} style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)'}} />
        <View
          style={{
            backgroundColor: colors.surfaceContainer,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            maxHeight: '85%',
            paddingTop: 8,
            paddingBottom: insets.bottom + 8,
            alignSelf: isTV ? 'center' : 'stretch',
            width: isTV ? 640 : undefined,
          }}>
          <View style={{alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: colors.outlineVariant, marginBottom: 8}} />
          {title ? (
            <AppText role="titleMedium" style={{color: colors.onSurface, paddingHorizontal: 20, paddingVertical: 8}} numberOfLines={2}>
              {title}
            </AppText>
          ) : null}
          {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView> : children}
        </View>
      </View>
    </Modal>
  );
};

export const SheetRow = ({
  icon,
  label,
  detail,
  onPress,
  onLongPress,
  toggle,
  right,
  disabled,
  danger,
  preferredFocus,
}: {
  icon?: IconName;
  label: string;
  detail?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Shows a switch with this value. */
  toggle?: boolean;
  right?: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  preferredFocus?: boolean;
}) => {
  const colors = useM3Colors();
  const color = danger ? colors.error : colors.onSurface;
  return (
    <TVFocusable
      onPress={disabled ? undefined : onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hasTVPreferredFocus={preferredFocus}
      accessibilityLabel={label}
      accessibilityRole={toggle === undefined ? 'button' : 'switch'}
      accessibilityState={toggle === undefined ? undefined : {checked: toggle}}
      borderRadius={16}
      focusScale={1.02}
      style={{flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 20, paddingVertical: 8, opacity: disabled ? 0.5 : 1}}>
      {icon ? <MaterialCommunityIcons name={icon} size={22} color={danger ? colors.error : colors.onSurfaceVariant} style={{marginRight: 16}} /> : null}
      <View style={{flex: 1}}>
        <AppText role="bodyLarge" style={{color}} numberOfLines={2}>
          {label}
        </AppText>
        {detail ? (
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}} numberOfLines={2}>
            {detail}
          </AppText>
        ) : null}
      </View>
      {toggle !== undefined ? (
        <Switch
          value={toggle}
          onValueChange={() => onPress?.()}
          focusable={false}
          trackColor={{true: colors.primary, false: colors.surfaceContainerHighest}}
          thumbColor={toggle ? colors.onPrimary : colors.outline}
        />
      ) : null}
      {right}
    </TVFocusable>
  );
};

export const SheetNote = ({children}: {children: React.ReactNode}) => {
  const colors = useM3Colors();
  return (
    <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, paddingHorizontal: 20, paddingVertical: 6}}>
      {children}
    </AppText>
  );
};
