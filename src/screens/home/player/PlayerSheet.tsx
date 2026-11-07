import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import {Image, Modal, ScrollView, View} from 'react-native';
import {TVFocusable, TVFocusGuide} from '../../../components/tv';
import {RawText as Text} from '../../../components/ui/Text';

/** The dark centred sheet the player's smaller menus use (like Mark intro and credits). */
export default function PlayerSheet({
  title,
  subtitle,
  color,
  width = 480,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  color: string;
  width?: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 16}}>
        <TVFocusGuide
          trapFocusLeft
          trapFocusRight
          trapFocusUp
          trapFocusDown
          style={{width: '92%', maxWidth: width, maxHeight: '92%', padding: 14, backgroundColor: '#171717', borderRadius: 20}}>
          <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: subtitle ? 2 : 10}}>
            <Text numberOfLines={1} style={{color: 'white', fontSize: 16, fontWeight: '600', flex: 1}}>
              {title}
            </Text>
            <TVFocusable
              registerScreenFocus={false}
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              focusBorderColor={color}
              borderRadius={22}
              style={{width: 44, height: 44, borderRadius: 22, backgroundColor: '#292929', alignItems: 'center', justifyContent: 'center'}}>
              <MaterialCommunityIcons name="close" size={22} color="#ddd" />
            </TVFocusable>
          </View>
          {subtitle ? <Text style={{color: '#aaa', fontSize: 12, marginBottom: 10}}>{subtitle}</Text> : null}
          <ScrollView style={{flexShrink: 1}} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </TVFocusGuide>
      </View>
    </Modal>
  );
}

export const SHEET_ROW_STYLE = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 12,
  padding: 10,
  minHeight: 44,
  marginBottom: 8,
  borderRadius: 16,
  backgroundColor: '#252525',
  borderWidth: 1,
  borderColor: '#333',
};

/** One row of a sheet: icon or image, a title and a detail line. */
export function SheetRow({
  icon,
  image,
  title,
  detail,
  selected,
  disabled,
  color,
  preferred,
  onPress,
}: {
  icon?: string;
  image?: string;
  title: string;
  detail?: string;
  selected?: boolean;
  disabled?: boolean;
  color: string;
  preferred?: boolean;
  onPress?: () => void;
}) {
  return (
    <TVFocusable
      registerScreenFocus={false}
      hasTVPreferredFocus={preferred}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      accessibilityState={{selected: Boolean(selected), disabled: Boolean(disabled)}}
      focusBorderColor={color}
      borderRadius={16}
      onPress={onPress}
      style={[SHEET_ROW_STYLE, selected ? {borderColor: color} : null, disabled ? {opacity: 0.5} : null]}>
      {image ? (
        <Image source={{uri: image}} style={{width: 72, height: 40, borderRadius: 8, backgroundColor: '#323232'}} resizeMode="cover" />
      ) : icon ? (
        <View style={{width: 40, height: 40, borderRadius: 12, backgroundColor: '#323232', alignItems: 'center', justifyContent: 'center'}}>
          <MaterialCommunityIcons name={icon as any} size={22} color={selected ? color : '#eee'} />
        </View>
      ) : null}
      <View style={{flex: 1}}>
        <Text numberOfLines={2} style={{color: selected ? color : '#eee', fontSize: 14}}>
          {title}
        </Text>
        {detail ? (
          <Text numberOfLines={2} style={{color: '#aaa', fontSize: 12}}>
            {detail}
          </Text>
        ) : null}
      </View>
      {selected ? <MaterialCommunityIcons name="check-circle" size={20} color={color} /> : null}
    </TVFocusable>
  );
}

/** A heading between groups of rows. */
export function SheetHeading({children}: {children: string}) {
  return <Text style={{color: '#bbb', fontSize: 12, fontWeight: '600', marginTop: 6, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6}}>{children}</Text>;
}

/** Plain explanation text inside a sheet. */
export function SheetNote({children}: {children: React.ReactNode}) {
  return <Text style={{color: '#aaa', fontSize: 12, marginBottom: 10}}>{children}</Text>;
}
