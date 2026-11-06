import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import {MMKVLoader} from 'react-native-mmkv-storage';
import {settingsStorage} from '../lib/storage';
import {useM3Colors} from '../theme/M3PaletteContext';
import AppText from './ui/Text';

const storage = new MMKVLoader().withInstanceID('droid-stream-ui').initialize();

const MoreOptions = ({
  id,
  title = 'More options',
  forceOpen = false,
  children,
}: {
  id: string;
  title?: string;
  forceOpen?: boolean;
  children: React.ReactNode;
}) => {
  const colors = useM3Colors();
  const [open, setOpen] = useState(() => forceOpen || storage.getBool(`more:${id}`) === true);
  const shown = open || forceOpen || settingsStorage.isAdvancedMode();
  return (
    <View style={{marginTop: 8}}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={() => {
          const next = !shown;
          storage.setBool(`more:${id}`, next);
          setOpen(next);
        }}
        style={{minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8}}>
        <AppText role="titleMedium" style={{color: colors.primary}}>{title}</AppText>
        <MaterialCommunityIcons name={shown ? 'chevron-up' : 'chevron-down'} size={24} color={colors.primary} />
      </Pressable>
      {shown ? <View>{children}</View> : null}
    </View>
  );
};

export default MoreOptions;
