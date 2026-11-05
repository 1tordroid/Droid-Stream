import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';
import React, {useCallback, useState} from 'react';
import {Pressable, ScrollView, View} from 'react-native';
import {RawTextInput as TextInput} from '../../components/ui/Text';
import Chip from '../../components/torrentSearch/Chip';
import AppText from '../../components/ui/Text';
import {TVFocusable} from '../../components/tv';
import {listSources, type SourceKind} from '../../lib/sources/vault';
import {useM3Colors} from '../../theme/M3PaletteContext';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const ICONS: {kind: SourceKind | 'pikpak'; label: string; icon: IconName}[] = [
  {kind: 'webdav', label: 'WebDAV', icon: 'cloud-outline'},
  {kind: 'smb', label: 'SMB', icon: 'folder-network-outline'},
  {kind: 'jellyfin', label: 'Jellyfin', icon: 'play-box-multiple-outline'},
  {kind: 'emby', label: 'Emby', icon: 'play-box-outline'},
  {kind: 'plex', label: 'Plex', icon: 'plex'},
  {kind: 'pikpak', label: 'PikPak', icon: 'cloud-download-outline'},
];

const FILTERS: {id: 'all' | SourceKind; label: string}[] = [
  {id: 'all', label: 'All'},
  {id: 'webdav', label: 'WebDAV'},
  {id: 'smb', label: 'SMB'},
  {id: 'jellyfin', label: 'Jellyfin'},
  {id: 'emby', label: 'Emby'},
  {id: 'plex', label: 'Plex'},
];

const iconOf = (kind: string): IconName => ICONS.find(item => item.kind === kind)?.icon || 'folder-outline';

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
  const [filter, setFilter] = useState<'all' | SourceKind>('all');
  const [saved, setSaved] = useState(() => listSources());

  // A source added or removed on the Sources page shows up on return.
  useFocusEffect(useCallback(() => setSaved(listSources()), []));

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
        <Row label="Cloud and debrid files" title="PikPak and debrid files" description="Files in PikPak, TorBox, Real-Debrid and others." icon="cloud-check-outline" onPress={() => navigation.getParent()?.navigate('TorrentsStack', {screen: 'DebridSettings', initial: false})} />
      </View>

      <AppText role="titleMedium" style={{color: colors.onSurface, marginTop: 16, marginBottom: 8}}>Your sources</AppText>
      {saved.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingBottom: 12}}>
          {FILTERS.map(item => <Chip key={item.id} label={item.label} accessibilityLabel={`Filter ${item.id}`} selected={filter === item.id} onPress={() => setFilter(item.id)} />)}
        </ScrollView>
      ) : null}
      {sources.map(source => (
        <Row key={source.id} label={`Open ${source.name}`} title={source.name} description={`${source.kind} · ${source.server}`} icon={iconOf(source.kind)} onPress={() => navigation.navigate('Sources', {openId: source.id})} />
      ))}
      {!saved.length ? (
        <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginBottom: 4}}>No sources yet. Add your own server below and its videos appear here.</AppText>
      ) : !sources.length ? (
        <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginBottom: 4}}>No sources match.</AppText>
      ) : null}

      <AppText role="titleMedium" style={{color: colors.onSurface, marginTop: 16, marginBottom: 8}}>Add a source</AppText>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
        {ICONS.map(item => (
          <Pressable
            key={item.kind}
            accessibilityRole="button"
            accessibilityLabel={`Add ${item.label}`}
            onPress={() => navigation.navigate('Sources', {kind: item.kind})}
            style={{flexBasis: '31%', flexGrow: 1, minHeight: 84, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceContainer, borderRadius: 16}}>
            <MaterialCommunityIcons name={item.icon} size={28} color={colors.primary} />
            <AppText role="labelLarge" style={{color: colors.onSurface, marginTop: 6}}>{item.label}</AppText>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
};

export default LibraryHub;
