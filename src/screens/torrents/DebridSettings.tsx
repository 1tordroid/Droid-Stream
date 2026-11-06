import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {ActivityIndicator, Linking, Pressable, ScrollView, Switch, ToastAndroid, View} from 'react-native';
import {RawTextInput as TextInput} from '../../components/ui/Text';
import Chip from '../../components/torrentSearch/Chip';
import AppText from '../../components/ui/Text';
import {
  DEBRID_SERVICES,
  debridKey,
  readDebridSettings,
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

const DebridSettings = ({navigation}: {navigation: any}) => {
  const colors = useM3Colors();
  const [settings, setSettings] = useState<Settings>(readDebridSettings);
  const [accounts, setAccounts] = useState<Partial<Record<DebridId, DebridAccount | string>>>({});
  const [open, setOpen] = useState<DebridId>();
  const [transfers, setTransfers] = useState<DebridTransfer[]>();
  const [busy, setBusy] = useState(false);

  const save = (next: Settings) => {
    setSettings(next);
    writeDebridSettings(next);
  };

  const check = async (service: DebridService) => {
    const key = debridKey(service.id, settings);
    if (!key) return toast('Enter a key first');
    setAccounts(current => ({...current, [service.id]: 'Checking…'}));
    try {
      const account = await service.account(key);
      setAccounts(current => ({...current, [service.id]: account}));
    } catch (error: any) {
      setAccounts(current => ({...current, [service.id]: `Failed: ${error.message}`}));
    }
  };

  const loadTransfers = async (service: DebridService) => {
    if (!service.list) return;
    setBusy(true);
    try {
      setTransfers(await service.list(debridKey(service.id, settings)));
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
    <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={{padding: 16, paddingBottom: 96}}>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Debrid and cloud</AppText>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
        A debrid or cloud service downloads the torrent on its own fast servers. Popular torrents are often already cached there, so they play at once and save over plain HTTPS at full speed with no peers and no visible IP. Use your own account. Keys stay encrypted on this phone and go only to that service.
      </AppText>

      <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, marginTop: 16, paddingVertical: 4}}>
        {toggle('Show cached badges in search', settings.checkCache, value => save({...settings, checkCache: value}), 'Asks TorBox, Premiumize, Offcloud, and Debrid-Link which results they already have')}
        {toggle('Only show cached results', settings.cachedOnly, value => save({...settings, cachedOnly: value}))}
        {toggle('Pick the main video automatically', settings.autoPickVideo, value => save({...settings, autoPickVideo: value}))}
      </View>

      {DEBRID_SERVICES.map(service => {
        const key = debridKey(service.id, settings);
        const account = accounts[service.id];
        const expanded = open === service.id;
        return (
          <View key={service.id} style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, marginTop: 12, padding: 12}}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${service.name} settings`} onPress={() => setOpen(expanded ? undefined : service.id)} style={{flexDirection: 'row', alignItems: 'center', minHeight: 48}}>
              <MaterialCommunityIcons name={key ? 'check-circle' : 'circle-outline'} size={22} color={key ? colors.primary : colors.outline} />
              <View style={{flex: 1, marginLeft: 12}}>
                <AppText role="titleMedium" style={{color: colors.onSurface}}>{service.name}{settings.preferred === service.id ? ' · preferred' : ''}</AppText>
                <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
                  {service.canCheckCache ? 'Instant cache check' : 'Cache shows after adding'} · {key ? 'connected' : 'not set up'}
                </AppText>
              </View>
              <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={colors.onSurfaceVariant} />
            </Pressable>
            {expanded ? (
              <View style={{marginTop: 8}}>
                <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{service.keyHelp}</AppText>
                {service.id === 'pikpak' && !settings.keys.pikpak && key ? (
                  <AppText role="bodySmall" style={{color: colors.primary, marginTop: 4}}>Using the PikPak account you signed in to under Library.</AppText>
                ) : null}
                <TextInput
                  accessibilityLabel={`${service.name} API key`}
                  placeholder={service.id === 'pikpak' ? 'Access token (lasts about 2 hours; Sign in keeps you signed in)' : 'API key'}
                  placeholderTextColor={colors.outline}
                  defaultValue={settings.keys[service.id] || ''}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  onEndEditing={event => save({...settings, keys: {...settings.keys, [service.id]: event.nativeEvent.text.trim()}})}
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
                  <Chip label={settings.preferred === service.id ? 'Preferred' : 'Make preferred'} icon="star" selected={settings.preferred === service.id} onPress={() => save({...settings, preferred: service.id})} />
                  <Chip label="Get a key" icon="open-in-new" onPress={() => Linking.openURL(service.id === 'pikpak' ? service.keyUrl : service.keyUrl)} />
                  {service.id === 'pikpak' ? <Chip label="Sign in" icon="login" onPress={() => navigation.navigate('WatchListStack', {screen: 'Sources', params: {kind: 'pikpak'}})} /> : null}
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
    </ScrollView>
  );
};

export default DebridSettings;
