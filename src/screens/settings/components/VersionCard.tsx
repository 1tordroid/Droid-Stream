import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Constants from 'expo-constants';
import React, {useState} from 'react';
import {Image, View} from 'react-native';
import LoadingIndicator from '../../../components/ui/LoadingIndicator';
import AppText from '../../../components/ui/Text';
import {TVFocusable} from '../../../components/tv';
import {versionLabel} from '../../../lib/appVersion';
import {settingsStorage} from '../../../lib/storage';
import {checkForUpdate} from '../../../lib/updates/checkForUpdate';
import {useM3Colors} from '../../../theme/M3PaletteContext';

/** The installed version, named by edition, with a manual update check. */
const VersionCard = () => {
  const colors = useM3Colors();
  const [checking, setChecking] = useState(false);
  const playStore = Boolean(Constants.expoConfig?.extra?.isPlayStore);
  const label = versionLabel();

  return (
    <View
      style={{
        alignItems: 'center',
        backgroundColor: colors.surfaceContainer,
        borderRadius: 24,
        flexDirection: 'row',
        marginBottom: 24,
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}>
      <Image
        source={require('../../../../assets/brand/logo.png')}
        accessibilityIgnoresInvertColors
        resizeMode="contain"
        style={{height: 40, marginRight: 14, width: 40}}
      />
      <View style={{flex: 1, marginRight: 12}}>
        <AppText role="titleMedium" style={{color: colors.onSurface}} accessibilityLabel={`Version: ${label}`}>
          {label}
        </AppText>
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 2}}>
          {playStore ? 'Updates come from Google Play' : 'Updates come from GitHub releases'}
        </AppText>
      </View>
      {playStore ? null : (
        <TVFocusable
          disabled={checking}
          onPress={() => checkForUpdate(setChecking, settingsStorage.isAutoDownloadEnabled(), true)}
          accessibilityRole="button"
          accessibilityLabel="Check for updates"
          accessibilityState={{busy: checking, disabled: checking}}
          borderRadius={20}
          style={{backgroundColor: colors.secondaryContainer, borderRadius: 20}}>
          <View style={{alignItems: 'center', flexDirection: 'row', minHeight: 40, paddingHorizontal: 14}}>
            {checking ? (
              <LoadingIndicator size={16} color={colors.onSecondaryContainer} />
            ) : (
              <MaterialCommunityIcons name="update" size={18} color={colors.onSecondaryContainer} />
            )}
            <AppText role="labelLarge" style={{color: colors.onSecondaryContainer, marginLeft: 8}}>
              {checking ? 'Checking' : 'Check for updates'}
            </AppText>
          </View>
        </TVFocusable>
      )}
    </View>
  );
};

export default VersionCard;
