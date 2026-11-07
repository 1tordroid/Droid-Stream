import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Linking, Pressable, Switch, ToastAndroid, View} from 'react-native';
import KeyboardForm from '../../components/ui/KeyboardForm';
import {RawTextInput as TextInput} from '../../components/ui/Text';
import Chip from '../../components/torrentSearch/Chip';
import AppText from '../../components/ui/Text';
import {
  authProblemLabel,
  DebridAuthError,
  DEBRID_SERVICES,
  debridKey,
  readDebridAuthStates,
  readDebridSettings,
  subscribeDebridAuth,
  writeDebridSettings,
  type DebridAccount,
  type DebridId,
  type DebridService,
  type DebridSettings as Settings,
  type DebridTransfer,
} from '../../lib/debrid';
import {downloadDebridFiles, playDebridFile} from '../../lib/torrentSearch/actions';
import {useM3Colors} from '../../theme/M3PaletteContext';

const toast = (text: string) => ToastAndroid.show(text, ToastAndroid.LONG);

type KeyDrafts = Partial<Record<DebridId, string>>;

/**
 * PikPak sign-in lives on Library > Sources. From the Library stack it opens
 * there; from the Torrents tab it opens in the Library tab and Back returns
 * here.
 */
export const openPikPakSignIn = (navigation: any): void => {
  const routeNames: string[] | undefined = navigation.getState?.()?.routeNames;
  if (routeNames?.includes('Sources')) {
    navigation.navigate('Sources', {kind: 'pikpak'});
  } else {
    navigation.navigate('WatchListStack', {screen: 'Sources', params: {kind: 'pikpak', returnTo: {tab: 'TorrentsStack', screen: 'DebridSettings'}}});
  }
};

