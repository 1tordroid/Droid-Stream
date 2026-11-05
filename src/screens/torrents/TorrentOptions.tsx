import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import React, {useState} from 'react';
import {Pressable, ScrollView, ToastAndroid, View} from 'react-native';
import {RawTextInput as TextInput} from '../../components/ui/Text';
import AppText from '../../components/ui/Text';
import {alwaysShowAdvanced, useFeatureVisible} from '../../lib/advancedReveal';
import {settingsStorage} from '../../lib/storage';
import {readTorrentSettings, writeTorrentSettings, type TorrentSettings} from '../../lib/torrent/settings';
import {torrentManager} from '../../lib/torrentManager';
import {useM3Colors} from '../../theme/M3PaletteContext';

const Field = ({label, value, onChange, highlight}: {label: string; value: string; onChange: (value: string) => void; highlight?: boolean}) => {
  const colors = useM3Colors();
  return (
    <View style={{borderWidth: highlight ? 2 : 0, borderColor: colors.primary, borderRadius: 12, marginBottom: 8}}>
      <AppText style={{color: colors.onSurfaceVariant}}>{label}</AppText>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} autoCapitalize="none" placeholderTextColor={colors.onSurfaceVariant} style={{color: colors.onSurface, minHeight: 48}} />
    </View>
  );
};

