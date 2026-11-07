import React, {useEffect, useRef, useState} from 'react';
import {Linking, Switch, View, type ReturnKeyTypeOptions, type TextInputInstance} from 'react-native';
import KeyboardForm from '../../components/ui/KeyboardForm';
import {copyText} from '../../lib/clipboard';
import {RawTextInput as TextInput} from '../../components/ui/Text';
import Chip from '../../components/torrentSearch/Chip';
import AppText from '../../components/ui/Text';
import {isAniSkipEnabled, setAniSkipEnabled} from '../../lib/aniskip';
import {isServerProgressSyncEnabled, setServerProgressSyncEnabled} from '../../lib/sources/serverProgress';
import {toast} from '../../lib/torrentSearch/actions';
import {isTV} from '../../lib/tv/constants';
import {
  anilistAuthorizeUrl,
  anilistConnect,
  builtInApp,
  describeAccount,
  disconnectService,
  readSyncSettings,
  signInApp,
  simklPollPin,
  simklStartPin,
  traktPollDevice,
  traktStartDevice,
  updateAccount,
  type AccountStatus,
  type DeviceCode,
  type SyncServiceId,
  type SyncSettings,
} from '../../lib/watchSync';
import {startDevicePoll} from '../../lib/watchSync/devicePoll';
import QrCode from '../../components/QrCode';
import {useM3Colors} from '../../theme/M3PaletteContext';

/** Sign-in steps when the build carries its own app keys. */
const CODE_STEPS: Partial<Record<SyncServiceId, string>> = {
  trakt: 'Tap Sign in, then scan the QR code with your phone or enter the code on the Trakt page from any device.',
  simkl: 'Tap Sign in, then scan the QR code with your phone or enter the PIN on the Simkl page from any device.',
};

const HELP: Record<SyncServiceId, {name: string; app: string; steps: string}> = {
  trakt: {name: 'Trakt', app: 'https://trakt.tv/oauth/applications/new', steps: 'Create a Trakt app (any name, redirect uri urn:ietf:wg:oauth:2.0:oob), then paste its Client ID and Client Secret.'},
  simkl: {name: 'Simkl', app: 'https://simkl.com/settings/developer/new/', steps: 'Create a Simkl app (redirect urn:ietf:wg:oauth:2.0:oob), then paste its Client ID.'},
  anilist: {name: 'AniList', app: 'https://anilist.co/settings/developer', steps: 'Create an AniList client with redirect URL https://anilist.co/api/v2/oauth/pin, paste its ID, tap Sign in, then copy the token AniList shows, paste it here and tap Check token.'},
};

type AppField = 'clientId' | 'clientSecret';
type FieldId = `${SyncServiceId}.${AppField}` | 'anilist.token';
const APP_FIELDS: AppField[] = ['clientId', 'clientSecret'];

