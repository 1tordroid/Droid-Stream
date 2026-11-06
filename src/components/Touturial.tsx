import {ActivityIndicator, Image, View, StatusBar, ToastAndroid, type HostInstance} from 'react-native';
import {getNodeHandle, requestTVFocusByHandle} from '../lib/tv/focus';
import {RawText as Text} from './ui/Text';
import React from 'react';
import {useState} from 'react';
import useContentStore from '../lib/zustand/contentStore';
import Animated, {FadeInRight} from 'react-native-reanimated';
import {
  NavigationProp,
  useFocusEffect,
  useNavigation,
} from '@react-navigation/native';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {settingsStorage} from '../lib/storage';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {RootStackParamList} from '../App';
import {useM3Colors} from '../theme/M3PaletteContext';
import * as DocumentPicker from 'expo-document-picker';
import {TVFocusable} from './tv';
import {isTV} from '../lib/tv/constants';
import {extensionManager} from '../lib/services/ExtensionManager';
import {extensionStorage} from '../lib/storage/extensionStorage';

const STARTER_PROVIDERS = 3;

const Tutorial = () => {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const colors = useM3Colors();
  const {provider: currentProvider, installedProviders, setInstalledProviders, setProvider} = useContentStore(
    state => state,
  );
  const [settingUp, setSettingUp] = useState(false);
  const hasNoProvider =
    !currentProvider ||
    !currentProvider.value ||
    !installedProviders ||
    installedProviders.length === 0;
  const [showTutorial, setShowTutorial] = useState<boolean>(hasNoProvider);
  const installButtonRef = React.useRef<HostInstance>(null);

  // A fresh TV install can leave native focus on the full-screen React root.
  // Request focus after the tutorial button has mounted so the first D-pad
  // press starts from a real control.
  useFocusEffect(
    React.useCallback(() => {
      if (!isTV || !showTutorial) return;
      const timer = setTimeout(() => {
        const handle = getNodeHandle(installButtonRef.current);
        if (handle) {
          requestTVFocusByHandle(handle);
        }
      }, 450);
      return () => clearTimeout(timer);
    }, [showTutorial]),
  );

  // Handle default provider setup
  React.useEffect(() => {
    if (
      !currentProvider ||
      !currentProvider.value ||
      !installedProviders ||
      installedProviders.length === 0
    ) {
      setShowTutorial(true);
    } else {
      setShowTutorial(false);
    }
  }, [installedProviders, currentProvider]);

  // Light status bar icons on the dark tutorial screens
  useFocusEffect(
    React.useCallback(() => {
      StatusBar.setBarStyle('light-content');

      return () => {
        StatusBar.setBarStyle('light-content');
      };
    }, []),
  );

  // One tap from a fresh install to a Home screen full of posters.
  const handleQuickStart = async () => {
    if (settingUp) return;
    setSettingUp(true);
    try {
      const available = await extensionManager.fetchManifest(true);
      const starters = available.filter(item => item && !item.disabled).slice(0, STARTER_PROVIDERS);
      await Promise.allSettled(starters.map(item => extensionManager.installProvider(item)));
      const installed = extensionStorage.getInstalledProviders() || [];
      if (!installed.length) throw new Error('No provider could be installed');
      setInstalledProviders(installed);
      setProvider(installed[0]);
    } catch {
      ToastAndroid.show('Could not set up providers. Check your connection or choose them yourself.', ToastAndroid.LONG);
    } finally {
      setSettingUp(false);
    }
  };

  const handleGoToExtensions = () => {
    // Add haptic feedback
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('effectClick', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }

    const parentNav = navigation.getParent();
    if (parentNav) {
      (parentNav as any).navigate('SettingsStack', {
        screen: 'Extensions',
      });
    } else {
      (navigation as any).navigate('SettingsStack', {
        screen: 'Extensions',
      });
    }
  };

  const handlePlayLocalFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'video/*',
      multiple: false,
      copyToCacheDirectory: false,
    });

    if (result.canceled || !result.assets?.[0]) {
      return;
    }

    const video = result.assets[0];
    navigation.navigate('Player', {
      linkIndex: 0,
      episodeList: [
        {
          id: video.uri,
          title: video.name || 'Local video',
          link: video.uri,
        },
      ],
      directUrl: video.uri,
      type: 'mp4',
      primaryTitle: video.name || 'Local video',
      poster: {},
    });
  };

  return showTutorial ? (
    <View
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
        backgroundColor: colors.background || '#121212',
        justifyContent: 'center',
        alignItems: 'center',
      }}
      className="z-50">
      <Animated.View
        entering={FadeInRight.duration(500)}
        className="rounded-2xl p-6 w-full max-w-sm items-center">
        <Image
          source={require('../../assets/icon.png')}
          accessibilityLabel="Droid Stream logo"
          style={{width: 112, height: 112, borderRadius: 24, marginBottom: 16}}
        />
        <Text
          style={{
            color: colors.onSurface,
            fontSize: 26,
            fontWeight: '700',
            textAlign: 'center',
            marginBottom: 8,
          }}>
          Welcome to Droid Stream
        </Text>
        <Text
          style={{
            color: colors.onSurfaceVariant,
            fontSize: 16,
            textAlign: 'center',
            marginBottom: 24,
            lineHeight: 24,
          }}>
          One tap adds starter providers from the official Vega list, so your Home fills up with movies and shows.
        </Text>
        <TVFocusable
          ref={installButtonRef}
          onPress={handleQuickStart}
          hasTVPreferredFocus={true}
          accessibilityLabel="Get started"
          accessibilityRole="button"
          borderRadius={12}
          focusBorderColor={colors.onPrimary}
          style={{width: '100%'}}>
          <View
            className="px-6 py-4 rounded-xl w-full flex-row items-center justify-center"
            style={{backgroundColor: colors.primary}}>
            {settingUp ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <MaterialCommunityIcons name="rocket-launch-outline" size={20} color={colors.onPrimary} />
            )}
            <Text style={{color: colors.onPrimary, fontSize: 16, fontWeight: '700', marginLeft: 8}}>
              {settingUp ? 'Setting up…' : 'Get started'}
            </Text>
          </View>
        </TVFocusable>
        <TVFocusable
          onPress={handleGoToExtensions}
          accessibilityLabel="Choose providers myself"
          accessibilityRole="button"
          borderRadius={12}
          style={{width: '100%', marginTop: 12}}>
          <View
            className="px-6 py-3 rounded-xl w-full flex-row items-center justify-center"
            style={{backgroundColor: colors.surfaceContainerHigh}}>
            <MaterialCommunityIcons name="format-list-checks" size={20} color={colors.onSurface} />
            <Text style={{color: colors.onSurface, fontSize: 16, fontWeight: '500', marginLeft: 8}}>
              Choose providers myself
            </Text>
          </View>
        </TVFocusable>
        <TVFocusable
          onPress={handlePlayLocalFile}
          accessibilityLabel="Play local file"
          accessibilityRole="button"
          borderRadius={12}
          style={{width: '100%', marginTop: 12}}>
          <View
            className="px-6 py-3 rounded-xl w-full flex-row items-center justify-center"
            style={{
              backgroundColor: colors.surfaceContainerHigh,
            }}>
            <MaterialCommunityIcons
              name="play-circle-outline"
              size={20}
              color={colors.onSurface}
            />
            <Text
              style={{
                color: colors.onSurface,
                fontSize: 16,
                fontWeight: '500',
                marginLeft: 8,
              }}>
              Play local file
            </Text>
          </View>
        </TVFocusable>
      </Animated.View>
    </View>
  ) : null;
};

export default Tutorial;
