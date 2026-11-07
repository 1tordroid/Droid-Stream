/**
 * Settings > Advanced downloads: remote control (aria2-style), command
 * access and browser-like connections. All three are off by default.
 */
import React, {useEffect, useState} from 'react';
import {ToastAndroid, View} from 'react-native';
import QrCode from '../../components/QrCode';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import {copyText} from '../../lib/clipboard';
import {ariaNgUrl, rpcAddress} from '../../lib/remoteAccess/ariaNg';
import {addSite} from '../../lib/remoteAccess/browserLike';
import {commandExamples} from '../../lib/remoteAccess/commands';
import {remoteAccessNative, type RpcServerState} from '../../lib/remoteAccess/native';
import {
  applyBrowserLikeSites,
  applyCommandAccess,
  applyRemoteControl,
  currentServerState,
  subscribeServerState,
} from '../../lib/remoteAccess/service';
import {isValidPort, remoteAccessSettings} from '../../lib/remoteAccess/settings';
import {useM3Colors} from '../../theme/M3PaletteContext';

const Note = ({children}: {children: React.ReactNode}) => {
  const colors = useM3Colors();
  return (
    <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, paddingHorizontal: 16, paddingVertical: 12}}>
      {children}
    </AppText>
  );
};

const useInputStyle = () => {
  const colors = useM3Colors();
  return {
    backgroundColor: colors.surfaceContainerHigh,
    color: colors.onSurface,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 16,
    marginTop: 8,
  };
};

const copy = (text: string, what: string) => {
  copyText(text);
  ToastAndroid.show(`${what} copied`, ToastAndroid.SHORT);
};

/** A label, a value in a monospace font, and a Copy button. */
const CopyRow = ({label, value}: {label: string; value: string}) => {
  const colors = useM3Colors();
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8}}>
      <View style={{flex: 1}}>
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{label}</AppText>
        <AppText role="bodyMedium" selectable style={{color: colors.onSurface, fontFamily: 'monospace'}}>{value}</AppText>
      </View>
      <IconButton icon="content-copy" label={`Copy ${label.toLowerCase()}`} onPress={() => copy(value, label)} />
    </View>
  );
};

const showError = (error: unknown) => ToastAndroid.show((error as Error)?.message || 'That did not work', ToastAndroid.LONG);

// ---- Remote control ----

export const RemoteControlSection = () => {
  const colors = useM3Colors();
  const inputStyle = useInputStyle();
  const [enabled, setEnabled] = useState(remoteAccessSettings.rpcEnabled());
  const [state, setState] = useState<RpcServerState>(currentServerState());
  const [port, setPort] = useState(String(remoteAccessSettings.rpcPort()));
  const [token, setToken] = useState(() => (enabled ? remoteAccessSettings.rpcToken() : ''));
  useEffect(() => subscribeServerState(next => {
    setState(next);
    setEnabled(remoteAccessSettings.rpcEnabled());
  }), []);
  if (!remoteAccessNative.supported()) return null;
  const toggle = (value: boolean) => {
    try {
      if (value) setToken(remoteAccessSettings.rpcToken());
    } catch (error) {
      showError(error);
      return;
    }
    remoteAccessSettings.setRpcEnabled(value);
    setEnabled(value);
    applyRemoteControl().catch(showError);
  };
  const savePort = () => {
    const value = Number(port);
    if (!isValidPort(value)) {
      ToastAndroid.show('Choose a port from 1024 to 65535.', ToastAndroid.LONG);
      return;
    }
    remoteAccessSettings.setRpcPort(value);
    if (enabled) applyRemoteControl().catch(showError);
  };
  const address = state.running && state.address && state.port ? rpcAddress(state.address, state.port) : '';
  return (
    <SettingsSection title="Remote control">
      <SettingsSwitchRow
        title="Remote control"
        description="Add and manage downloads from AriaNg or an aria2 browser extension on another device on your Wi-Fi."
        value={enabled}
        onValueChange={toggle}
      />
      {enabled ? (
        <>
          {address ? (
            <>
              <CopyRow label="Address" value={address} />
              <CopyRow label="Token" value={token} />
              <View style={{alignItems: 'center', paddingVertical: 12}}>
                <QrCode value={ariaNgUrl(state.address || '', state.port || 0, token)} size={200} accessibilityLabel="QR code that opens AriaNg with this address and token" />
                <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 8, textAlign: 'center'}}>
                  Scan with another device to open AriaNg with these settings.
                </AppText>
              </View>
            </>
          ) : (
            <Note>{state.error || 'Starting…'}</Note>
          )}
          <View style={{padding: 16}}>
            <AppText role="bodyMedium" style={{color: colors.onSurface}}>Port</AppText>
            <TextInput
              value={port}
              onChangeText={setPort}
              placeholder="6800"
              placeholderTextColor={colors.onSurfaceVariant}
              accessibilityLabel="Remote control port"
              keyboardType="number-pad"
              onSubmitEditing={savePort}
              style={inputStyle}
            />
            <View style={{flexDirection: 'row', gap: 8, marginTop: 10}}>
              <Button onPress={savePort} accessibilityLabel="Save port">Save port</Button>
              <Button
                variant="outlined"
                onPress={() => {
                  try {
                    setToken(remoteAccessSettings.resetRpcToken());
                  } catch (error) {
                    showError(error);
                  }
                }}
                accessibilityLabel="Make a new token"
              >
                New token
              </Button>
            </View>
          </View>
          <Note>
            In AriaNg or the extension, enter the address and the token (secret). Only devices on your home network can connect, and only with the token. AriaNg must be opened over http://, not https://. Stays on while the notification shows.
          </Note>
        </>
      ) : null}
    </SettingsSection>
  );
};

