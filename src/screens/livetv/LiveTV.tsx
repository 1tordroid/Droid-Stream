import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, Image, ScrollView, ToastAndroid, View, useWindowDimensions, type TextInputInstance} from 'react-native';
import Chip from '../../components/torrentSearch/Chip';
import {TVFocusable} from '../../components/tv';
import Button from '../../components/ui/Button';
import KeyboardForm from '../../components/ui/KeyboardForm';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import {isTV} from '../../lib/tv';
import {canLoadEpg, loadNowNext, type NowNext} from '../../lib/livetv/epg';
import {channelGroups, filterChannels, type LiveChannel} from '../../lib/livetv/m3u';
import {
  addPlaylist,
  getJioServer,
  jioEpgUrl,
  listFavourites,
  listPlaylists,
  listRecent,
  listSources,
  loadPlaylist,
  pushRecent,
  readCachedPlaylist,
  removePlaylist,
  setJioServer,
  toggleFavourite,
  type JioQuality,
  type LiveSource,
  type SavedChannel,
} from '../../lib/livetv/store';
import {useM3Colors} from '../../theme/M3PaletteContext';

type Section = 'favourites' | 'recent' | string;
type Mode = 'grid' | 'jiotv' | 'add';
type GridChannel = (LiveChannel | SavedChannel) & {sourceId: string};

const IPTV_ORG_NOTE = 'Publicly listed free-to-air channels from iptv-org. Availability varies and some streams may not play.';
const JIOTV_NOTE = 'jiotv_go runs on your PC or phone (Termux) and signs in with your own Jio number. Enter its address here.';
const QUALITIES: JioQuality[] = ['auto', 'low', 'medium', 'high'];

const streamType = (url: string) => (/\.mp4(\?|$)/i.test(url) ? 'mp4' : 'm3u8');

export const openChannel = (navigation: any, channel: GridChannel, sourceName: string) => {
  pushRecent(channel, channel.sourceId);
  navigation.navigate('Player', {
    linkIndex: 0,
    episodeList: [{title: channel.name, link: channel.url}],
    directUrl: channel.url,
    type: 'movie',
    primaryTitle: channel.name,
    secondaryTitle: channel.group || sourceName,
    poster: channel.logo ? {logo: channel.logo, poster: channel.logo} : {},
    initialStream: {server: sourceName, link: channel.url, type: streamType(channel.url), ...(channel.headers ? {headers: channel.headers} : {})},
    live: true,
  });
};

