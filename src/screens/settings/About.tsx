import {useFocusEffect} from '@react-navigation/native';
import {View, ScrollView, ToastAndroid, Linking, BackHandler, findNodeHandle, Image} from 'react-native';
import React, {useState, useRef, useCallback} from 'react';
import {settingsStorage} from '../../lib/storage';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import SettingsRow from '../../components/ui/SettingsRow';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import AppText from '../../components/ui/Text';
import LoadingIndicator from '../../components/ui/LoadingIndicator';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {isTV} from '../../lib/tv';
import {
  isDetailedLoggingEnabled,
  setDetailedLogging,
  shareLogs,
  clearLogs,
} from '../../lib/logging/vegaLog';
import {useRemoteStore} from '../../lib/remote/remoteStore';
import {socialLinks} from '../../lib/constants';
import {checkForUpdate} from '../../lib/updates/checkForUpdate';

export {checkForUpdate};

const About = ({navigation}: any) => {
  const colors = useM3Colors();
  const backRef = useRef<View>(null);
  const autoDownloadRef = useRef<View>(null);
  const [backHandle, setBackHandle] = useState<number | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [autoDownload, setAutoDownload] = useState(
    settingsStorage.isAutoDownloadEnabled(),
  );
  const [autoCheckUpdate, setAutoCheckUpdate] = useState<boolean>(
    settingsStorage.isAutoCheckUpdateEnabled(),
  );
  const [detailedLogging, setDetailedLoggingState] = useState(
    isDetailedLoggingEnabled,
  );
  const [exportingLogs, setExportingLogs] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const version = Application.nativeApplicationVersion || '';

  const handleClearLogs = async () => {
    setClearingLogs(true);
    try {
      await clearLogs();
      ToastAndroid.show('Logs cleared', ToastAndroid.SHORT);
    } catch (error: any) {
      ToastAndroid.show(error?.message || 'Could not clear logs', ToastAndroid.SHORT);
    } finally {
      setClearingLogs(false);
    }
  };

  const exportLogs = async () => {
    setExportingLogs(true);
    try {
      const device = useRemoteStore.getState().connectedDevice;
      await shareLogs(
        device
          ? `Receiver ${device.type}: ${[device.manufacturer, device.model, device.name]
              .filter(Boolean)
              .join(' ')}`
          : undefined,
      );
    } catch (error: any) {
      ToastAndroid.show(
        error?.message || 'Could not export logs',
        ToastAndroid.SHORT,
      );
    } finally {
      setExportingLogs(false);
    }
  };

  // Register only while this screen is focused. A hidden screen in a
  // mounted tab or stack must not swallow back presses.
  useFocusEffect(
    useCallback(() => {
      if (!isTV) {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (navigation?.canGoBack?.()) {
          navigation.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [navigation]),
  );

  return (
    <TVFocusGuide autoFocus={true} trapFocusRight={true} trapFocusDown={true} style={{flex: 1}}>
      <ScrollView
        focusable={false}
        accessible={false}
        style={{flex: 1, backgroundColor: colors.background}}
        contentContainerStyle={{padding: 20, paddingBottom: 40}}
        showsVerticalScrollIndicator={false}>
        <View className="mb-7">
          <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 12}}>
            <TVFocusable
              ref={backRef}
              onLayout={() => setBackHandle(findNodeHandle(backRef.current))}
              hasTVPreferredFocus={isTV}
              accessibilityLabel="Go back"
              accessibilityRole="button"
              onPress={() => navigation.goBack()}
              borderRadius={22}
              style={{
                alignItems: 'center',
                height: 44,
                justifyContent: 'center',
                marginRight: 10,
                width: 44,
              }}>
              <MaterialCommunityIcons
                name="arrow-left"
                size={28}
                color={colors.onBackground}
              />
            </TVFocusable>
            <AppText
              role="headlineLargeEmphasized"
              className="text-m3-on-background">
              About Droid Stream
            </AppText>
          </View>
          <AppText role="bodyLarge" className="mt-1 text-m3-on-surface-variant">
            Tordroid
          </AppText>
          <AppText role="labelLarge" className="mt-0.5 text-m3-on-surface-variant">
            Universal Labs
          </AppText>
        </View>

        <Image
          source={require('../../../assets/brand/logo.png')}
          accessibilityLabel="Tordroid logo"
          resizeMode="contain"
          style={{alignSelf: 'center', height: 168, marginBottom: 20, width: 168}}
        />

        <SettingsSection title="App">
          <SettingsRow
            title="Version"
            description={`Droid Stream ${version}`}
            icon="information-outline"
            divider={Constants.expoConfig?.extra?.isPlayStore}
          />

          {!Constants.expoConfig?.extra?.isPlayStore && (
            <>
              <SettingsSwitchRow
                ref={autoDownloadRef}
                nextFocusUp={backHandle}
                title="Auto install updates"
                description="When a newer release is found at startup, download it while the changelog is open"
                value={autoDownload}
                onValueChange={next => {
                  setAutoDownload(next);
                  settingsStorage.setAutoDownloadEnabled(next);
                }}
              />
              <SettingsSwitchRow
                title="Check on startup"
                description="Look for a new release when Droid Stream opens"
                value={autoCheckUpdate}
                onValueChange={next => {
                  setAutoCheckUpdate(next);
                  settingsStorage.setAutoCheckUpdateEnabled(next);
                }}
              />
              <SettingsRow
                title="Check for updates"
                description="Compare this build with the latest GitHub release"
                icon="update"
                divider={false}
                trailing={
                  updateLoading ? <LoadingIndicator size={14} /> : undefined
                }
                onPress={
                  updateLoading
                    ? undefined
                    : () => checkForUpdate(setUpdateLoading, autoDownload, true)
                }
              />
            </>
          )}
        </SettingsSection>

        <SettingsSection title="Tordroid">
          <SettingsRow
            title="Developer"
            description="Tordroid"
            icon="account-outline"
          />
          <SettingsRow
            title="Website"
            description="tordroid.com"
            icon="web"
            onPress={() => Linking.openURL(socialLinks.website)}
          />
          <SettingsRow
            title="Support"
            description="Message Tordroid on Telegram"
            icon="send"
            onPress={() => Linking.openURL(socialLinks.telegram)}
          />
          <SettingsRow
            title="Source code"
            description="1tordroid/Droid-Stream"
            icon="github"
            onPress={() => Linking.openURL(socialLinks.github)}
          />
          <SettingsRow
            title="Based on Vega by vega-org"
            description="Droid Stream is a noncommercial fork of Vega"
            icon="source-branch"
            divider={false}
            onPress={() => Linking.openURL(socialLinks.upstream)}
          />
        </SettingsSection>

        {!isTV && (
          <SettingsSection title="Troubleshooting">
            <SettingsSwitchRow
              title="Detailed logging"
              description="Records more detail for bug reports. Keeps up to 2 MB of logs. Turns off after 24 hours."
              value={detailedLogging}
              onValueChange={next => {
                setDetailedLoggingState(next);
                setDetailedLogging(next);
              }}
            />
            <SettingsRow
              title="Export logs"
              description="Share recent app logs with Tordroid. Links and sign-in data are removed."
              icon="file-document-outline"
              trailing={
                exportingLogs ? <LoadingIndicator size={14} /> : undefined
              }
              onPress={exportingLogs || clearingLogs ? undefined : exportLogs}
            />
            <SettingsRow
              title="Clear logs"
              description="Clear old logs before reproducing a problem."
              icon="delete-outline"
              divider={false}
              trailing={clearingLogs ? <LoadingIndicator size={14} /> : undefined}
              onPress={clearingLogs || exportingLogs ? undefined : handleClearLogs}
            />
          </SettingsSection>
        )}
      </ScrollView>
    </TVFocusGuide>
  );
};

export default About;
