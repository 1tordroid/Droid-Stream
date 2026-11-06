import React, {useEffect, useRef, useState} from 'react';
import {Linking, Switch, View} from 'react-native';
import KeyboardForm from '../../components/ui/KeyboardForm';
import {copyText} from '../../lib/clipboard';
import {RawTextInput as TextInput} from '../../components/ui/Text';
import Chip from '../../components/torrentSearch/Chip';
import AppText from '../../components/ui/Text';
import {isAniSkipEnabled, setAniSkipEnabled} from '../../lib/aniskip';
import {toast} from '../../lib/torrentSearch/actions';
import {
  anilistAuthorizeUrl,
  anilistViewer,
  readSyncSettings,
  simklPollPin,
  simklStartPin,
  traktPollDevice,
  traktStartDevice,
  updateAccount,
  type DeviceCode,
  type SyncServiceId,
  type SyncSettings,
} from '../../lib/watchSync';
import {useM3Colors} from '../../theme/M3PaletteContext';

const HELP: Record<SyncServiceId, {name: string; app: string; steps: string}> = {
  trakt: {name: 'Trakt', app: 'https://trakt.tv/oauth/applications/new', steps: 'Create a Trakt app (any name, redirect uri urn:ietf:wg:oauth:2.0:oob), then paste its Client ID and Client Secret.'},
  simkl: {name: 'Simkl', app: 'https://simkl.com/settings/developer/new/', steps: 'Create a Simkl app (redirect urn:ietf:wg:oauth:2.0:oob), then paste its Client ID.'},
  anilist: {name: 'AniList', app: 'https://anilist.co/settings/developer', steps: 'Create an AniList client with redirect URL https://anilist.co/api/v2/oauth/pin, paste its ID, tap Sign in, then copy the token AniList shows and paste it here.'},
};