const DebridSettings = ({navigation}: {navigation: any}) => {
  const colors = useM3Colors();
  const [settings, setSettings] = useState<Settings>(readDebridSettings);
  // Always the latest settings, so a handler that saves a key and then uses it reads the new one.
  const settingsRef = useRef(settings);
  // What is typed in a key field and not saved yet. Buttons run while the field
  // still has focus, so each handler saves the typed key first.
  const [drafts, setDrafts] = useState<KeyDrafts>({});
  const draftsRef = useRef<KeyDrafts>({});
  const [accounts, setAccounts] = useState<Partial<Record<DebridId, DebridAccount | string>>>({});
  const [open, setOpen] = useState<DebridId>();
  const [transfers, setTransfers] = useState<DebridTransfer[]>();
  const [busy, setBusy] = useState(false);
  // Any call, from this screen or elsewhere, can learn that a key was refused.
  const [authStates, setAuthStates] = useState(readDebridAuthStates);
  useEffect(() => subscribeDebridAuth(() => setAuthStates(readDebridAuthStates())), []);

  const save = (next: Settings) => {
    // A changed key has not been checked yet, so the last result for the old one goes.
    const previous = settingsRef.current;
    const changed = DEBRID_SERVICES.filter(({id}) => (next.keys[id] || '') !== (previous.keys[id] || '')).map(({id}) => id);
    if (changed.length) setAccounts(current => Object.fromEntries(Object.entries(current).filter(([id]) => !changed.includes(id as DebridId))));
    settingsRef.current = next;
    setSettings(next);
    writeDebridSettings(next);
  };

  /** Changes the settings saved right now, keeping any key saved earlier in the same handler. */
  const update = (change: (current: Settings) => Settings) => save(change(settingsRef.current));

  const setDraft = (id: DebridId, text: string) => {
    draftsRef.current = {...draftsRef.current, [id]: text};
    setDrafts(draftsRef.current);
  };

  /** Saves the key typed for `id`, if any, and returns the settings to use from now on. */
  const commitKey = (id: DebridId): Settings => {
    const draft = draftsRef.current[id];
    if (draft === undefined) return settingsRef.current;
    const rest = {...draftsRef.current};
    delete rest[id];
    draftsRef.current = rest;
    setDrafts(rest);
    const value = draft.trim();
    const current = settingsRef.current;
    if ((current.keys[id] || '') === value) return current;
    const next = {...current, keys: {...current.keys, [id]: value}};
    save(next);
    return next;
  };

  /** Opens or closes a service card. A key typed in the card being closed is saved, not lost. */
  const toggleOpen = (id: DebridId) => {
    if (open) commitKey(open);
    setOpen(open === id ? undefined : id);
  };

  const check = async (service: DebridService, saved: Settings = commitKey(service.id)) => {
    const key = debridKey(service.id, saved);
    if (!key) return toast('Enter a key first');
    setAccounts(current => ({...current, [service.id]: 'Checking…'}));
    try {
      const account = await service.account(key);
      setAccounts(current => ({...current, [service.id]: account}));
    } catch (error: any) {
      // A refused key gets the short label; this screen is where it is replaced.
      const reason = error instanceof DebridAuthError ? authProblemLabel(error.state) : error.message;
      setAccounts(current => ({...current, [service.id]: `Failed: ${reason}`}));
    }
  };

  const loadTransfers = async (service: DebridService) => {
    if (!service.list) return;
    const saved = commitKey(service.id);
    setBusy(true);
    try {
      setTransfers(await service.list(debridKey(service.id, saved)));
    } catch (error: any) {
      toast(error.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (label: string, value: boolean, onChange: (value: boolean) => void, detail?: string) => (
    <View style={{flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 12}}>
      <View style={{flex: 1}}>
        <AppText role="bodyLarge" style={{color: colors.onSurface}}>{label}</AppText>
        {detail ? <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{detail}</AppText> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} thumbColor={value ? colors.primary : undefined} />
    </View>
  );

  return (
    <KeyboardForm style={{backgroundColor: colors.background}} contentContainerStyle={{padding: 16, paddingBottom: 96}}>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Debrid and cloud</AppText>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
        A debrid or cloud service downloads the torrent on its own fast servers. Popular torrents are often already cached there, so they play at once and save over plain HTTPS at full speed with no peers and no visible IP. Use your own account. Keys stay encrypted on this phone and go only to that service.
      </AppText>

      <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, marginTop: 16, paddingVertical: 4}}>
        {toggle('Show cached badges in search', settings.checkCache, value => update(current => ({...current, checkCache: value})), 'Asks TorBox, Premiumize, Offcloud, and Debrid-Link which results they already have')}
        {toggle('Only show cached results', settings.cachedOnly, value => update(current => ({...current, cachedOnly: value})))}
        {toggle('Pick the main video automatically', settings.autoPickVideo, value => update(current => ({...current, autoPickVideo: value})))}
      </View>

      {DEBRID_SERVICES.map(service => {
        const key = debridKey(service.id, settings);
        const account = accounts[service.id];
        const expanded = open === service.id;
        const problem = key ? authProblemLabel(authStates[service.id]) : undefined;
        return (
          <View key={service.id} style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, marginTop: 12, padding: 12}}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${service.name} settings`} onPress={() => toggleOpen(service.id)} style={{flexDirection: 'row', alignItems: 'center', minHeight: 48}}>
              <MaterialCommunityIcons name={problem ? 'alert-circle' : key ? 'check-circle' : 'circle-outline'} size={22} color={problem ? colors.error : key ? colors.primary : colors.outline} />
              <View style={{flex: 1, marginLeft: 12}}>
                <AppText role="titleMedium" style={{color: colors.onSurface}}>{service.name}{settings.preferred === service.id ? ' · preferred' : ''}</AppText>
                <AppText role="bodySmall" style={{color: problem ? colors.error : colors.onSurfaceVariant}}>
                  {service.canCheckCache ? 'Instant cache check' : 'Cache shows after adding'} · {problem || (key ? 'connected' : 'not set up')}
                </AppText>
              </View>
              <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={colors.onSurfaceVariant} />
            </Pressable>
            {expanded ? (
              <View style={{marginTop: 8}}>
                <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{service.keyHelp}</AppText>
                {problem && authStates[service.id] === 'blocked' ? (
                  <AppText role="bodySmall" style={{color: colors.error, marginTop: 4}}>After you confirm it, tap Check account.</AppText>
                ) : null}
                {service.id === 'pikpak' && !settings.keys.pikpak && key ? (
                  <AppText role="bodySmall" style={{color: colors.primary, marginTop: 4}}>Using the PikPak account you signed in to under Library.</AppText>
                ) : null}
                <TextInput
                  accessibilityLabel={`${service.name} API key`}
                  placeholder={service.id === 'pikpak' ? 'Access token (lasts about 2 hours; Sign in keeps you signed in)' : 'API key'}
                  placeholderTextColor={colors.outline}
                  value={drafts[service.id] ?? settings.keys[service.id] ?? ''}
                  onChangeText={text => setDraft(service.id, text)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  returnKeyType="go"
                  onSubmitEditing={() => check(service)}
                  onEndEditing={event => {
                    const text = event?.nativeEvent?.text;
                    if (typeof text === 'string') setDraft(service.id, text);
                    commitKey(service.id);
                  }}
                  style={{color: colors.onSurface, minHeight: 48, borderBottomWidth: 1, borderColor: colors.outlineVariant, marginVertical: 8}}
                />
                {typeof account === 'string' ? (
                  <AppText role="bodySmall" style={{color: account.startsWith('Failed') ? colors.error : colors.onSurfaceVariant}}>{account}</AppText>
                ) : account ? (
                  <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
                    {account.username} · {account.premium ? 'premium' : 'free'}{account.expiresAt ? ` until ${new Date(account.expiresAt).toLocaleDateString()}` : ''}
                  </AppText>
                ) : null}
                <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8}}>
                  <Chip label="Check account" icon="account-check" onPress={() => check(service)} />
                  <Chip label={settings.preferred === service.id ? 'Preferred' : 'Make preferred'} icon="star" selected={settings.preferred === service.id} onPress={() => {
                    commitKey(service.id);
                    update(current => ({...current, preferred: service.id}));
                  }} />
                  <Chip label="Get a key" icon="open-in-new" onPress={() => Linking.openURL(service.id === 'pikpak' ? service.keyUrl : service.keyUrl)} />
                  {service.id === 'pikpak' ? <Chip label="Sign in" icon="login" onPress={() => {
                    commitKey(service.id);
                    openPikPakSignIn(navigation);
                  }} /> : null}
                  {service.list && key ? <Chip label="My transfers" icon="format-list-bulleted" onPress={() => loadTransfers(service)} /> : null}
                </View>
                {busy ? <ActivityIndicator color={colors.primary} style={{marginTop: 8}} /> : null}
                {transfers && open === service.id ? (
                  <View style={{marginTop: 8}}>
                    {transfers.length ? null : <AppText style={{color: colors.onSurfaceVariant}}>No transfers.</AppText>}
                    {transfers.slice(0, 50).map(transfer => (
                      <View key={transfer.id} style={{borderTopWidth: 1, borderColor: colors.outlineVariant, paddingVertical: 8}}>
                        <AppText role="bodyMedium" numberOfLines={2} style={{color: colors.onSurface}}>{transfer.name}</AppText>
                        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{transfer.ready ? 'Ready' : `${Math.round(transfer.progress * 100)}% · ${transfer.status}`}</AppText>
                        {transfer.ready ? (
                          <View style={{flexDirection: 'row', gap: 8, marginTop: 4}}>
                            <Chip label="Play" icon="play" onPress={async () => {
                              try {
                                const full = await service.status(key, transfer.id);
                                const video = full.files.slice().sort((a, b) => b.size - a.size)[0];
                                if (video) await playDebridFile({service, transfer: full, files: full.files}, video, navigation, full.name);
                              } catch (error: any) {
                                toast(error.message);
                              }
                            }} />
                            <Chip label="Download" icon="download" onPress={async () => {
                              try {
                                const full = await service.status(key, transfer.id);
                                toast(`${await downloadDebridFiles({service, transfer: full, files: full.files}, full.files)} files queued`);
                              } catch (error: any) {
                                toast(error.message);
                              }
                            }} />
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </KeyboardForm>
  );
};

export default DebridSettings;
