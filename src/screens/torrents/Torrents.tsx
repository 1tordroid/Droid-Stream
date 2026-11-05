import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as DocumentPicker from 'expo-document-picker';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FlatList, Pressable, TextInput, ToastAndroid, View} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import MoreOptions from '../../components/MoreOptions';
import AppText from '../../components/ui/Text';
import {TVFocusable} from '../../components/tv';
import {showUndo} from '../../components/UndoSnackbar';
import {transferAllowed} from '../../lib/downloadEngine/planner';
import {setTransfersOpen} from '../../lib/downloadEngine/queueStore';
import {settingsStorage} from '../../lib/storage';
import {feedItemMatches, parseFeedLinks} from '../../lib/torrent/rss';
import {readStoredTorrents, readTorrentSettings, writeStoredTorrents, writeTorrentSettings, type StoredTorrent} from '../../lib/torrent/settings';
import {torrentManager, type TorrentRow} from '../../lib/torrentManager';
import {extensionStorage} from '../../lib/storage/extensionStorage';
import {providerManager} from '../../lib/services/ProviderManager';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {useFeatureVisible} from '../../lib/advancedReveal';

const tap = () => {
  if (settingsStorage.isHapticFeedbackEnabled()) {
    ReactNativeHapticFeedback.trigger('effectTick', {enableVibrateFallback: true, ignoreAndroidSystemSettings: false});
  }
};

