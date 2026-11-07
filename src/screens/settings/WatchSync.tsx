import React, {useEffect, useRef, useState} from 'react';
import {Linking, Switch, View, type ReturnKeyTypeOptions, type TextInputInstance} from 'react-native';
import KeyboardForm from '../../components/ui/KeyboardForm';
import {copyText} from '../../lib/clipboard';
import {RawTextInput as TextInput} from '../../components/ui/Text';
import Chip from '../../components/torrentSearch/Chip';
import AppText from '../../components/ui/Text';
import {isAniSkipEnabled, setAniSkipEnabled} from '../../lib/aniskip';
import {toast} from '../../lib/torrentSearch/actions';
import {
  anilistAuthorizeUrl,
  anilistConnect,
  describeAccount,
  disconnectService,
  readSyncSettings,
  simklPollPin,
  simklStartPin,
  traktPollDevice,
  traktStartDevice,
  updateAccount,
  type AccountStatus,
  type DeviceCode,
  type PollResult,
  type SyncServiceId,
  type SyncSettings,
} from '../../lib/watchSync';
import {useM3Colors} from '../../theme/M3PaletteContext';

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
  // The pasted AniList token stays here until AniList accepts it.
  const [anilistToken, setAnilistToken] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bumped to cancel a running poll, including one whose request is still in flight.
  const pollRun = useRef(0);
  // App details typed and not saved yet. Buttons run while a field still has
  // focus, so every action saves what was typed first.
  const [drafts, setDrafts] = useState<Partial<Record<FieldId, string>>>({});
  const draftsRef = useRef<Partial<Record<FieldId, string>>>({});
  const inputs = useRef<Partial<Record<FieldId, TextInputInstance | null>>>({});

  useEffect(() => () => {
    pollRun.current += 1;
    clearTimeout(timer.current);
  }, []);

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

  const startDevice = async (id: 'trakt' | 'simkl') => {
    const account = commitDrafts(id);
    if (!account.clientId || (id === 'trakt' && !account.clientSecret)) return toast(`Paste the ${HELP[id].name} app details first`);
    try {
      const device = id === 'trakt' ? await traktStartDevice(account.clientId) : await simklStartPin(account.clientId);
      setCode({service: id, code: device});
      copyText(device.userCode);
      Linking.openURL(device.verificationUrl).catch(() => undefined);
      clearTimeout(timer.current);
      pollRun.current += 1;
      const run = pollRun.current;
      let delay = device.intervalSeconds * 1000;
      const stop = (message?: string) => {
        clearTimeout(timer.current);
        setCode(undefined);
        if (message) toast(message);
      };
      const tick = async () => {
        if (run !== pollRun.current) return;
        if (Date.now() > device.expiresAt) return stop('The code expired. Try again.');
        try {
          const result: PollResult = id === 'trakt' ? await traktPollDevice(device) : await simklPollPin(device);
          if (run !== pollRun.current) return;
          if (result === 'approved') {
            stop();
            setSettings(readSyncSettings());
            return toast(`${HELP[id].name} connected`);
          }
          // Trakt asks for a slower pace with 429: wait five more seconds between checks.
          if (result === 'slow') delay += 5000;
          timer.current = setTimeout(tick, delay);
        } catch (error: any) {
          if (run === pollRun.current) stop(error?.message || 'Sign-in failed. Try again.');
        }
      };
      timer.current = setTimeout(tick, delay);
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

      {(Object.keys(HELP) as SyncServiceId[]).map(id => {
        const account = settings[id];
        const connected = Boolean(account.accessToken);
        const status = describeAccount(id, account);
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
            {!connected ? (
              <>
                <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 8}}>{HELP[id].steps}</AppText>
                {id === 'trakt' ? field(id, 'clientId', 'Client ID', {next: 'trakt.clientSecret'}) : null}
                {id === 'trakt' ? field(id, 'clientSecret', 'Client Secret', {secret: true, onGo: () => startDevice('trakt')}) : null}
                {id === 'simkl' ? field(id, 'clientId', 'Client ID', {onGo: () => startDevice('simkl')}) : null}
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
                  <AppText role="titleLarge" selectable style={{color: colors.primary, marginTop: 8}}>Code {code.code.userCode} (copied) · enter it at {code.code.verificationUrl}</AppText>
                ) : null}
              </>
            ) : null}
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8}}>
              {!connected ? <Chip label="Create app" icon="open-in-new" onPress={() => Linking.openURL(HELP[id].app)} /> : null}
              {!connected && id !== 'anilist' ? <Chip label="Sign in" icon="login" onPress={() => startDevice(id)} /> : null}
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
