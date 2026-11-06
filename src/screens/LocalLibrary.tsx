import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useMemo, useState} from 'react';
import {FlatList, ToastAndroid, View} from 'react-native';
import MediaPosterCard from '../components/MediaPosterCard';
import AppText from '../components/ui/Text';
import {TVFocusable} from '../components/tv';
import {listLocalFolder, pickLocalFolder} from '../lib/localContent/files';
import {lookupArtwork} from '../lib/localLibrary/artwork';
import {isVideoFileName, parseVideoFileName} from '../lib/localLibrary/parseFileName';
import {useM3Colors} from '../theme/M3PaletteContext';

type SortKey = 'name' | 'date' | 'rating' | 'type';

interface LibraryItem {
  uri: string;
  name: string;
  title: string;
  year?: number;
  modified: number;
  poster?: string;
  rating?: string;
  mediaType?: 'movie' | 'tv';
}

const walk = async (uri: string, depth: number, into: {uri: string; name: string}[]) => {
  if (depth > 3 || into.length > 400) return;
  const entries = await listLocalFolder(uri);
  for (const entry of entries) {
    if (entry.directory) await walk(entry.uri, depth + 1, into);
    else if (isVideoFileName(entry.name)) into.push({uri: entry.uri, name: entry.name});
  }
};

const LocalLibrary = ({navigation}: {navigation: any}) => {
  const colors = useM3Colors();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [sort, setSort] = useState<SortKey>('name');
  const [busy, setBusy] = useState(false);

  const scan = async () => {
    const folder = await pickLocalFolder();
    if (!folder) return;
    setBusy(true);
    try {
      const files: {uri: string; name: string}[] = [];
      await walk(folder.uri, 0, files);
      const next: LibraryItem[] = files.map(file => {
        const parsed = parseVideoFileName(file.name);
        return {uri: file.uri, name: file.name, title: parsed.title, year: parsed.year, modified: 0};
      });
      setItems(next);
      for (const item of next) {
        try {
          const art = await lookupArtwork(item.title, item.year);
          if (!art) continue;
          setItems(current =>
            current.map(row =>
              row.uri === item.uri
                ? {...row, poster: art.poster, rating: art.rating, mediaType: art.mediaType, title: art.title}
                : row,
            ),
          );
        } catch {
          // Artwork is optional. The file still plays.
        }
      }
    } catch (error: any) {
      ToastAndroid.show(error?.message || 'Could not scan that folder', ToastAndroid.LONG);
    } finally {
      setBusy(false);
    }
  };

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      if (sort === 'rating') return Number(b.rating || 0) - Number(a.rating || 0);
      if (sort === 'type') return (a.mediaType || '').localeCompare(b.mediaType || '');
      if (sort === 'date') return b.modified - a.modified || a.title.localeCompare(b.title);
      return a.title.localeCompare(b.title);
    });
    return copy;
  }, [items, sort]);

  return (
    <View style={{flex: 1, backgroundColor: colors.background, paddingTop: 12}}>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8}}>
        <TVFocusable accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={{padding: 8}}>
          <MaterialCommunityIcons name="arrow-left" size={28} color={colors.onBackground} />
        </TVFocusable>
        <AppText role="headlineSmallEmphasized" className="ml-2 text-m3-on-background">Video library</AppText>
      </View>
      <View style={{flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12}}>
        <TVFocusable accessibilityLabel="Scan folder" onPress={scan} style={{paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.primaryContainer}}>
          <AppText style={{color: colors.onPrimaryContainer}}>{busy ? 'Scanning…' : 'Scan folder'}</AppText>
        </TVFocusable>
        {(['name', 'rating', 'type', 'date'] as SortKey[]).map(key => (
          <TVFocusable key={key} accessibilityLabel={`Sort by ${key}`} onPress={() => setSort(key)} style={{paddingVertical: 8, paddingHorizontal: 10}}>
            <AppText style={{color: sort === key ? colors.primary : colors.onSurfaceVariant}}>{key}</AppText>
          </TVFocusable>
        ))}
      </View>
      <FlatList
        data={sorted}
        numColumns={3}
        keyExtractor={item => item.uri}
        contentContainerStyle={{paddingHorizontal: 12, paddingBottom: 32}}
        ListEmptyComponent={
          <AppText className="px-4 text-m3-on-surface-variant">
            Scan a folder for MKV, MP4, AVI, MOV, and ISO files. Posters and ratings load when a TMDB key is saved.
          </AppText>
        }
        renderItem={({item}) => (
          <View style={{margin: 6}}>
            <MediaPosterCard
              title={item.title}
              poster={item.poster}
              width={108}
              badge={item.rating}
              cornerTag={item.year ? String(item.year) : undefined}
              onPress={() =>
                navigation.navigate('Player', {
                  linkIndex: 0,
                  episodeList: [{title: item.title, link: item.uri}],
                  directUrl: item.uri,
                  file: item.uri,
                  localContent: true,
                  type: item.mediaType || 'movie',
                  primaryTitle: item.title,
                  poster: {poster: item.poster},
                })
              }
            />
          </View>
        )}
      />
    </View>
  );
};

export default LocalLibrary;