const Torrents = ({navigation, route}: {navigation: any; route?: {params?: {highlight?: string}}}) => {
  const colors = useM3Colors();
  const highlight = route?.params?.highlight;
  const revealed = useFeatureVisible(highlight || 'torrents');
  const [rows, setRows] = useState<TorrentRow[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'downloading' | 'paused' | 'done'>('all');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState(() => !readTorrentSettings().acknowledged);
  const [menu, setMenu] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setRows(await torrentManager.listTorrents());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    const stored = readStoredTorrents();
    stored.forEach(item => {
      torrentManager.enqueue(item.source).catch(() => undefined);
    });
    const timer = setInterval(() => {
      refresh().catch(() => undefined);
      applyPolicy().catch(() => undefined);
    }, 2000);
    refresh().catch(() => undefined);
    return () => clearInterval(timer);
  }, [refresh]);

  const visible = useMemo(() => rows.filter(row => {
    const text = `${row.name} ${row.infoHash}`.toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (filter === 'downloading') return !row.paused && row.progress < 1;
    if (filter === 'paused') return row.paused || row.stopped;
    if (filter === 'done') return row.progress >= 1;
    return true;
  }), [rows, query, filter]);

  const add = async (source: string) => {
    tap();
    const added = await torrentManager.enqueue(source);
    const next = readStoredTorrents().filter(item => item.infoHash !== added.infoHash);
    next.unshift({infoHash: added.infoHash, source, name: added.name || added.infoHash});
    writeStoredTorrents(next);
    setAdding(false);
    await refresh();
  };

  return (
    <View style={{flex: 1, backgroundColor: colors.background, padding: 16}}>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
        <AppText role="headlineSmallEmphasized" style={{color: highlight ? colors.primary : colors.onBackground}}>Torrents</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="Add torrent" onPress={() => setAdding(true)} style={{minHeight: 48, justifyContent: 'center'}}>
          <AppText style={{color: colors.primary}}>Add</AppText>
        </Pressable>
      </View>
      {notice ? (
        <View style={{backgroundColor: colors.surfaceContainerHigh, borderRadius: 16, padding: 12, marginVertical: 8}}>
          <AppText role="bodyMedium" style={{color: colors.onSurface}}>Your IP is visible to peers unless you use a VPN. Only download files you have the rights to.</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss torrent notice" onPress={() => { writeTorrentSettings({...readTorrentSettings(), acknowledged: true}); setNotice(false); }} style={{minHeight: 44, justifyContent: 'center'}}>
            <AppText style={{color: colors.primary}}>I understand</AppText>
          </Pressable>
        </View>
      ) : null}
      <TVFocusable
        accessibilityRole="button"
        accessibilityLabel="Search torrent sites"
        onPress={() => navigation.navigate('TorrentSearch')}
        borderRadius={28}
        style={{flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerHigh, borderRadius: 28, minHeight: 52, paddingHorizontal: 16, marginVertical: 8}}>
        <MaterialCommunityIcons name="magnify" size={22} color={colors.onSurfaceVariant} />
        <AppText role="bodyLarge" style={{color: colors.onSurfaceVariant, marginLeft: 12, flex: 1}}>Search movies, shows, anime on every site</AppText>
        <MaterialCommunityIcons name="lightning-bolt" size={20} color={colors.primary} />
      </TVFocusable>
      <View style={{flexDirection: 'row', gap: 16, marginBottom: 4}}>
        <Pressable accessibilityRole="button" accessibilityLabel="Debrid and cloud services" onPress={() => navigation.navigate('DebridSettings')} style={{minHeight: 44, justifyContent: 'center'}}>
          <AppText style={{color: colors.primary}}>TorBox, Real-Debrid, PikPak…</AppText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Torrent sites" onPress={() => navigation.navigate('TorrentSources')} style={{minHeight: 44, justifyContent: 'center'}}>
          <AppText style={{color: colors.primary}}>Sites</AppText>
        </Pressable>
      </View>
      <TextInput value={query} onChangeText={setQuery} placeholder="Filter my torrents" placeholderTextColor={colors.onSurfaceVariant} accessibilityLabel="Filter my torrents" style={{color: colors.onSurface, minHeight: 48, marginBottom: 8}} />
      <View style={{flexDirection: 'row', gap: 12, marginBottom: 8}}>
        {(['all', 'downloading', 'paused', 'done'] as const).map(item => (
          <Pressable key={item} accessibilityRole="button" accessibilityLabel={`Filter ${item}`} onPress={() => setFilter(item)} style={{minHeight: 44, justifyContent: 'center'}}>
            <AppText style={{color: filter === item ? colors.primary : colors.onSurfaceVariant}}>{item}</AppText>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={visible}
        keyExtractor={item => item.infoHash}
        ListEmptyComponent={<AppText style={{color: colors.onSurfaceVariant}}>No torrents yet. Add a magnet or a .torrent file.</AppText>}
        renderItem={({item}) => (
          <TVFocusable
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${Math.round(item.progress * 100)} percent`}
            onPress={() => navigation.navigate('TorrentDetails', {infoHash: item.infoHash})}
            onLongPress={() => setMenu(menu === item.infoHash ? undefined : item.infoHash)}
            style={{paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.outlineVariant, ...(highlight === 'torrents' && revealed ? {borderColor: colors.primary, borderWidth: 1} : {})}}>
            <AppText style={{color: colors.onSurface}}>{item.name}</AppText>
            <AppText style={{color: colors.onSurfaceVariant}}>{Math.round(item.progress * 100)}% · {Math.round(item.downloadRate / 1024)} KB/s · {item.paused ? 'Paused' : item.state}</AppText>
            <View style={{height: 4, backgroundColor: colors.surfaceContainerHighest, borderRadius: 4, marginTop: 6}}>
              <View style={{width: `${Math.min(100, item.progress * 100)}%`, height: 4, backgroundColor: colors.primary, borderRadius: 4}} />
            </View>
            <View style={{flexDirection: 'row', gap: 16, marginTop: 8}}>
              <Pressable accessibilityLabel={item.paused ? 'Resume torrent' : 'Pause torrent'} onPress={() => act(item, item.paused ? 'resume' : 'pause', refresh)} style={{minHeight: 44, justifyContent: 'center'}}><AppText style={{color: colors.primary}}>{item.paused ? 'Resume' : 'Pause'}</AppText></Pressable>
              <Pressable accessibilityLabel="Play torrent" onPress={() => play(item, navigation)} style={{minHeight: 44, justifyContent: 'center'}}><AppText style={{color: colors.primary}}>Play</AppText></Pressable>
              <Pressable accessibilityLabel="Delete torrent" onPress={() => remove(item, refresh)} style={{minHeight: 44, justifyContent: 'center'}}><AppText style={{color: colors.error}}>Delete</AppText></Pressable>
              <Pressable accessibilityLabel="More torrent actions" onPress={() => setMenu(menu === item.infoHash ? undefined : item.infoHash)} style={{minHeight: 44, justifyContent: 'center'}}><MaterialCommunityIcons name="dots-vertical" size={22} color={colors.onSurfaceVariant} /></Pressable>
            </View>
            {menu === item.infoHash ? (
              <Pressable accessibilityLabel="Torrent speed limit" onPress={() => navigation.navigate('TorrentOptions', {highlight: 'torrent-speed'})} style={{minHeight: 44, justifyContent: 'center'}}>
                <AppText style={{color: colors.primary}}>Speed limit and other options</AppText>
              </Pressable>
            ) : null}
          </TVFocusable>
        )}
      />
      {adding ? <AddSheet onClose={() => setAdding(false)} onAdd={add} /> : null}
      <MoreOptions id="torrent-list" forceOpen={Boolean(highlight && highlight !== 'torrents')}>
        <Pressable accessibilityLabel="Torrent options" onPress={() => navigation.navigate('TorrentOptions', {highlight})} style={{minHeight: 48, justifyContent: 'center'}}>
          <AppText style={{color: colors.primary}}>Speed, schedule, proxy, VPN, RSS, and create torrent</AppText>
        </Pressable>
      </MoreOptions>
    </View>
  );
};

const AddSheet = ({onClose, onAdd}: {onClose: () => void; onAdd: (source: string) => Promise<void>}) => {
  const colors = useM3Colors();
  const [magnet, setMagnet] = useState('');
  const [url, setUrl] = useState('');
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<{title: string; link: string}[]>([]);
  return (
    <View style={{backgroundColor: colors.surfaceContainerHigh, borderRadius: 20, padding: 16, marginTop: 8}}>
      <TextInput value={magnet} onChangeText={setMagnet} placeholder="magnet:?xt=urn:btih:..." placeholderTextColor={colors.onSurfaceVariant} accessibilityLabel="Magnet link" autoCapitalize="none" style={{color: colors.onSurface, minHeight: 48}} />
      <Pressable accessibilityLabel="Start magnet" onPress={() => magnet.trim() && onAdd(magnet.trim()).catch(showError)} style={{minHeight: 48, justifyContent: 'center'}}><AppText style={{color: colors.primary}}>Start magnet</AppText></Pressable>
      <Pressable accessibilityLabel="Pick torrent file" onPress={async () => {
        const picked = await DocumentPicker.getDocumentAsync({copyToCacheDirectory: true, type: '*/*'});
        if (!picked.canceled && picked.assets[0]?.uri) await onAdd(picked.assets[0].uri);
      }} style={{minHeight: 48, justifyContent: 'center'}}><AppText style={{color: colors.primary}}>Pick a .torrent file</AppText></Pressable>
      <MoreOptions id="torrent-add">
        <TextInput value={url} onChangeText={setUrl} placeholder="https://…/file.torrent" placeholderTextColor={colors.onSurfaceVariant} accessibilityLabel="Torrent URL" autoCapitalize="none" style={{color: colors.onSurface, minHeight: 48}} />
        <Pressable accessibilityLabel="Add torrent URL" onPress={() => url.trim() && onAdd(url.trim()).catch(showError)} style={{minHeight: 44, justifyContent: 'center'}}><AppText style={{color: colors.primary}}>Add URL</AppText></Pressable>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search your providers" placeholderTextColor={colors.onSurfaceVariant} accessibilityLabel="Search providers for a magnet" style={{color: colors.onSurface, minHeight: 48}} />
        <Pressable accessibilityLabel="Search added providers" onPress={async () => {
          const providers = extensionStorage.getInstalledProviders().filter(provider => !provider.disabled);
          if (!providers.length) {
            ToastAndroid.show('No Vega provider is installed. Use Search torrent sites instead.', ToastAndroid.LONG);
            return;
          }
          const found: {title: string; link: string}[] = [];
          for (const provider of providers.slice(0, 4)) {
            try {
              const posts = await providerManager.getSearchPosts({searchQuery: search, page: 1, providerValue: provider.value, signal: new AbortController().signal});
              posts.forEach(post => {
                if (/^magnet:|\.torrent(\?|$)/i.test(post.link)) found.push({title: post.title, link: post.link});
              });
            } catch {
              // A provider that fails is skipped. Nothing is fetched from a built-in index.
            }
          }
          setHits(found);
          if (!found.length) ToastAndroid.show('No magnet or torrent link from your providers.', ToastAndroid.LONG);
        }} style={{minHeight: 44, justifyContent: 'center'}}><AppText style={{color: colors.primary}}>Search providers</AppText></Pressable>
        {hits.map(hit => (
          <Pressable key={hit.link} accessibilityLabel={`Add ${hit.title}`} onPress={() => onAdd(hit.link).catch(showError)} style={{minHeight: 44, justifyContent: 'center'}}>
            <AppText style={{color: colors.onSurface}}>{hit.title}</AppText>
          </Pressable>
        ))}
      </MoreOptions>
      <Pressable accessibilityLabel="Close add torrent" onPress={onClose} style={{minHeight: 44, justifyContent: 'center'}}><AppText style={{color: colors.onSurfaceVariant}}>Close</AppText></Pressable>
    </View>
  );
};

const play = async (row: TorrentRow, navigation: any) => {
  try {
    const files = await torrentManager.getFiles(row.infoHash);
    const video = files.find(file => /\.(mkv|mp4|avi|mov|webm)$/i.test(file.name)) || files[0];
    if (!video) throw new Error('No file yet');
    await torrentManager.prepareVideoFile(row.infoHash, video.index, false, true);
    const url = await torrentManager.getStreamUrl(row.infoHash, video.index);
    navigation.navigate('Player', {
      linkIndex: 0,
      episodeList: [{title: video.name, link: url}],
      directUrl: url,
      type: 'torrent',
      primaryTitle: row.name,
      poster: {},
      initialStream: {server: 'Torrent', link: url, type: 'torrent'},
    });
  } catch (error: any) {
    showError(error);
  }
};

const act = async (row: TorrentRow, action: 'pause' | 'resume', refresh: () => Promise<void>) => {
  tap();
  if (action === 'pause') await torrentManager.setStopped(row.infoHash, true);
  else await torrentManager.setStopped(row.infoHash, false);
  await refresh();
};

const remove = (row: TorrentRow, refresh: () => Promise<void>) => {
  const stored = readStoredTorrents();
  writeStoredTorrents(stored.filter(item => item.infoHash !== row.infoHash));
  showUndo('Torrent removed', () => writeStoredTorrents(stored), () => {
    torrentManager.deleteTorrent(row.infoHash, true).catch(() => undefined);
    refresh().catch(() => undefined);
  });
  refresh().catch(() => undefined);
};

const showError = (error: any) => ToastAndroid.show(error?.message || 'Torrent action failed', ToastAndroid.LONG);

const applyPolicy = async () => {
  const settings = readTorrentSettings();
  const network = await torrentManager.networkStatus();
  const decision = transferAllowed({
    wifiOnly: settings.wifiOnly,
    onWifi: network.wifi,
    chargingOnly: settings.chargingOnly,
    charging: network.charging,
    pauseOnBatterySaver: settings.pauseOnBatterySaver,
    powerSave: network.powerSave,
    requireVpn: settings.requireVpn,
    vpnConnected: network.vpn,
    scheduleEnabled: settings.scheduleEnabled,
    windows: settings.windows,
    now: new Date(),
  });
  await torrentManager.applySettings({
    downloadRateLimit: settings.downloadRateLimit,
    uploadRateLimit: settings.uploadRateLimit,
    maxActiveDownloads: settings.maxActiveDownloads,
    maxActiveSeeds: settings.maxActiveSeeds,
    seedingEnabled: settings.seedingEnabled,
    seedTimeLimitSeconds: settings.seedTimeLimitSeconds,
    shareRatioPercent: settings.shareRatioPercent,
    dht: settings.dht,
    lsd: settings.lsd,
    pex: settings.pex,
    utp: settings.utp,
    encryption: settings.encryption,
    proxyType: settings.proxyType,
    proxyHost: settings.proxyHost,
    proxyPort: settings.proxyPort,
    proxyUsername: settings.proxyUsername,
    proxyPassword: settings.proxyPassword,
    publicTrackers: settings.publicTrackers,
    bindAddress: settings.requireVpn ? network.vpnAddress : '',
  });
  await torrentManager.setTransfersAllowed(decision.allowed);
  setTransfersOpen(decision.allowed);
  if (settings.blocklist) await torrentManager.applyBlocklist(settings.blocklist);
  for (const feed of settings.rssFeeds) {
    try {
      const xml = await (await fetch(feed.url)).text();
      const fresh = parseFeedLinks(xml).filter(item => feedItemMatches(item.title, feed.keywords) && !feed.seen.includes(item.link));
      for (const item of fresh) {
        const added = await torrentManager.enqueue(item.link);
        const stored: StoredTorrent[] = readStoredTorrents();
        writeStoredTorrents([{infoHash: added.infoHash, source: item.link, name: item.title}, ...stored]);
        feed.seen.push(item.link);
      }
    } catch {
      // A feed that fails waits for the next check.
    }
  }
  if (settings.rssFeeds.length) writeTorrentSettings(settings);
};

export default Torrents;