const WatchSync = () => {
  const colors = useM3Colors();
  const [settings, setSettings] = useState<SyncSettings>(readSyncSettings);
  const [code, setCode] = useState<{service: SyncServiceId; code: DeviceCode}>();
  const [aniskip, setAniskip] = useState(isAniSkipEnabled);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => () => clearInterval(timer.current), []);

  const patch = (id: SyncServiceId, value: Partial<SyncSettings[SyncServiceId]>) => setSettings(updateAccount(id, value));

  const startDevice = async (id: 'trakt' | 'simkl') => {
    const account = settings[id];
    if (!account.clientId || (id === 'trakt' && !account.clientSecret)) return toast(`Paste the ${HELP[id].name} app details first`);
    try {
      const device = id === 'trakt' ? await traktStartDevice(account.clientId) : await simklStartPin(account.clientId);
      setCode({service: id, code: device});
      copyText(device.userCode);
      Linking.openURL(device.verificationUrl).catch(() => undefined);
      clearInterval(timer.current);
      timer.current = setInterval(async () => {
        if (Date.now() > device.expiresAt) {
          clearInterval(timer.current);
          setCode(undefined);
          return toast('The code expired. Try again.');
        }
        try {
          const ok = id === 'trakt' ? await traktPollDevice(device) : await simklPollPin(device);
          if (ok) {
            clearInterval(timer.current);
            setCode(undefined);
            setSettings(readSyncSettings());
            toast(`${HELP[id].name} connected`);
          }
        } catch (error: any) {
          clearInterval(timer.current);
          setCode(undefined);
          toast(error.message);
        }
      }, device.intervalSeconds * 1000);
    } catch (error: any) {
      toast(error?.message || 'Could not start sign-in');
    }
  };

  const field = (id: SyncServiceId, key: 'clientId' | 'clientSecret' | 'accessToken', label: string, secret = false) => (
    <TextInput accessibilityLabel={`${HELP[id].name} ${label}`} placeholder={label} placeholderTextColor={colors.outline} defaultValue={settings[id][key] || ''} secureTextEntry={secret}
      autoCapitalize="none" autoCorrect={false} returnKeyType="done" onEndEditing={event => patch(id, {[key]: event.nativeEvent.text.trim()})}
      style={{color: colors.onSurface, minHeight: 44, borderBottomWidth: 1, borderColor: colors.outlineVariant, marginTop: 4}} />
  );

  return (
    <KeyboardForm style={{backgroundColor: colors.background}} contentContainerStyle={{padding: 16, paddingBottom: 96}}>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Watch sync</AppText>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
        When you finish a movie or episode, Droid Stream marks it watched on the services you connect. Tokens stay encrypted on this phone.
      </AppText>

      <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 12, marginTop: 16, flexDirection: 'row', alignItems: 'center'}}>
        <View style={{flex: 1}}>
          <AppText role="titleMedium" style={{color: colors.onSurface}}>AniSkip for anime</AppText>
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>Crowd-sourced intro, recap, and credits times when a show has none</AppText>
        </View>
        <Switch accessibilityLabel="AniSkip for anime" value={aniskip} onValueChange={value => { setAniSkipEnabled(value); setAniskip(value); }} thumbColor={aniskip ? colors.primary : undefined} />
      </View>

      {(Object.keys(HELP) as SyncServiceId[]).map(id => {
        const account = settings[id];
        const connected = Boolean(account.accessToken);
        return (
          <View key={id} style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 12, marginTop: 12}}>
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <View style={{flex: 1}}>
                <AppText role="titleMedium" style={{color: colors.onSurface}}>{HELP[id].name}</AppText>
                <AppText role="bodySmall" style={{color: connected ? colors.primary : colors.onSurfaceVariant}}>
                  {connected ? `Connected${account.username ? ` as ${account.username}` : ''}` : 'Not connected'}
                </AppText>
              </View>
              <Switch accessibilityLabel={`Sync to ${HELP[id].name}`} value={account.enabled} onValueChange={value => patch(id, {enabled: value})} thumbColor={account.enabled ? colors.primary : undefined} />
            </View>
            {!connected ? (
              <>
                <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 8}}>{HELP[id].steps}</AppText>
                {field(id, 'clientId', 'Client ID')}
                {id === 'trakt' ? field(id, 'clientSecret', 'Client Secret', true) : null}
                {id === 'anilist' ? field(id, 'accessToken', 'Paste the AniList token', true) : null}
                {code?.service === id ? (
                  <AppText role="titleLarge" selectable style={{color: colors.primary, marginTop: 8}}>Code {code.code.userCode} (copied) · enter it at {code.code.verificationUrl}</AppText>
                ) : null}
              </>
            ) : null}
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8}}>
              {!connected ? <Chip label="Create app" icon="open-in-new" onPress={() => Linking.openURL(HELP[id].app)} /> : null}
              {!connected && id !== 'anilist' ? <Chip label="Sign in" icon="login" onPress={() => startDevice(id)} /> : null}
              {!connected && id === 'anilist' ? (
                <>
                  <Chip label="Sign in" icon="login" onPress={() => (account.clientId ? Linking.openURL(anilistAuthorizeUrl(account.clientId)) : toast('Paste the client ID first'))} />
                  <Chip label="Check token" icon="account-check" onPress={async () => {
                    const token = readSyncSettings().anilist.accessToken;
                    if (!token) return toast('Paste the token first');
                    try {
                      patch('anilist', {username: await anilistViewer(token)});
                      toast('AniList connected');
                    } catch (error: any) {
                      patch('anilist', {accessToken: ''});
                      toast(error.message);
                    }
                  }} />
                </>
              ) : null}
              {connected ? <Chip label="Disconnect" icon="logout" tone="warn" onPress={() => patch(id, {accessToken: '', refreshToken: '', username: ''})} /> : null}
            </View>
          </View>
        );
      })}
    </KeyboardForm>
  );
};

export default WatchSync;