const WatchSync = () => {
  const colors = useM3Colors();
  const [settings, setSettings] = useState<SyncSettings>(readSyncSettings);
  const [code, setCode] = useState<{service: SyncServiceId; code: DeviceCode}>();
  const [aniskip, setAniskip] = useState(isAniSkipEnabled);
  const [serverSync, setServerSync] = useState(isServerProgressSyncEnabled);
  // The pasted AniList token stays here until AniList accepts it.
  const [anilistToken, setAnilistToken] = useState('');
  // Cancels the running poll, including one whose request is still in flight.
  const cancelPoll = useRef<(() => void) | undefined>(undefined);
  // App details typed and not saved yet. Buttons run while a field still has
  // focus, so every action saves what was typed first.
  const [drafts, setDrafts] = useState<Partial<Record<FieldId, string>>>({});
  const draftsRef = useRef<Partial<Record<FieldId, string>>>({});
  const inputs = useRef<Partial<Record<FieldId, TextInputInstance | null>>>({});

  useEffect(() => () => cancelPoll.current?.(), []);

  const patch = (id: SyncServiceId, value: Partial<SyncSettings[SyncServiceId]>) => setSettings(updateAccount(id, value));

  const setDraft = (field: FieldId, text: string) => {
    draftsRef.current = {...draftsRef.current, [field]: text};
    setDrafts(draftsRef.current);
  };

  /** Saves the app details typed for a service and returns its saved account. */
  const commitDrafts = (id: SyncServiceId): SyncSettings[SyncServiceId] => {
    const value: Partial<Record<AppField, string>> = {};
    const rest = {...draftsRef.current};
    for (const key of APP_FIELDS) {
      const draft = rest[`${id}.${key}`];
      if (draft === undefined) continue;
      delete rest[`${id}.${key}`];
      value[key] = draft.trim();
    }
    if (Object.keys(value).length === 0) return readSyncSettings()[id];
    draftsRef.current = rest;
    setDrafts(rest);
    const saved = readSyncSettings()[id];
    const changed = (Object.keys(value) as AppField[]).some(key => (saved[key] || '') !== value[key]);
    if (!changed) return saved;
    const next = updateAccount(id, value);
    setSettings(next);
    return next[id];
  };

  const cancelSignIn = () => {
    cancelPoll.current?.();
    cancelPoll.current = undefined;
    setCode(undefined);
  };

  const startDevice = async (id: 'trakt' | 'simkl') => {
    commitDrafts(id);
    const app = signInApp(id);
    if (!app.clientId || (id === 'trakt' && !app.clientSecret)) return toast(`Paste the ${HELP[id].name} app details first`);
    try {
      const device = id === 'trakt' ? await traktStartDevice(app.clientId, app) : await simklStartPin(app.clientId, app);
      cancelPoll.current?.();
      setCode({service: id, code: device});
      // On a phone the page opens right here; a TV shows the code and QR code for another device.
      if (!isTV) {
        copyText(device.userCode);
        Linking.openURL(device.verificationUrl).catch(() => undefined);
      }
      cancelPoll.current = startDevicePoll(device, {
        poll: id === 'trakt' ? traktPollDevice : simklPollPin,
        onApproved: () => {
          cancelPoll.current = undefined;
          setCode(undefined);
          setSettings(readSyncSettings());
          toast(`${HELP[id].name} connected`);
        },
        onStop: message => {
          cancelPoll.current = undefined;
          setCode(undefined);
          toast(message);
        },
      });
    } catch (error: any) {
      toast(error?.message || 'Could not start sign-in');
    }
  };

  /** Saves the pasted AniList token only once AniList accepts it. */
  const checkAnilistToken = async () => {
    commitDrafts('anilist');
    try {
      const username = await anilistConnect(anilistToken);
      setAnilistToken('');
      setSettings(readSyncSettings());
      toast(`AniList connected as ${username}`);
    } catch (error: any) {
      toast(error?.message || 'Could not check the token');
    }
  };

  const labelColor = (status: AccountStatus) =>
    status.tone === 'signedOut' ? colors.error : status.tone === 'none' ? colors.onSurfaceVariant : colors.primary;

  const signInAnilist = () => {
    const account = commitDrafts('anilist');
    if (account.clientId) Linking.openURL(anilistAuthorizeUrl(account.clientId));
    else toast('Paste the client ID first');
  };

  /** One app detail. `next` moves on to another field; otherwise the key is Go and runs `onGo`. */
  const field = (id: SyncServiceId, key: AppField, label: string, keys: {secret?: boolean; next?: FieldId; onGo?: () => unknown} = {}) => {
    const name: FieldId = `${id}.${key}`;
    const returnKeyType: ReturnKeyTypeOptions = keys.next ? 'next' : 'go';
    return (
      <TextInput ref={element => {
        inputs.current[name] = element;
      }} accessibilityLabel={`${HELP[id].name} ${label}`} placeholder={label} placeholderTextColor={colors.outline}
        value={drafts[name] ?? settings[id][key] ?? ''} onChangeText={text => setDraft(name, text)} secureTextEntry={keys.secret}
        autoCapitalize="none" autoCorrect={false} returnKeyType={returnKeyType} submitBehavior={keys.next ? 'submit' : undefined}
        onSubmitEditing={() => (keys.next ? inputs.current[keys.next]?.focus() : keys.onGo?.())}
        onEndEditing={event => {
          const text = event?.nativeEvent?.text;
          if (typeof text === 'string') setDraft(name, text);
          commitDrafts(id);
        }}
        style={{color: colors.onSurface, minHeight: 44, borderBottomWidth: 1, borderColor: colors.outlineVariant, marginTop: 4}} />
    );
  };

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

      <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 12, marginTop: 12, flexDirection: 'row', alignItems: 'center'}}>
        <View style={{flex: 1}}>
          <AppText role="titleMedium" style={{color: colors.onSurface}}>Sync progress with my servers</AppText>
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>Jellyfin, Emby and Plex get your progress, and their videos continue where you stopped</AppText>
        </View>
        <Switch accessibilityLabel="Sync progress with my servers" value={serverSync} onValueChange={value => { setServerProgressSyncEnabled(value); setServerSync(value); }} thumbColor={serverSync ? colors.primary : undefined} />
      </View>

      {(Object.keys(HELP) as SyncServiceId[]).map(id => {
        const account = settings[id];
        const connected = Boolean(account.accessToken);
        const status = describeAccount(id, account);
        const hasBuiltIn = Boolean(builtInApp(id));
        // The user's own app details are needed for AniList, for builds without app keys, and when chosen.
        const ownApp = id === 'anilist' || !hasBuiltIn || Boolean(account.useOwnApp);
        return (
          <View key={id} style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 12, marginTop: 12}}>
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <View style={{flex: 1}}>
                <AppText role="titleMedium" style={{color: colors.onSurface}}>{HELP[id].name}</AppText>
                <AppText role="bodySmall" style={{color: labelColor(status)}}>{status.label}</AppText>
                {status.detail ? (
                  <AppText role="bodySmall" style={{color: status.tone === 'warning' ? colors.error : colors.onSurfaceVariant}}>{status.detail}</AppText>
                ) : null}
              </View>
              <Switch accessibilityLabel={`Sync to ${HELP[id].name}`} value={account.enabled} onValueChange={value => patch(id, {enabled: value})} thumbColor={account.enabled ? colors.primary : undefined} />
            </View>
            {id === 'trakt' && connected ? (
              <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 8}}>
                <View style={{flex: 1}}>
                  <AppText role="bodyMedium" style={{color: colors.onSurface}}>Scrobble while watching</AppText>
                  <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>Shows what is playing on Trakt and saves where you stopped</AppText>
                </View>
                <Switch accessibilityLabel="Scrobble to Trakt while watching" value={account.scrobble !== false} onValueChange={value => patch('trakt', {scrobble: value})} thumbColor={account.scrobble !== false ? colors.primary : undefined} />
              </View>
            ) : null}
            {id === 'simkl' && connected ? (
              <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 8}}>
                <View style={{flex: 1}}>
                  <AppText role="bodyMedium" style={{color: colors.onSurface}}>Scrobble while watching</AppText>
                  <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>Shows what is playing on Simkl and saves where you stopped</AppText>
                </View>
                <Switch accessibilityLabel="Scrobble to Simkl while watching" value={account.scrobble !== false} onValueChange={value => patch('simkl', {scrobble: value})} thumbColor={account.scrobble !== false ? colors.primary : undefined} />
              </View>
            ) : null}
            {!connected ? (
              <>
                <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 8}}>{ownApp ? HELP[id].steps : CODE_STEPS[id]}</AppText>
                {hasBuiltIn && id !== 'anilist' ? (
                  <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 4}}>
                    <AppText role="bodyMedium" style={{color: colors.onSurface, flex: 1}}>Use my own app (advanced)</AppText>
                    <Switch accessibilityLabel={`${HELP[id].name} use my own app`} value={Boolean(account.useOwnApp)} onValueChange={value => patch(id, {useOwnApp: value})} thumbColor={account.useOwnApp ? colors.primary : undefined} />
                  </View>
                ) : null}
                {id === 'trakt' && ownApp ? field(id, 'clientId', 'Client ID', {next: 'trakt.clientSecret'}) : null}
                {id === 'trakt' && ownApp ? field(id, 'clientSecret', 'Client Secret', {secret: true, onGo: () => startDevice('trakt')}) : null}
                {id === 'simkl' && ownApp ? field(id, 'clientId', 'Client ID', {onGo: () => startDevice('simkl')}) : null}
                {id === 'anilist' ? field(id, 'clientId', 'Client ID', {next: 'anilist.token'}) : null}
                {id === 'anilist' ? (
                  <TextInput ref={element => {
                    inputs.current['anilist.token'] = element;
                  }} accessibilityLabel="AniList Paste the AniList token" placeholder="Paste the AniList token" placeholderTextColor={colors.outline} value={anilistToken}
                    onChangeText={setAnilistToken} secureTextEntry autoCapitalize="none" autoCorrect={false} returnKeyType="go"
                    onSubmitEditing={() => (anilistToken.trim() ? checkAnilistToken() : undefined)}
                    style={{color: colors.onSurface, minHeight: 44, borderBottomWidth: 1, borderColor: colors.outlineVariant, marginTop: 4}} />
                ) : null}
                {code?.service === id ? (
                  <View style={{marginTop: 12, padding: 16, borderRadius: 16, backgroundColor: colors.surfaceContainerHigh, flexDirection: isTV ? 'row' : 'column', alignItems: 'center', gap: 16}}>
                    <QrCode value={code.code.verificationUrl} size={isTV ? 240 : 200} accessibilityLabel={`QR code for ${code.code.verificationUrl}`} />
                    <View style={{alignItems: isTV ? 'flex-start' : 'center', flexShrink: 1}}>
                      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant}}>Scan the QR code, or go to</AppText>
                      <AppText role="titleMedium" selectable style={{color: colors.onSurface}}>{code.code.verificationUrl}</AppText>
                      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 8}}>and enter</AppText>
                      <AppText role="displaySmallEmphasized" selectable accessibilityLabel={`Code ${code.code.userCode.split('').join(' ')}`} style={{color: colors.primary, letterSpacing: 4}}>
                        {code.code.userCode}
                      </AppText>
                      <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 4}}>{isTV ? 'Waiting for you to approve…' : 'Code copied. Waiting for you to approve…'}</AppText>
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8}}>
              {!connected && ownApp ? <Chip label="Create app" icon="open-in-new" onPress={() => Linking.openURL(HELP[id].app)} /> : null}
              {!connected && id !== 'anilist' ? <Chip label="Sign in" icon="login" onPress={() => startDevice(id)} /> : null}
              {!connected && code?.service === id ? <Chip label="Cancel" icon="close" onPress={cancelSignIn} /> : null}
              {!connected && id === 'anilist' ? (
                <>
                  <Chip label="Sign in" icon="login" onPress={signInAnilist} />
                  <Chip label="Check token" icon="account-check" onPress={checkAnilistToken} />
                </>
              ) : null}
              {connected ? <Chip label="Disconnect" icon="logout" tone="warn" onPress={() => setSettings(disconnectService(id))} /> : null}
            </View>
          </View>
        );
      })}
    </KeyboardForm>
  );
};

export default WatchSync;