const TorrentOptions = ({route}: {route?: {params?: {highlight?: string}}}) => {
  const colors = useM3Colors();
  const highlight = route?.params?.highlight;
  const revealed = useFeatureVisible(highlight || '');
  const [settings, setSettings] = useState<TorrentSettings>(readTorrentSettings);
  const save = (next: TorrentSettings) => {
    setSettings(next);
    writeTorrentSettings(next);
  };
  const badge = !settingsStorage.isAdvancedMode() && revealed;
  const [grabber, setGrabber] = useState(() => settingsStorage.clipboardGrabber());
  return (
    <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={{padding: 16}}>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Torrent options</AppText>
      {badge ? (
        <View style={{marginVertical: 8}}>
          <AppText style={{color: colors.primary}}>Advanced</AppText>
          <Pressable accessibilityLabel="Always show advanced options" onPress={alwaysShowAdvanced} style={{minHeight: 44, justifyContent: 'center'}}>
            <AppText style={{color: colors.primary}}>Always show advanced options</AppText>
          </Pressable>
        </View>
      ) : null}
      <Field highlight={highlight === 'torrent-speed'} label="Download limit KB/s (0 is unlimited)" value={String(Math.round(settings.downloadRateLimit / 1024))} onChange={value => save({...settings, downloadRateLimit: Number(value || 0) * 1024})} />
      <Field label="Upload limit KB/s" value={String(Math.round(settings.uploadRateLimit / 1024))} onChange={value => save({...settings, uploadRateLimit: Number(value || 0) * 1024})} />
      <Field label="Max active downloads" value={String(settings.maxActiveDownloads)} onChange={value => save({...settings, maxActiveDownloads: Number(value || 1)})} />
      <Pressable accessibilityLabel="Wi-Fi only torrents" onPress={() => save({...settings, wifiOnly: !settings.wifiOnly})} style={{minHeight: 48, justifyContent: 'center'}}><AppText style={{color: colors.onSurface}}>Wi-Fi only: {settings.wifiOnly ? 'On' : 'Off'}</AppText></Pressable>
      <Pressable accessibilityLabel="Charging only torrents" onPress={() => save({...settings, chargingOnly: !settings.chargingOnly})} style={{minHeight: 48, justifyContent: 'center'}}><AppText style={{color: colors.onSurface}}>Charging only: {settings.chargingOnly ? 'On' : 'Off'}</AppText></Pressable>
      <Pressable accessibilityLabel="Pause torrents in battery saver" onPress={() => save({...settings, pauseOnBatterySaver: !settings.pauseOnBatterySaver})} style={{minHeight: 48, justifyContent: 'center'}}><AppText style={{color: colors.onSurface}}>Battery saver pause: {settings.pauseOnBatterySaver ? 'On' : 'Off'}</AppText></Pressable>
      <Pressable accessibilityLabel="VPN kill switch" onPress={() => save({...settings, requireVpn: !settings.requireVpn})} style={{minHeight: 48, justifyContent: 'center', borderWidth: highlight === 'torrent-vpn' ? 2 : 0, borderColor: colors.primary}}>
        <AppText style={{color: colors.onSurface}}>VPN kill switch: {settings.requireVpn ? 'On' : 'Off'}</AppText>
      </Pressable>
      <Field highlight={highlight === 'torrent-proxy'} label="Proxy host (empty disables)" value={settings.proxyHost} onChange={value => save({...settings, proxyHost: value, proxyType: value ? 2 : 0})} />
      <Field label="Proxy port" value={String(settings.proxyPort || '')} onChange={value => save({...settings, proxyPort: Number(value || 0)})} />
      <Pressable accessibilityLabel="Toggle seeding" onPress={() => save({...settings, seedingEnabled: !settings.seedingEnabled, maxActiveSeeds: settings.seedingEnabled ? 0 : 2})} style={{minHeight: 48, justifyContent: 'center'}}>
        <AppText style={{color: colors.onSurface}}>Seeding: {settings.seedingEnabled ? 'On' : 'Off'}</AppText>
      </Pressable>
      <Field label="Share ratio percent (100 = 1.0, 0 = no cap)" value={String(settings.shareRatioPercent)} onChange={value => save({...settings, shareRatioPercent: Number(value || 0)})} />
      <Pressable accessibilityLabel="Toggle DHT" onPress={() => save({...settings, dht: !settings.dht})} style={{minHeight: 48, justifyContent: 'center'}}><AppText style={{color: colors.onSurface}}>DHT {settings.dht ? 'on' : 'off'} · PEX {settings.pex ? 'on' : 'off'} · LSD {settings.lsd ? 'on' : 'off'} · uTP {settings.utp ? 'on' : 'off'}</AppText></Pressable>
      <Pressable accessibilityLabel="Cycle encryption" onPress={() => save({...settings, encryption: (settings.encryption + 1) % 3})} style={{minHeight: 48, justifyContent: 'center'}}>
        <AppText style={{color: colors.onSurface}}>Encryption: {['Forced', 'Enabled', 'Disabled'][settings.encryption]}</AppText>
      </Pressable>
      <Pressable accessibilityLabel="Toggle public trackers" onPress={() => save({...settings, publicTrackers: !settings.publicTrackers})} style={{minHeight: 48, justifyContent: 'center'}}><AppText style={{color: colors.onSurface}}>Public trackers: {settings.publicTrackers ? 'On' : 'Off'}</AppText></Pressable>
      <Field highlight={highlight === 'torrent-blocklist'} label="IP blocklist" value={settings.blocklist} onChange={value => save({...settings, blocklist: value})} />
      <Pressable accessibilityLabel="Apply blocklist" onPress={async () => {
        const result = await torrentManager.applyBlocklist(settings.blocklist);
        ToastAndroid.show(result.applied ? `Blocked ${result.ranges} ranges` : result.reason, ToastAndroid.LONG);
      }} style={{minHeight: 48, justifyContent: 'center'}}><AppText style={{color: colors.primary}}>Apply blocklist</AppText></Pressable>
      <View style={{borderWidth: highlight === 'torrent-rss' ? 2 : 0, borderColor: colors.primary, borderRadius: 12, marginBottom: 8}}>
        <AppText role="titleSmall" style={{color: colors.onSurface, marginTop: 8}}>RSS auto-download</AppText>
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>Feeds are checked while the Torrents tab is open. New items whose titles contain every keyword start downloading.</AppText>
        {settings.rssFeeds.map((feed, index) => (
          <View key={feed.id} style={{borderTopWidth: index ? 1 : 0, borderColor: colors.outlineVariant, marginTop: 8}}>
            <Field label={`Feed ${index + 1} URL`} value={feed.url} onChange={value => save({...settings, rssFeeds: settings.rssFeeds.map(item => (item.id === feed.id ? {...item, url: value} : item))})} />
            <Field label="Keywords (all must match, e.g. 1080p show name)" value={feed.keywords} onChange={value => save({...settings, rssFeeds: settings.rssFeeds.map(item => (item.id === feed.id ? {...item, keywords: value} : item))})} />
            <Pressable accessibilityLabel={`Remove feed ${index + 1}`} onPress={() => save({...settings, rssFeeds: settings.rssFeeds.filter(item => item.id !== feed.id)})} style={{minHeight: 44, justifyContent: 'center'}}>
              <AppText style={{color: colors.error}}>Remove feed</AppText>
            </Pressable>
          </View>
        ))}
        <Pressable accessibilityLabel="Add RSS feed" onPress={() => save({...settings, rssFeeds: [...settings.rssFeeds, {id: String(Date.now()), url: '', keywords: '', seen: []}]})} style={{minHeight: 48, justifyContent: 'center'}}>
          <AppText style={{color: colors.primary}}>Add a feed</AppText>
        </Pressable>
      </View>
      <Pressable accessibilityLabel="Clipboard magnet grabber" onPress={() => {
        const next = grabber === 'off' ? 'ask' : 'off';
        settingsStorage.setClipboardGrabber(next);
        setGrabber(next);
      }} style={{minHeight: 48, justifyContent: 'center'}}>
        <AppText style={{color: colors.onSurface}}>Offer copied magnets and links: {grabber === 'off' ? 'Off' : 'On'}</AppText>
      </Pressable>
      <Pressable accessibilityLabel="Choose completed folder" onPress={async () => {
        const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permission.granted) save({...settings, saveTreeUri: permission.directoryUri});
      }} style={{minHeight: 48, justifyContent: 'center'}}><AppText style={{color: colors.primary}}>Choose folder for completed files</AppText></Pressable>
      <Pressable accessibilityLabel="Create torrent" onPress={async () => {
        const picked = await DocumentPicker.getDocumentAsync({copyToCacheDirectory: true});
        if (picked.canceled || !picked.assets[0]) return;
        const asset = picked.assets[0];
        const output = `${FileSystem.cacheDirectory}created-${Date.now()}.torrent`;
        const path = await torrentManager.createTorrent(asset.uri.replace('file://', ''), [], 'Created by Droid Stream', output.replace('file://', ''));
        ToastAndroid.show(`Created ${path}`, ToastAndroid.LONG);
      }} style={{minHeight: 48, justifyContent: 'center', borderWidth: highlight === 'torrent-create' ? 2 : 0, borderColor: colors.primary}}>
        <AppText style={{color: colors.primary}}>Create a .torrent from a file</AppText>
      </Pressable>
    </ScrollView>
  );
};

export default TorrentOptions;
