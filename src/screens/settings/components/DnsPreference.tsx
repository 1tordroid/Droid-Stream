import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect, useState } from 'react';
import {ToastAndroid, View, Keyboard, BackHandler, type TextInputInstance} from 'react-native';
import {RawTextInput as TextInput} from '../../../components/ui/Text';
import { settingsStorage } from '../../../lib/storage';
import {
  DOH_PROVIDERS,
  DohProviderValue,
  syncDohSettings,
} from '../../../lib/services/dohService';
import {
  DEFAULT_BYEDPI_ARGS,
  BYEDPI_PRESETS,
  getByeDpiStatus,
  restartByeDpi,
} from '../../../lib/services/byeDpiService';
import {
  forgetUnblockedHost,
  getUnblockMode,
  getUnblockStatus,
  listUnblockedHosts,
  routeLabel,
  setUnblockMode,
  subscribeUnblockedHosts,
  syncUnblock,
  type UnblockedHost,
} from '../../../lib/unblock/unblockService';
import type {UnblockMode} from '../../../lib/unblock/routing';
import UnblockModeChoices from '../../../components/unblock/UnblockModeChoices';
import { useM3Colors } from '../../../theme/M3PaletteContext';
import AppText from '../../../components/ui/Text';
import DropdownField from '../../../components/ui/DropdownField';
import {TVFocusable} from '../../../components/tv';

const STATUS_POLL_MS = 3000;

