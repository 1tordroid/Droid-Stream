import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';
import React, {useCallback, useState} from 'react';
import {ScrollView, View} from 'react-native';
import {RawTextInput as TextInput} from '../../components/ui/Text';
import Chip from '../../components/torrentSearch/Chip';
import AppText from '../../components/ui/Text';
import {TVFocusable} from '../../components/tv';
import {listSources, type SavedSource, type SourceKind} from '../../lib/sources/vault';
import {listDeviceSources, loadLibrary} from '../../lib/netlib/cache';
import {listCloudSources} from '../../lib/netlib/cloud';
import {itemTab} from '../../lib/netlib/group';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {useIsKidsProfile} from '../../lib/profiles/useProfiles';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const ICONS: {kind: SourceKind | 'pikpak' | 'tdplus'; label: string; icon: IconName}[] = [
  {kind: 'webdav', label: 'WebDAV', icon: 'cloud-outline'},
  {kind: 'smb', label: 'SMB', icon: 'folder-network-outline'},
  {kind: 'jellyfin', label: 'Jellyfin', icon: 'play-box-multiple-outline'},
  {kind: 'emby', label: 'Emby', icon: 'play-box-outline'},
  {kind: 'plex', label: 'Plex', icon: 'plex'},
  {kind: 'pikpak', label: 'PikPak', icon: 'cloud-download-outline'},
  {kind: 'tdplus', label: 'Tordroid Plus', icon: 'account-group-outline'},
];

const FILTERS: {id: 'all' | SourceKind | 'cloud'; label: string}[] = [
  {id: 'all', label: 'All'},
  {id: 'webdav', label: 'WebDAV'},
  {id: 'smb', label: 'SMB'},
  {id: 'jellyfin', label: 'Jellyfin'},
  {id: 'emby', label: 'Emby'},
  {id: 'plex', label: 'Plex'},
  {id: 'cloud', label: 'Cloud'},
];

const iconOf = (kind: string): IconName => ICONS.find(item => item.kind === kind)?.icon || 'folder-outline';

/** WebDAV and SMB sources open as poster libraries; media servers keep their own folders. */
const hasLibrary = (kind: string) => kind === 'webdav' || kind === 'smb';

/** "WebDAV · 120 movies · 14 shows", or a hint before the first scan. */
export const sourceCardDescription = (source: Pick<SavedSource, 'id' | 'kind' | 'server' | 'authState'>, label: string): string => {
  if (source.authState === 'signedOut') return `${label} · signed out, tap to sign in again`;
  if (!hasLibrary(source.kind)) return `${label} · ${source.server}`;
  const library = loadLibrary(source.id);
  if (!library) return `${label} · tap to build its poster library`;
  const counts = {movies: 0, shows: 0, other: 0};
  library.items.forEach(item => {
    counts[itemTab(item)] += 1;
  });
  return [label, `${counts.movies} movies`, `${counts.shows} shows`, ...(counts.other ? [`${counts.other} other`] : [])].join(' · ');
};

const Row = ({label, title, description, icon, onPress}: {label: string; title: string; description: string; icon: IconName; onPress: () => void}) => {
  const colors = useM3Colors();
  return (
    <TVFocusable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} borderRadius={16}
      style={{flexDirection: 'row', alignItems: 'center', minHeight: 72, padding: 14, marginBottom: 8, borderRadius: 16, backgroundColor: colors.surfaceContainer}}>
      <View style={{width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceContainerHigh, marginRight: 14}}>
        <MaterialCommunityIcons name={icon} size={24} color={colors.primary} />
      </View>
      <View style={{flex: 1}}>
        <AppText role="titleMedium" numberOfLines={1} style={{color: colors.onSurface}}>{title}</AppText>
        <AppText role="bodySmall" numberOfLines={2} style={{color: colors.onSurfaceVariant}}>{description}</AppText>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
    </TVFocusable>
  );
};