// ---- Command access ----

export const CommandAccessSection = () => {
  const colors = useM3Colors();
  const [enabled, setEnabled] = useState(remoteAccessSettings.commandsEnabled());
  const [token, setToken] = useState(() => (enabled ? remoteAccessSettings.commandToken() : ''));
  if (!remoteAccessNative.supported()) return null;
  const toggle = (value: boolean) => {
    try {
      if (value) setToken(remoteAccessSettings.commandToken());
    } catch (error) {
      showError(error);
      return;
    }
    remoteAccessSettings.setCommandsEnabled(value);
    setEnabled(value);
    applyCommandAccess().catch(showError);
  };
  const examples = enabled && token ? commandExamples(remoteAccessNative.packageName(), token) : undefined;
  return (
    <SettingsSection title="Command access">
      <SettingsSwitchRow
        title="Command access"
        description="Add, pause, resume and list downloads with commands from Termux, ADB or Tasker."
        value={enabled}
        onValueChange={toggle}
      />
      {examples ? (
        <>
          <CopyRow label="Token" value={token} />
          <CopyRow label="Add a download" value={examples.add} />
          <CopyRow label="Pause all" value={examples.pause} />
          <CopyRow label="Resume all" value={examples.resume} />
          <CopyRow label="List" value={examples.list} />
          <CopyRow label="From a computer (ADB)" value={examples.adb} />
          <View style={{paddingHorizontal: 16, paddingBottom: 8}}>
            <Button
              variant="outlined"
              onPress={() => {
                try {
                  const next = remoteAccessSettings.resetCommandToken();
                  setToken(next);
                  applyCommandAccess().catch(showError);
                } catch (error) {
                  showError(error);
                }
              }}
              accessibilityLabel="Make a new command token"
            >
              New token
            </Button>
          </View>
          <Note>
            For Tasker: Send Intent, Action com.tordroid.droidstream.ADD_DOWNLOAD, Package {remoteAccessNative.packageName()}, Target Broadcast Receiver, Extras token:… and url:…. Pause and resume take an id extra (a download id from LIST, or all). Commands without the token are refused.
          </Note>
        </>
      ) : null}
      {!examples && enabled ? <AppText role="bodySmall" style={{color: colors.error, padding: 16}}>No token yet.</AppText> : null}
    </SettingsSection>
  );
};

// ---- Browser-like connection ----

export const BrowserLikeSection = () => {
  const colors = useM3Colors();
  const inputStyle = useInputStyle();
  const [sites, setSites] = useState<string[]>(remoteAccessSettings.browserLikeSites());
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  if (!remoteAccessNative.supported()) return null;
  const save = (next: string[]) => {
    remoteAccessSettings.setBrowserLikeSites(next);
    setSites(remoteAccessSettings.browserLikeSites());
    applyBrowserLikeSites().catch(showError);
  };
  const add = () => {
    const result = addSite(sites, input);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    save(result.sites);
    setInput('');
    setError('');
  };
  return (
    <SettingsSection title="Use a browser-like connection">
      <Note>
        For sites that refuse the app but work in Chrome. Downloads from these sites connect like Chrome does (its TLS settings and headers). It is close to Chrome, not identical. Debrid services always use the normal connection.
      </Note>
      {sites.map(site => (
        <View key={site} style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.outlineVariant}}>
          <AppText role="bodyLarge" numberOfLines={1} style={{color: colors.onSurface, flex: 1}}>{site}</AppText>
          <IconButton icon="delete-outline" label={`Remove ${site}`} onPress={() => save(sites.filter(item => item !== site))} />
        </View>
      ))}
      <View style={{padding: 16}}>
        <AppText role="bodyMedium" style={{color: colors.onSurface}}>Add a site</AppText>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="example.com"
          placeholderTextColor={colors.onSurfaceVariant}
          accessibilityLabel="Site for a browser-like connection"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={add}
          style={inputStyle}
        />
        {error ? <AppText role="bodySmall" style={{color: colors.error, marginTop: 6}}>{error}</AppText> : null}
        <View style={{flexDirection: 'row', marginTop: 10}}>
          <Button onPress={add} accessibilityLabel="Add site">Add</Button>
        </View>
      </View>
      <Note>yt-dlp downloads from these sites get Chrome's headers. Its full browser impersonation is not available in the app.</Note>
    </SettingsSection>
  );
};
