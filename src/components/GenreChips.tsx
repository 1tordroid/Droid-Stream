import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, View, type HostInstance} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {SearchStackParamList} from '../App';
import type {Catalog} from '../lib/providers/types';
import {providerManager} from '../lib/services/ProviderManager';
import useContentStore from '../lib/zustand/contentStore';
import {useM3Colors} from '../theme/M3PaletteContext';
import {getNodeHandle} from '../lib/tv/focus';
import {isTV} from '../lib/tv';
import {TVFocusable} from './tv';
import AppText from './ui/Text';

const MAX_GENRES = 24;

interface GenreChipsProps {
  /** D-pad up target from the chips, normally the search field. */
  nextFocusUp?: number | null;
  /** Reports the first chip's node handle (TV only) so the field can move down to it. */
  onFirstNodeHandle?: (node: number | null) => void;
}

/** Genre shortcuts from the active provider's catalog module, shown on an empty Search screen. */
const GenreChips = ({nextFocusUp, onFirstNodeHandle}: GenreChipsProps) => {
  const colors = useM3Colors();
  const navigation =
    useNavigation<NativeStackNavigationProp<SearchStackParamList>>();
  const provider = useContentStore(state => state.provider);
  const providerValue = provider?.value;
  const [genres, setGenres] = useState<Catalog[]>([]);

  useEffect(() => {
    let cancelled = false;
    setGenres([]);
    if (!providerValue) {
      return;
    }
    providerManager
      .getGenres({providerValue})
      .then(list => {
        if (!cancelled) {
          setGenres(
            list
              .filter(g => g && typeof g.title === 'string' && typeof g.filter === 'string')
              .slice(0, MAX_GENRES),
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [providerValue]);

  const hasGenres = genres.length > 0;
  useEffect(() => {
    if (!hasGenres) {
      onFirstNodeHandle?.(null);
    }
  }, [hasGenres, onFirstNodeHandle]);
  useEffect(() => () => onFirstNodeHandle?.(null), [onFirstNodeHandle]);

  const setFirstRef = useCallback(
    (el: HostInstance | null) => {
      if (isTV) {
        onFirstNodeHandle?.(el ? getNodeHandle(el) : null);
      }
    },
    [onFirstNodeHandle],
  );

  if (!hasGenres || !providerValue) {
    return null;
  }

  return (
    <View style={{paddingTop: 4, paddingBottom: 8}}>
      <AppText
        role="titleSmallEmphasized"
        style={{color: colors.onSurfaceVariant, paddingHorizontal: 16, marginBottom: 8}}>
        Browse {provider?.display_name || 'genres'}
      </AppText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{paddingHorizontal: 16, gap: 8}}>
        {genres.map((genre, index) => (
          <TVFocusable
            key={`${genre.filter}-${index}`}
            ref={index === 0 ? setFirstRef : undefined}
            accessibilityRole="button"
            accessibilityLabel={`Browse ${genre.title}`}
            nextFocusUp={nextFocusUp}
            borderRadius={12}
            onPress={() =>
              navigation.navigate('ScrollList', {
                title: genre.title,
                filter: genre.filter,
                providerValue,
                isSearch: false,
              })
            }
            style={{
              minHeight: 40,
              paddingHorizontal: 14,
              borderRadius: 12,
              justifyContent: 'center',
              backgroundColor: colors.surfaceContainerHigh,
              borderWidth: 1,
              borderColor: colors.outlineVariant,
            }}>
            <AppText role="labelLarge" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>
              {genre.title}
            </AppText>
          </TVFocusable>
        ))}
      </ScrollView>
    </View>
  );
};

export default GenreChips;
