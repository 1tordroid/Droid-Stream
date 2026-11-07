/**
 * Channel picker for multi-view: the Live TV lists (Favourites, Recent,
 * playlists, JioTV, the World country picked last) with search and the same
 * saved filters as the Live TV grid.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, FlatList, Image, Modal, ScrollView, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Chip from '../../components/torrentSearch/Chip';
import {TVFocusable} from '../../components/tv';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import {applyFilters, channelFacets, displayChannelName, filterCounts, type ChannelFilters} from '../../lib/livetv/filters';
import {JIO_SOURCE_ID, loadJioChannels} from '../../lib/livetv/jio/channels';
import {jioSignedInNumber} from '../../lib/livetv/jio/session';
import {channelGroups} from '../../lib/livetv/m3u';
import {
  getChannelFilters,
  listFavourites,
  listRecent,
  listSources,
  loadPlaylist,
  readCachedPlaylist,
  setChannelFilters,
  type LiveSource,
} from '../../lib/livetv/store';
import {getSavedLiveView, getWorldCountry, worldSource} from '../../lib/livetv/world';
import {ALL_COUNTRIES} from '../../lib/livetv/countries';
import {isKidsChannelGroup} from '../../lib/profiles/kids';
import {useIsKidsProfile} from '../../lib/profiles/useProfiles';
import {isTV} from '../../lib/tv';
import {useM3Colors} from '../../theme/M3PaletteContext';
import ChannelFilterBar, {QualityBadge} from './ChannelFilterBar';
import {sourceChipLabel} from './chipScroll';
import type {GridChannel} from './play';

interface PickerList {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  source?: LiveSource;
}

const pickerLists = (): PickerList[] => {
  const lists: PickerList[] = [
    {id: 'favourites', label: 'Favourites', icon: 'star-outline'},
    {id: 'recent', label: 'Recent', icon: 'history'},
  ];
  for (const source of listSources()) {
    lists.push({id: source.id, label: sourceChipLabel(source), icon: source.kind === 'iptv-org' ? 'earth' : source.kind === 'jiotv' ? 'server-network' : 'playlist-play', source});
  }
  // JioTV only once signed in (signing in is in Live TV).
  if (jioSignedInNumber()) lists.push({id: JIO_SOURCE_ID, label: 'JioTV', icon: 'cellphone-key'});
  // The World country picked last (All countries is too large to list here).
  const country = getWorldCountry();
  const world = country && country !== ALL_COUNTRIES ? worldSource(country) : undefined;
  if (world) lists.push({id: world.id, label: sourceChipLabel(world), icon: 'web', source: world});
  return lists;
};

const PickerTile = ({channel, title, badge, width, preferred, onPress}: {
  channel: GridChannel;
  title: string;
  badge?: string;
  width: number;
  preferred: boolean;
  onPress: () => void;
}) => {
  const colors = useM3Colors();
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <TVFocusable
      accessibilityRole="button"
      accessibilityLabel={`Pick ${channel.name}`}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      borderRadius={12}
      style={{width, margin: 4, padding: 6, borderRadius: 12, backgroundColor: colors.surfaceContainer}}>
      <View style={{height: width * 0.5, borderRadius: 8, backgroundColor: colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'}}>
        {channel.logo && !logoFailed ? (
          <Image source={{uri: channel.logo}} resizeMode="contain" onError={() => setLogoFailed(true)} style={{width: '80%', height: '80%'}} />
        ) : (
          <MaterialCommunityIcons name="television-classic" size={26} color={colors.onSurfaceVariant} />
        )}
      </View>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4}}>
        <AppText role="labelLarge" numberOfLines={1} style={{flex: 1, color: colors.onSurface}}>{title}</AppText>
        {badge ? <QualityBadge label={badge} /> : null}
      </View>
    </TVFocusable>
  );
};

const MultiViewPicker = ({visible, title, onPick, onClose}: {
  visible: boolean;
  title: string;
  onPick: (channel: GridChannel) => void;
  onClose: () => void;
}) => {
  const colors = useM3Colors();
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const kids = useIsKidsProfile();
  const lists = useMemo(() => (visible ? pickerLists() : []), [visible]);
  const [view, setView] = useState<string>('');
  const [channels, setChannels] = useState<GridChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ChannelFilters>(() => getChannelFilters('favourites'));

  // Opens on the list Live TV had open, else Favourites when there are any.
  useEffect(() => {
    if (!visible || !lists.length) return;
    setView(current => {
      if (current && lists.some(item => item.id === current)) return current;
      const saved = getSavedLiveView();
      if (saved && lists.some(item => item.id === saved)) return saved;
      return listFavourites().length ? 'favourites' : lists.find(item => item.source)?.id || 'favourites';
    });
  }, [visible, lists]);

  useEffect(() => {
    if (!visible || !view) return;
    setFilters(getChannelFilters(view));
    setError('');
    if (view === 'favourites' || view === 'recent') {
      setChannels(view === 'favourites' ? listFavourites() : listRecent());
      return;
    }
    let alive = true;
    setLoading(true);
    if (view === JIO_SOURCE_ID) {
      setChannels([]);
      loadJioChannels()
        .then(list => alive && setChannels(list.map(channel => ({...channel, sourceId: JIO_SOURCE_ID}))))
        .catch(err => alive && setError(err?.message || 'Could not load JioTV channels.'))
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }
    const source = lists.find(item => item.id === view)?.source;
    if (!source) {
      setLoading(false);
      setChannels([]);
      return;
    }
    const cached = readCachedPlaylist(source);
    setChannels(cached ? cached.playlist.channels.map(channel => ({...channel, sourceId: source.id})) : []);
    loadPlaylist(source)
      .then(result => alive && setChannels(result.playlist.channels.map(channel => ({...channel, sourceId: source.id}))))
      .catch(err => alive && setError(err?.message || 'Could not load this playlist.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [visible, view, lists]);

  const allowed = useMemo(() => (kids ? channels.filter(channel => isKidsChannelGroup(channel.group)) : channels), [channels, kids]);
  const groups = useMemo(() => channelGroups(allowed), [allowed]);
  const group = filters.group && groups.includes(filters.group) ? filters.group : undefined;
  const effective = useMemo<ChannelFilters>(() => ({...filters, group}), [filters, group]);
  const shown = useMemo(() => applyFilters(allowed, effective, query), [allowed, effective, query]);
  const counts = useMemo(() => filterCounts(allowed, effective, query), [allowed, effective, query]);
  const updateFilters = (next: ChannelFilters) => {
    setFilters(next);
    setChannelFilters(view, next);
  };

  const columns = isTV ? 6 : Math.max(2, Math.floor((width - 24) / 120));
  const tileWidth = Math.floor((width - (isTV ? 96 : 24) - insets.left - insets.right) / columns) - 8;
  const empty = view === 'favourites' ? 'No favourites yet.' : view === 'recent' ? 'Channels you watch show up here.' : loading ? '' : error || 'No channels match.';

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={{flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right}}>
        <FlatList
          key={columns}
          data={shown}
          numColumns={columns}
          keyExtractor={item => `${item.sourceId}|${item.id}`}
          contentContainerStyle={{paddingHorizontal: isTV ? 36 : 8, paddingBottom: 48 + insets.bottom}}
          initialNumToRender={columns * 4}
          maxToRenderPerBatch={columns * 3}
          windowSize={7}
          removeClippedSubviews={!isTV}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{paddingHorizontal: 4, paddingTop: isTV ? 24 : 8}}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                <TVFocusable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} borderRadius={20} style={{padding: 6}}>
                  <MaterialCommunityIcons name="close" size={24} color={colors.onSurface} />
                </TVFocusable>
                <AppText role="titleLarge" numberOfLines={1} style={{flex: 1, color: colors.onBackground}}>{title}</AppText>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingVertical: 12}}>
                {lists.map(item => (
                  <Chip key={item.id} label={item.label} accessibilityLabel={item.source?.name || item.label} icon={item.icon} selected={view === item.id} onPress={() => setView(item.id)} />
                ))}
              </ScrollView>
              <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerHigh, borderRadius: 28, minHeight: 48, paddingHorizontal: 16}}>
                <MaterialCommunityIcons name="magnify" size={22} color={colors.onSurfaceVariant} />
                <TextInput value={query} onChangeText={setQuery} placeholder="Search channels" placeholderTextColor={colors.onSurfaceVariant} accessibilityLabel="Search channels" returnKeyType="search" style={{flex: 1, color: colors.onSurface, marginLeft: 8, fontSize: 16}} />
              </View>
              {allowed.length ? (
                <ChannelFilterBar filters={effective} counts={counts} groups={groups} shown={shown.length} total={allowed.length} onChange={updateFilters} />
              ) : null}
              {loading && !channels.length ? <ActivityIndicator color={colors.primary} style={{marginTop: 24}} /> : null}
              {error && channels.length ? <AppText role="bodySmall" style={{color: colors.error, marginTop: 8}}>{error}</AppText> : null}
              <View style={{height: 12}} />
            </View>
          }
          ListEmptyComponent={empty ? <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, paddingHorizontal: 4}}>{empty}</AppText> : undefined}
          renderItem={({item, index}) => (
            <PickerTile
              channel={item}
              title={filters.qualityBadge ? displayChannelName(item.name) : item.name}
              badge={filters.qualityBadge ? channelFacets(item).quality : undefined}
              width={tileWidth}
              preferred={index === 0}
              onPress={() => onPick(item)}
            />
          )}
        />
      </View>
    </Modal>
  );
};

export default MultiViewPicker;