const DnsPreference = () => {
  const colors = useM3Colors();

  const [mode, setModeState] = useState<UnblockMode>(() => getUnblockMode());
  const [isModeBusy, setIsModeBusy] = useState<boolean>(false);
  const [running, setRunning] = useState({byeDpi: false, warp: false});
  const [hosts, setHosts] = useState<UnblockedHost[]>(() => listUnblockedHosts());

  const [byeDpiArgs, setByeDpiArgs] = useState(
    settingsStorage.getByeDpiCmdArgs() || DEFAULT_BYEDPI_ARGS,
  );
  const [isByeDpiBusy, setIsByeDpiBusy] = useState<boolean>(false);
  const [showArgsEditor, setShowArgsEditor] = useState<boolean>(false);
  const argsInputRef = React.useRef<TextInputInstance>(null);
  const [isArgsInputFocused, setIsArgsInputFocused] = useState<boolean>(false);
  const customUrlInputRef = React.useRef<TextInputInstance>(null);
  const [isCustomUrlFocused, setIsCustomUrlFocused] = useState<boolean>(false);

  useEffect(() => {
    if (!showArgsEditor && !isArgsInputFocused && !isCustomUrlFocused) return;

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (argsInputRef.current?.isFocused() || isArgsInputFocused) {
        argsInputRef.current?.blur();
        setIsArgsInputFocused(false);
        Keyboard.dismiss();
        return true;
      }
      if (customUrlInputRef.current?.isFocused() || isCustomUrlFocused) {
        customUrlInputRef.current?.blur();
        setIsCustomUrlFocused(false);
        Keyboard.dismiss();
        return true;
      }
      if (showArgsEditor) {
        setShowArgsEditor(false);
        return true;
      }
      return false;
    });

    return () => sub.remove();
  }, [showArgsEditor, isArgsInputFocused, isCustomUrlFocused]);

  // Which proxies run changes on its own in Auto, so keep checking while Settings is open.
  useEffect(() => {
    let active = true;
    const refresh = () => {
      getUnblockStatus()
        .then(status => {
          if (active) setRunning({byeDpi: status.byeDpiRunning, warp: status.warpRunning});
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, STATUS_POLL_MS);
    const unsubscribe = subscribeUnblockedHosts(() => setHosts(listUnblockedHosts()));
    return () => {
      active = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  const initialProvider = settingsStorage.isDohEnabled()
    ? (settingsStorage.getDohProvider() as DohProviderValue)
    : 'off';
  const [provider, setProvider] = useState<DohProviderValue>(initialProvider);
  const [customUrl, setCustomUrl] = useState(settingsStorage.getDohCustomUrl());

  const chooseMode = async (next: UnblockMode) => {
    if (isModeBusy || next === mode) return;
    setIsModeBusy(true);
    setModeState(next);
    if (next === 'warp') {
      ToastAndroid.show('Connecting to Cloudflare WARP...', ToastAndroid.SHORT);
    }
    try {
      await setUnblockMode(next);
    } catch (e: any) {
      ToastAndroid.show(
        `Unblocking error: ${e?.message || 'could not change it'}`,
        ToastAndroid.LONG,
      );
    } finally {
      setIsModeBusy(false);
      getUnblockStatus()
        .then(status => setRunning({byeDpi: status.byeDpiRunning, warp: status.warpRunning}))
        .catch(() => undefined);
    }
  };

  const forgetHost = async (host: string) => {
    await forgetUnblockedHost(host);
    setHosts(listUnblockedHosts());
    ToastAndroid.show(`${host} will be tried directly again`, ToastAndroid.SHORT);
  };

  const saveByeDpiArgs = async (value: string) => {
    const trimmed = value.trim();
    setByeDpiArgs(trimmed);
    settingsStorage.setByeDpiCmdArgs(trimmed);
    // The router starts ByeDPI with these when a site needs it.
    await syncUnblock().catch(() => undefined);
    const status = await getByeDpiStatus().catch(() => ({running: false}));
    if (status.running) {
      setIsByeDpiBusy(true);
      try {
        const res = await restartByeDpi(trimmed);
        if (res.running) {
          ToastAndroid.show(
            'ByeDPI restarted with new parameters',
            ToastAndroid.SHORT,
          );
        }
      } catch (e: any) {
        ToastAndroid.show(`ByeDPI error: ${e?.message}`, ToastAndroid.LONG);
      } finally {
        setIsByeDpiBusy(false);
      }
    } else {
      ToastAndroid.show('ByeDPI parameters saved', ToastAndroid.SHORT);
    }
  };

  const resetByeDpiArgs = () => {
    saveByeDpiArgs(DEFAULT_BYEDPI_ARGS);
  };

  const selectProvider = async (value: DohProviderValue) => {
    setProvider(value);
    settingsStorage.setDohEnabled(value !== 'off');
    if (value !== 'off') {
      settingsStorage.setDohProvider(value);
    }
    await syncDohSettings();
  };

  const saveCustomUrl = async (value: string) => {
    settingsStorage.setDohCustomUrl(value);
    await syncDohSettings();
    ToastAndroid.show('Custom DNS applied', ToastAndroid.SHORT);
  };

  const warpMode = mode === 'warp';
  const runningText = [running.byeDpi ? 'ByeDPI' : '', running.warp ? 'WARP' : '']
    .filter(Boolean)
    .join(' and ');

  return (
    <View className="p-4">
      {/* Smart unblock */}
      <View className="mb-2 flex-row items-center">
        <View
          className="mr-4 h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: colors.secondaryContainer }}>
          <MaterialCommunityIcons
            name="shield-half"
            size={21}
            color={colors.onSecondaryContainer}
          />
        </View>
        <View className="flex-1">
          <AppText role="bodyLarge" className="text-m3-on-surface">
            Unblocking
          </AppText>
          <AppText
            role="bodySmall"
            className="mt-0.5 text-m3-on-surface-variant">
            {runningText ? `Running now: ${runningText}` : 'Nothing running now'}
          </AppText>
        </View>
      </View>

      <UnblockModeChoices value={mode} onChange={chooseMode} disabled={isModeBusy} />

      {mode === 'auto' ? (
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 4, marginLeft: 8}}>
          Debrid services always stay direct. WARP is run by Cloudflare. Torrents and in-app browser pages are not unblocked.
        </AppText>
      ) : null}

      {hosts.length ? (
        <View style={{marginTop: 12}}>
          <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginBottom: 4, marginLeft: 8}}>
            Sites opened through ByeDPI or WARP
          </AppText>
          {hosts.map(item => (
            <View
              key={item.host}
              style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingLeft: 8}}>
              <View style={{flex: 1}}>
                <AppText role="bodyMedium" style={{color: colors.onSurface}} numberOfLines={1}>
                  {item.host}
                </AppText>
                <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
                  {routeLabel(item.route)} until {new Date(item.until).toLocaleDateString()}
                </AppText>
              </View>
              <TVFocusable
                onPress={() => forgetHost(item.host)}
                accessibilityRole="button"
                accessibilityLabel={`Forget ${item.host}`}
                focusScale={1.05}
                borderRadius={16}
                style={{paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16}}>
                <AppText role="labelLarge" style={{color: colors.primary}}>
                  Forget
                </AppText>
              </TVFocusable>
            </View>
          ))}
        </View>
      ) : null}

      <View className="mb-4">
        {/* Optional Args Editor Toggle & Config */}
        <View className="mt-2 ml-2">
          <TVFocusable
            onPress={() => setShowArgsEditor(!showArgsEditor)}
            focusScale={1.03}
            borderRadius={8}
            style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 4}}>
            <AppText
              role="labelSmall"
              style={{ color: colors.primary, marginRight: 4 }}>
              {isByeDpiBusy ? 'Restarting ByeDPI...' : showArgsEditor ? 'Hide ByeDPI parameters' : 'ByeDPI parameters'}
            </AppText>
            <MaterialCommunityIcons
              name={showArgsEditor ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.primary}
            />
          </TVFocusable>

          {showArgsEditor ? (
            <View className="mt-2 pr-1">
              <View className="flex-row items-center justify-between mb-2">
                <AppText
                  role="labelMedium"
                  style={{ color: colors.onSurfaceVariant }}>
                  Command Line Arguments
                </AppText>
                <TVFocusable
                  onPress={resetByeDpiArgs}
                  focusScale={1.05}
                  borderRadius={8}
                  style={{paddingHorizontal: 8, paddingVertical: 4}}>
                  <AppText role="labelSmall" style={{ color: colors.primary }}>
                    Reset default
                  </AppText>
                </TVFocusable>
              </View>

              {/* Preset Strategies */}
              <View className="mb-2.5 flex-row flex-wrap gap-1.5">
                {BYEDPI_PRESETS.map(preset => {
                  const isSelected =
                    (byeDpiArgs || DEFAULT_BYEDPI_ARGS) === preset.args;
                  return (
                    <TVFocusable
                      key={preset.id}
                      onPress={() => saveByeDpiArgs(preset.args)}
                      focusScale={1.08}
                      borderRadius={16}
                      style={{
                        backgroundColor: isSelected
                          ? colors.primaryContainer
                          : colors.surfaceContainerHigh,
                        borderWidth: isSelected ? 1 : 0,
                        borderColor: colors.primary,
                        borderRadius: 16,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                      }}>
                      <AppText
                        role="labelSmall"
                        style={{
                          color: isSelected
                            ? colors.onPrimaryContainer
                            : colors.onSurfaceVariant,
                          fontWeight: isSelected ? '600' : '400',
                        }}>
                        {preset.name}
                      </AppText>
                    </TVFocusable>
                  );
                })}
              </View>

              <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4}}>
                <TextInput
                  ref={argsInputRef}
                  value={byeDpiArgs}
                  onChangeText={setByeDpiArgs}
                  onFocus={() => setIsArgsInputFocused(true)}
                  onBlur={() => {
                    setIsArgsInputFocused(false);
                    saveByeDpiArgs(byeDpiArgs);
                  }}
                  onSubmitEditing={() => {
                    saveByeDpiArgs(byeDpiArgs);
                    argsInputRef.current?.blur();
                    Keyboard.dismiss();
                  }}
                  returnKeyType="done"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={DEFAULT_BYEDPI_ARGS}
                  placeholderTextColor={colors.onSurfaceVariant}
                  style={{
                    flex: 1,
                    backgroundColor: colors.surfaceContainerHigh,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    fontSize: 13,
                    color: colors.onSurface,
                    borderWidth: isArgsInputFocused ? 2 : 1,
                    borderColor: isArgsInputFocused ? colors.primary : colors.outlineVariant,
                  }}
                />
                <TVFocusable
                  onPress={() => {
                    saveByeDpiArgs(byeDpiArgs);
                    argsInputRef.current?.blur();
                    Keyboard.dismiss();
                  }}
                  borderRadius={12}
                  focusScale={1.05}
                  style={{
                    backgroundColor: colors.primary,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}>
                  <AppText role="labelMedium" style={{color: colors.onPrimary, fontWeight: '700'}}>
                    Save
                  </AppText>
                </TVFocusable>
              </View>
            </View>
          ) : null}
        </View>
      </View>

      {/* Divider */}
      <View
        style={{
          borderBottomColor: colors.outlineVariant,
          borderBottomWidth: 1,
          marginBottom: 16,
        }}
      />

      {/* DNS over HTTPS Section */}
      <View style={{ opacity: warpMode ? 0.45 : 1 }}>
        <View className="mb-3 flex-row items-center">
          <View
            className="mr-4 h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.secondaryContainer }}>
            <MaterialCommunityIcons
              name="shield-lock-outline"
              size={21}
              color={colors.onSecondaryContainer}
            />
          </View>
          <View className="flex-1">
            <AppText role="bodyLarge" className="text-m3-on-surface">
              DNS over HTTPS
            </AppText>
            <AppText
              role="bodySmall"
              className="mt-0.5 text-m3-on-surface-variant">
              {warpMode
                ? 'Managed by Cloudflare WARP (resolved remotely)'
                : 'Encrypt DNS queries with secure resolver. ByeDPI always uses it.'}
            </AppText>
          </View>
        </View>

        <View style={{ width: '100%', minHeight: 56 }}>
          <DropdownField
            disabled={warpMode}
            options={DOH_PROVIDERS}
            value={DOH_PROVIDERS.find(option => option.value === provider)}
            getKey={option => option.value}
            getLabel={option => option.label}
            onChange={option => selectProvider(option.value)}
          />
        </View>

        {provider === 'custom' && !warpMode ? (
          <View
            style={{
              borderTopColor: colors.outlineVariant,
              borderTopWidth: 1,
              marginTop: 14,
              paddingTop: 14,
            }}>
            <AppText
              role="labelMedium"
              style={{ color: colors.onSurfaceVariant, marginBottom: 8 }}>
              Custom DoH URL
            </AppText>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4}}>
              <TextInput
                ref={customUrlInputRef}
                value={customUrl}
                onChangeText={setCustomUrl}
                onFocus={() => setIsCustomUrlFocused(true)}
                onBlur={() => {
                  setIsCustomUrlFocused(false);
                  saveCustomUrl(customUrl);
                }}
                onSubmitEditing={() => {
                  saveCustomUrl(customUrl);
                  customUrlInputRef.current?.blur();
                  Keyboard.dismiss();
                }}
                returnKeyType="done"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://dns.example.com/dns-query"
                placeholderTextColor={colors.onSurfaceVariant}
                style={{
                  flex: 1,
                  backgroundColor: colors.surfaceContainerHigh,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  fontSize: 13,
                  color: colors.onSurface,
                  borderWidth: isCustomUrlFocused ? 2 : 1,
                  borderColor: isCustomUrlFocused ? colors.primary : colors.outlineVariant,
                }}
              />
              <TVFocusable
                onPress={() => {
                  saveCustomUrl(customUrl);
                  customUrlInputRef.current?.blur();
                  Keyboard.dismiss();
                }}
                borderRadius={12}
                focusScale={1.05}
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}>
                <AppText role="labelMedium" style={{color: colors.onPrimary, fontWeight: '700'}}>
                  Apply
                </AppText>
              </TVFocusable>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
};

export default DnsPreference;
