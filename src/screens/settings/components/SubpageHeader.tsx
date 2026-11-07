import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useNavigation} from '@react-navigation/native';
import React from 'react';
import {View} from 'react-native';
import {TVFocusable} from '../../../components/tv';
import AppText from '../../../components/ui/Text';
import {isTV} from '../../../lib/tv';
import {useM3Colors} from '../../../theme/M3PaletteContext';

/** Back button, title and one line under it, as on Player settings. */
const SubpageHeader = ({title, subtitle}: {title: string; subtitle?: string}) => {
  const colors = useM3Colors();
  const navigation = useNavigation();
  return (
    <View style={{marginBottom: 20}}>
      <View style={{alignItems: 'center', flexDirection: 'row'}}>
        <TVFocusable
          hasTVPreferredFocus={isTV}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={() => navigation.goBack()}
          borderRadius={22}
          style={{alignItems: 'center', height: 44, justifyContent: 'center', marginRight: 10, width: 44}}>
          <MaterialCommunityIcons name="arrow-left" size={28} color={colors.onBackground} />
        </TVFocusable>
        <AppText role="headlineLargeEmphasized" style={{color: colors.onBackground, flex: 1}} numberOfLines={1}>
          {title}
        </AppText>
      </View>
      {subtitle ? (
        <AppText role="bodyLarge" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
};

export default SubpageHeader;