/** Now / next for the shown channels. Skips gzipped or large guides. */
const useNowNext = (epgUrl: string | undefined, channels: GridChannel[]) => {
  const [guide, setGuide] = useState<Map<string, NowNext>>(() => new Map());
  const ids = useMemo(() => channels.map(channel => channel.tvgId).filter(Boolean).join(','), [channels]);
  useEffect(() => {
    setGuide(new Map());
    if (!canLoadEpg(epgUrl) || !ids) return;
    let alive = true;
    loadNowNext(epgUrl, new Set(ids.split(',')))
      .then(result => alive && setGuide(result))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [epgUrl, ids]);
  return guide;
};

const ChannelTile = ({channel, width, favourite, now, preferred, onPress, onLongPress}: {
  channel: GridChannel;
  width: number;
  favourite: boolean;
  now?: string;
  preferred: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) => {
  const colors = useM3Colors();
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <TVFocusable
      accessibilityRole="button"
      accessibilityLabel={`Play ${channel.name}`}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onLongPress={onLongPress}
      borderRadius={14}
      focusScale={1.05}
      style={{width, margin: 4, padding: 8, borderRadius: 14, backgroundColor: colors.surfaceContainer}}>
      <View style={{height: width * 0.56, borderRadius: 10, backgroundColor: colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'}}>
        {channel.logo && !logoFailed ? (
          <Image source={{uri: channel.logo}} resizeMode="contain" onError={() => setLogoFailed(true)} style={{width: '80%', height: '80%'}} />
        ) : (
          <MaterialCommunityIcons name="television-classic" size={30} color={colors.onSurfaceVariant} />
        )}
        {favourite ? (
          <MaterialCommunityIcons name="star" size={16} color={colors.primary} style={{position: 'absolute', top: 4, right: 4}} />
        ) : null}
      </View>
      <AppText role="labelLarge" numberOfLines={1} style={{color: colors.onSurface, marginTop: 6}}>{channel.name}</AppText>
      <AppText role="bodySmall" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>{now || channel.group || ' '}</AppText>
    </TVFocusable>
  );
};

const LiveTV = ({navigation}: {navigation: any}) => {
  const colors = useM3Colors();
  const {width} = useWindowDimensions();
  const [sources, setSources] = useState<LiveSource[]>(() => listSources());
  const [view, setView] = useState<Section>(() => (listFavourites().length ? 'favourites' : 'iptv-org'));
  const [mode, setMode] = useState<Mode>('grid');
  const [channels, setChannels] = useState<GridChannel[]>([]);
  const [epgUrl, setEpgUrl] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | undefined>();
  const [favourites, setFavourites] = useState(() => listFavourites());
  const [reload, setReload] = useState(0);

  // Form fields.
  const jio = getJioServer();
  const [address, setAddress] = useState(jio?.address || '');
  const [quality, setQuality] = useState<JioQuality>(jio?.quality || 'auto');
  const [playlistName, setPlaylistName] = useState('');
  const [playlistUrl, setPlaylistUrl] = useState('');
  const urlRef = useRef<TextInputInstance>(null);

  const source = sources.find(item => item.id === view);
  const sourceName = (id: string) => sources.find(item => item.id === id)?.name || 'Live TV';

  useFocusEffect(useCallback(() => setFavourites(listFavourites()), []));

  useEffect(() => {
    setGroup(undefined);
    setError('');
    if (view === 'favourites' || view === 'recent') {
      setEpgUrl(undefined);
      setChannels(view === 'favourites' ? listFavourites() : listRecent());
      return;
    }
    if (!source) return;
    const cached = readCachedPlaylist(source);
    setChannels(cached ? cached.playlist.channels.map(channel => ({...channel, sourceId: source.id})) : []);
    let alive = true;
    setLoading(true);
    loadPlaylist(source, {force: reload > 0})
      .then(result => {
        if (!alive) return;
        setChannels(result.playlist.channels.map(channel => ({...channel, sourceId: source.id})));
        setEpgUrl(result.playlist.epgUrl || (source.kind === 'jiotv' && jio ? jioEpgUrl(jio) : undefined));
      })
      .catch(err => alive && setError(err?.message || 'Could not load this playlist.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [view, source?.id, source?.url, reload]);

  const groups = useMemo(() => channelGroups(channels), [channels]);
  const shown = useMemo(() => filterChannels(channels, query, group), [channels, query, group]);
  const guide = useNowNext(epgUrl, shown.length > 400 ? [] : shown);
  const favouriteKeys = useMemo(() => new Set(favourites.map(item => `${item.sourceId}|${item.id}`)), [favourites]);

  const columns = isTV ? 6 : Math.max(2, Math.floor((width - 24) / 120));
  const tileWidth = Math.floor((width - (isTV ? 96 : 24)) / columns) - 8;

  const onToggleFavourite = (channel: GridChannel) => {
    const added = toggleFavourite(channel, channel.sourceId);
    setFavourites(listFavourites());
    if (view === 'favourites') setChannels(listFavourites());
    ToastAndroid.show(added ? `${channel.name} added to favourites` : `${channel.name} removed from favourites`, ToastAndroid.SHORT);
  };

  const saveJio = () => {
    const saved = setJioServer(address, quality);
    setSources(listSources());
    setMode('grid');
    if (saved) {
      setAddress(saved.address);
      setView('jiotv');
      setReload(value => value + 1);
    } else if (view === 'jiotv') {
      setView('iptv-org');
    }
  };

  const savePlaylist = () => {
    try {
      const playlist = addPlaylist(playlistName, playlistUrl);
      setPlaylistName('');
      setPlaylistUrl('');
      setSources(listSources());
      setMode('grid');
      setView(playlist.id);
    } catch (err: any) {
      ToastAndroid.show(err?.message || 'Could not add this playlist.', ToastAndroid.SHORT);
    }
  };

  const inputStyle = {backgroundColor: colors.surfaceContainerHigh, color: colors.onSurface, borderRadius: 12, paddingHorizontal: 14, minHeight: 52, fontSize: 16, marginTop: 8};

  const header = (
    <View style={{paddingHorizontal: isTV ? 40 : 12, paddingTop: isTV ? 24 : 12}}>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Live TV</AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingVertical: 12}}>
        <Chip label="Favourites" icon="star-outline" selected={mode === 'grid' && view === 'favourites'} onPress={() => { setMode('grid'); setView('favourites'); }} />
        <Chip label="Recent" icon="history" selected={mode === 'grid' && view === 'recent'} onPress={() => { setMode('grid'); setView('recent'); }} />
        {sources.map(item => (
          <Chip
            key={item.id}
            label={item.name}
            icon={item.kind === 'iptv-org' ? 'earth' : item.kind === 'jiotv' ? 'server-network' : 'playlist-play'}
            selected={mode === 'grid' && view === item.id}
            onPress={() => { setMode('grid'); setView(item.id); }}
            onLongPress={item.kind === 'jiotv' ? () => setMode('jiotv') : undefined}
          />
        ))}
        <Chip label={jio ? 'JioTV Go settings' : 'JioTV Go server'} icon="cog-outline" selected={mode === 'jiotv'} onPress={() => setMode('jiotv')} />
        <Chip label="Add playlist" icon="plus" selected={mode === 'add'} onPress={() => setMode('add')} />
      </ScrollView>
    </View>
  );

  if (mode === 'jiotv') {
    return (
      <View style={{flex: 1, backgroundColor: colors.background}}>
        {header}
        <KeyboardForm contentContainerStyle={{paddingHorizontal: isTV ? 40 : 12, paddingBottom: 96}}>
          <AppText role="titleMedium" style={{color: colors.onSurface}}>JioTV Go server</AppText>
          <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>{JIOTV_NOTE}</AppText>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="http://192.168.1.5:5001"
            placeholderTextColor={colors.onSurfaceVariant}
            accessibilityLabel="JioTV Go server address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={saveJio}
            style={inputStyle}
          />
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 6}}>Port 5001 is added when you leave it out. The app loads /playlist.m3u from this server.</AppText>
          <AppText role="labelLarge" style={{color: colors.onSurface, marginTop: 16, marginBottom: 8}}>Quality</AppText>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
            {QUALITIES.map(item => <Chip key={item} label={item === 'auto' ? 'Auto' : item[0].toUpperCase() + item.slice(1)} selected={quality === item} onPress={() => setQuality(item)} />)}
          </View>
          <View style={{flexDirection: 'row', gap: 8, marginTop: 20}}>
            <Button onPress={saveJio} accessibilityLabel="Save server">Save</Button>
            {jio ? <Button variant="outlined" onPress={() => { setAddress(''); setJioServer(''); setSources(listSources()); setMode('grid'); setView('iptv-org'); }} accessibilityLabel="Remove server">Remove</Button> : null}
          </View>
        </KeyboardForm>
      </View>
    );
  }

  if (mode === 'add') {
    const playlists = listPlaylists();
    return (
      <View style={{flex: 1, backgroundColor: colors.background}}>
        {header}
        <KeyboardForm contentContainerStyle={{paddingHorizontal: isTV ? 40 : 12, paddingBottom: 96}}>
          <AppText role="titleMedium" style={{color: colors.onSurface}}>Add an M3U playlist</AppText>
          <TextInput
            value={playlistName}
            onChangeText={setPlaylistName}
            placeholder="Name"
            placeholderTextColor={colors.onSurfaceVariant}
            accessibilityLabel="Playlist name"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => urlRef.current?.focus()}
            style={inputStyle}
          />
          <TextInput
            ref={urlRef}
            value={playlistUrl}
            onChangeText={setPlaylistUrl}
            placeholder="https://example.com/playlist.m3u"
            placeholderTextColor={colors.onSurfaceVariant}
            accessibilityLabel="Playlist address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={savePlaylist}
            style={inputStyle}
          />
          <View style={{flexDirection: 'row', marginTop: 16}}>
            <Button onPress={savePlaylist} accessibilityLabel="Add playlist">Add</Button>
          </View>
          {playlists.length ? <AppText role="titleMedium" style={{color: colors.onSurface, marginTop: 24, marginBottom: 8}}>Your playlists</AppText> : null}
          {playlists.map(item => (
            <View key={item.id} style={{flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainer, borderRadius: 12, padding: 12, marginBottom: 8}}>
              <View style={{flex: 1}}>
                <AppText role="bodyLarge" numberOfLines={1} style={{color: colors.onSurface}}>{item.name}</AppText>
                <AppText role="bodySmall" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>{item.url}</AppText>
              </View>
              <Chip label="Remove" icon="delete-outline" accessibilityLabel={`Remove ${item.name}`} onPress={() => { removePlaylist(item.id); setSources(listSources()); if (view === item.id) setView('iptv-org'); }} />
            </View>
          ))}
        </KeyboardForm>
      </View>
    );
  }

  const note = source?.kind === 'iptv-org' ? IPTV_ORG_NOTE : source?.kind === 'jiotv' ? JIOTV_NOTE : undefined;
  const empty = view === 'favourites'
    ? 'No favourites yet. Long-press a channel to add it.'
    : view === 'recent'
      ? 'Channels you watch show up here.'
      : loading
        ? ''
        : error || 'No channels match.';

  return (
    <View style={{flex: 1, backgroundColor: colors.background}}>
      <FlatList
        key={columns}
        data={shown}
        numColumns={columns}
        keyExtractor={item => `${item.sourceId}|${item.id}`}
        contentContainerStyle={{paddingHorizontal: isTV ? 36 : 8, paddingBottom: 96}}
        initialNumToRender={columns * 4}
        windowSize={7}
        removeClippedSubviews={!isTV}
        ListHeaderComponent={
          <View style={{marginHorizontal: isTV ? -36 : -8}}>
            {header}
            <View style={{paddingHorizontal: isTV ? 40 : 12}}>
              {note ? <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>{note}</AppText> : null}
              <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerHigh, borderRadius: 28, minHeight: 48, paddingHorizontal: 16}}>
                <MaterialCommunityIcons name="magnify" size={22} color={colors.onSurfaceVariant} />
                <TextInput value={query} onChangeText={setQuery} placeholder="Search channels" placeholderTextColor={colors.onSurfaceVariant} accessibilityLabel="Search channels" returnKeyType="search" style={{flex: 1, color: colors.onSurface, marginLeft: 8, fontSize: 16}} />
                {source ? (
                  <TVFocusable accessibilityRole="button" accessibilityLabel="Reload playlist" onPress={() => setReload(value => value + 1)} borderRadius={20} style={{padding: 6}}>
                    <MaterialCommunityIcons name="refresh" size={22} color={colors.onSurfaceVariant} />
                  </TVFocusable>
                ) : null}
              </View>
              {groups.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingTop: 12}}>
                  <Chip label="All" selected={!group} onPress={() => setGroup(undefined)} />
                  {groups.map(item => <Chip key={item} label={item} selected={group === item} onPress={() => setGroup(item)} />)}
                </ScrollView>
              ) : null}
              {loading && !channels.length ? <ActivityIndicator color={colors.primary} style={{marginTop: 24}} /> : null}
              {error && channels.length ? <AppText role="bodySmall" style={{color: colors.error, marginTop: 8}}>{error}</AppText> : null}
            </View>
            <View style={{height: 12}} />
          </View>
        }
        ListEmptyComponent={empty ? <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, paddingHorizontal: 4}}>{empty}</AppText> : undefined}
        renderItem={({item, index}) => (
          <ChannelTile
            channel={item}
            width={tileWidth}
            favourite={favouriteKeys.has(`${item.sourceId}|${item.id}`)}
            now={item.tvgId ? guide.get(item.tvgId)?.now?.title : undefined}
            preferred={index === 0}
            onPress={() => openChannel(navigation, item, sourceName(item.sourceId))}
            onLongPress={() => onToggleFavourite(item)}
          />
        )}
      />
    </View>
  );
};

export default LiveTV;
