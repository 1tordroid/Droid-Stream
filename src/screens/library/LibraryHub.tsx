import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {Pressable, ScrollView, TextInput, View} from 'react-native';
import AppText from '../../components/ui/Text';
import {TVFocusable} from '../../components/tv';
import {listSources, type SourceKind} from '../../lib/sources/vault';
import {useM3Colors} from '../../theme/M3PaletteContext';

const ICONS: {kind: SourceKind | 'pikpak'; label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']}[] = [
  {kind: 'webdav', label: 'WebDAV', icon: 'cloud-outline'},
  {kind: 'smb', label: 'SMB', icon: 'folder-network-outline'},
  {kind: 'jellyfin', label: 'Jellyfin', icon: 'play-box-multiple-outline'},
  {kind: 'emby', label: 'Emby', icon: 'play-box-outline'},
  {kind: 'plex', label: 'Plex', icon: 'plex'},
  {kind: 'pikpak', label: 'PikPak', icon: 'cloud-download-outline'},
];

const LibraryHub = ({navigation}: {navigation: any}) => {
  const colors = useM3Colors();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | SourceKind | 'pikpak'>('all');
  const sources = listSources().filter(source => {
    const text = `${source.name} ${source.kind} ${source.server}`.toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (filter !== 'all' && filter !== 'pikpak' && source.kind !== filter) return false;
    return true;
  });
  return (
    <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={{padding: 16}}>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Library</AppText>
      <TextInput value={query} onChangeText={setQuery} placeholder="Search library" placeholderTextColor={colors.onSurfaceVariant} accessibilityLabel="Search library" style={{color: colors.onSurface, minHeight: 48, marginVertical: 8}} />
      <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8}}>
        {(['all', 'webdav', 'smb', 'jellyfin', 'emby', 'plex'] as const).map(item => (
          <Pressable key={item} accessibilityRole="button" accessibilityLabel={`Filter ${item}`} onPress={() => setFilter(item)} style={{minHeight: 44, justifyContent: 'center'}}>
            <AppText style={{color: filter === item ? colors.primary : colors.onSurfaceVariant}}>{item}</AppText>
          </Pressable>
        ))}
      </View>
      <TVFocusable accessibilityRole="button" accessibilityLabel="Saved titles" onPress={() => navigation.navigate('WatchList')} style={{minHeight: 64, justifyContent: 'center'}}>
        <AppText role="titleMedium" style={{color: colors.onSurface}}>Saved</AppText>
        <AppText style={{color: colors.onSurfaceVariant}}>Titles you saved from providers.</AppText>
      </TVFocusable>
      <TVFocusable accessibilityRole="button" accessibilityLabel="Videos on this device" onPress={() => navigation.navigate('LocalLibrary')} style={{minHeight: 64, justifyContent: 'center'}}>
        <AppText role="titleMedium" style={{color: colors.onSurface}}>On this device</AppText>
        <AppText style={{color: colors.onSurfaceVariant}}>Poster grid for videos in a folder you pick.</AppText>
      </TVFocusable>
      <AppText role="titleMedium" style={{color: colors.onSurface, marginTop: 12}}>Add a source</AppText>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginVertical: 8}}>
        {ICONS.map(item => (
          <Pressable
            key={item.kind}
            accessibilityRole="button"
            accessibilityLabel={`Add ${item.label}`}
            onPress={() => navigation.navigate('Sources', {kind: item.kind})}
            style={{width: 96, minHeight: 72, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceContainerHigh, borderRadius: 16}}>
            <MaterialCommunityIcons name={item.icon} size={28} color={colors.primary} />
            <AppText style={{color: colors.onSurface}}>{item.label}</AppText>
          </Pressable>
        ))}
      </View>
      {sources.length === 0 ? <AppText style={{color: colors.onSurfaceVariant}}>No sources yet. Add one with the icons above.</AppText> : null}
      {sources.map(source => (
        <Pressable key={source.id} accessibilityRole="button" accessibilityLabel={`Open ${source.name}`} onPress={() => navigation.navigate('Sources', {openId: source.id})} style={{minHeight: 56, justifyContent: 'center'}}>
          <AppText style={{color: colors.onSurface}}>{source.name}</AppText>
          <AppText style={{color: colors.onSurfaceVariant}}>{source.kind} · {source.server}</AppText>
        </Pressable>
      ))}
    </ScrollView>
  );
};

export default LibraryHub;