const LibraryHub = ({navigation}: {navigation: any}) => {
  const colors = useM3Colors();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | SourceKind | 'cloud'>('all');
  const [saved, setSaved] = useState(() => listSources());
  // PikPak, debrid services and Tordroid Plus once signed in.
  const [cloud, setCloud] = useState(() => listCloudSources());
  // A kids profile does not see debrid, cloud files or network sources.
  const kids = useIsKidsProfile();

  // A source added or removed on the Sources page shows up on return.
  useFocusEffect(useCallback(() => {
    setSaved(listSources());
    setCloud(listCloudSources());
  }, []));

  const sources = saved.filter(source => {
    const text = `${source.name} ${source.kind} ${source.server}`.toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    return filter === 'all' || source.kind === filter;
  });

  return (
    <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={{padding: 16, paddingBottom: 96}}>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Library</AppText>
      <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerHigh, borderRadius: 28, minHeight: 52, paddingHorizontal: 16, marginTop: 12}}>
        <MaterialCommunityIcons name="magnify" size={22} color={colors.onSurfaceVariant} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search library" placeholderTextColor={colors.onSurfaceVariant} accessibilityLabel="Search library" style={{flex: 1, color: colors.onSurface, marginLeft: 8, fontSize: 16}} />
      </View>

      <View style={{marginTop: 16}}>
        <Row label="Saved titles" title="Saved" description="Titles you saved from providers." icon="bookmark-outline" onPress={() => navigation.navigate('WatchList')} />
        <Row label="Videos on this device" title="On this device" description="Poster grid for videos in a folder you pick." icon="cellphone" onPress={() => navigation.navigate('LocalLibrary')} />
        {kids ? null : <Row label="Cloud and debrid files" title="Cloud files" description="PikPak, TorBox, Real-Debrid and others, as posters or a list." icon="cloud-check-outline" onPress={() => navigation.navigate('CloudFiles')} />}
        <Row label="Live TV" title="Live TV" description="Free Indian channels, JioTV with your Jio number, JioTV Go and your IPTV playlists." icon="television-classic" onPress={() => navigation.navigate('LiveTV')} />
        <Row label="Calendar" title="Calendar" description="New episodes of your shows by day, with alerts." icon="calendar-month-outline" onPress={() => navigation.navigate('Calendar')} />
      </View>

      {kids ? null : (<>
      <AppText role="titleMedium" style={{color: colors.onSurface, marginTop: 16, marginBottom: 8}}>Your sources</AppText>
      {saved.length || cloud.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingBottom: 12}}>
          {FILTERS.map(item => <Chip key={item.id} label={item.label} accessibilityLabel={`Filter ${item.id}`} selected={filter === item.id} onPress={() => setFilter(item.id)} />)}
        </ScrollView>
      ) : null}
      {sources.map(source => {
        const label = FILTERS.find(item => item.id === source.kind)?.label || source.kind;
        const library = hasLibrary(source.kind) && source.authState !== 'signedOut';
        return (
          <Row key={source.id} label={`Open ${source.name}`} title={source.name} description={sourceCardDescription(source, label)} icon={iconOf(source.kind)}
            onPress={() => (library ? navigation.navigate('SourceLibrary', {sourceId: source.id}) : navigation.navigate('Sources', {openId: source.id}))} />
        );
      })}
      {filter === 'all' && !query ? listDeviceSources().map(source => (
        <Row key={source.id} label={`Open ${source.name}`} title={source.name} description={sourceCardDescription({id: source.id, kind: 'webdav', server: '', authState: 'ok'}, 'This device')} icon="cellphone"
          onPress={() => navigation.navigate('LocalLibrary')} />
      )) : null}
      {filter === 'all' || filter === 'cloud' ? cloud.filter(source => !query || source.name.toLowerCase().includes(query.toLowerCase())).map(source => (
        <Row key={source.id} label={`Open ${source.name}`} title={source.name} description={sourceCardDescription({id: source.id, kind: 'webdav', server: '', authState: 'ok'}, source.kind === 'debrid' ? 'Debrid' : 'Cloud')} icon={source.kind === 'tdplus' ? 'account-group-outline' : source.kind === 'pikpak' ? 'cloud-download-outline' : 'lightning-bolt-outline'}
          onPress={() => navigation.navigate('SourceLibrary', {sourceId: source.id})} />
      )) : null}
      {!saved.length && !cloud.length ? (
        <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginBottom: 4}}>No sources yet. Add your own server below and its videos appear here.</AppText>
      ) : !sources.length && filter !== 'cloud' && !cloud.length ? (
        <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginBottom: 4}}>No sources match.</AppText>
      ) : null}

      <AppText role="titleMedium" style={{color: colors.onSurface, marginTop: 16, marginBottom: 8}}>Add a source</AppText>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
        {ICONS.map(item => (
          <TVFocusable
            key={item.kind}
            accessibilityRole="button"
            accessibilityLabel={`Add ${item.label}`}
            borderRadius={16}
            onPress={() => (item.kind === 'tdplus' ? navigation.navigate('TordroidPlus') : navigation.navigate('Sources', {kind: item.kind}))}
            style={{flexBasis: '31%', flexGrow: 1, minHeight: 84, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceContainer, borderRadius: 16}}>
            <MaterialCommunityIcons name={item.icon} size={28} color={colors.primary} />
            <AppText role="labelLarge" style={{color: colors.onSurface, marginTop: 6}}>{item.label}</AppText>
          </TVFocusable>
        ))}
      </View>
      </>)}
    </ScrollView>
  );
};

export default LibraryHub;
