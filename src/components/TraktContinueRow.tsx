/**
 * "Continue on Trakt": movies and episodes paused part way on other apps or
 * devices linked to Trakt. They have no source here, so a card opens the
 * title in Find streams; playing it from any source starts at the Trakt
 * position when this device has no progress of its own.
 */
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FlatList, View} from 'react-native';
import {getActiveProfileId} from '../lib/profiles/scope';
import {cachedTraktPoster, findTraktPoster} from '../lib/watchSync/traktPosters';
import {
  hideTraktPlayback,
  normalizeTitle,
  readTraktPlayback,
  refreshTraktPlayback,
  traktPlaybackAvailable,
  type TraktPlaybackItem,
} from '../lib/watchSync/traktProgress';
import {showAppDialog} from '../lib/zustand/appDialogStore';
import useContinueWatchingStore from '../lib/zustand/continueWatchingStore';
import {useM3Colors} from '../theme/M3PaletteContext';
import MediaPosterCard from './MediaPosterCard';
import AppText from './ui/Text';

const CARD_WIDTH = 124;

/** "S2 · E5 · Title" for an episode. */
export const traktSubtitle = (item: TraktPlaybackItem): string | undefined =>
  item.type === 'series' ? [`S${item.season} · E${item.episode}`, item.episodeTitle].filter(Boolean).join(' · ') : item.year ? String(item.year) : undefined;

/** Trakt rows for titles this device is not already continuing. */
export const withoutLocalTitles = (items: TraktPlaybackItem[], localTitles: string[]): TraktPlaybackItem[] => {
  const local = new Set(localTitles.map(normalizeTitle));
  return items.filter(item => !local.has(normalizeTitle(item.title)));
};

const TraktCard = ({item, onOpen, onRemove}: {item: TraktPlaybackItem; onOpen: (item: TraktPlaybackItem, poster?: string) => void; onRemove: (item: TraktPlaybackItem) => void}) => {
  const [poster, setPoster] = useState(() => cachedTraktPoster(item) || undefined);
  useEffect(() => {
    if (poster) return;
    let alive = true;
    findTraktPoster(item)
      .then(url => alive && url && setPoster(url))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [item, poster]);
  return (
    <MediaPosterCard
      title={item.title}
      subtitle={traktSubtitle(item)}
      poster={poster}
      width={CARD_WIDTH}
      cornerTag="Trakt"
      progress={item.progress / 100}
      onPress={() => onOpen(item, poster)}
      onLongPress={() => onRemove(item)}
    />
  );
};

const TraktContinueRow = () => {
  const colors = useM3Colors();
  const navigation = useNavigation<any>();
  const profileId = getActiveProfileId();
  const [items, setItems] = useState<TraktPlaybackItem[]>(() => readTraktPlayback());
  const localTitles = useContinueWatchingStore(state => state.items.map(item => item.title).join('\n'));

  // Asked again when Home comes back into view, at most every few minutes.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setItems(readTraktPlayback());
      if (traktPlaybackAvailable()) {
        refreshTraktPlayback()
          .then(list => alive && setItems(list))
          .catch(() => undefined);
      }
      return () => {
        alive = false;
      };
      // A profile switch shows that profile's Trakt progress.
    }, [profileId]),
  );

  const shown = useMemo(() => withoutLocalTitles(items, localTitles ? localTitles.split('\n') : []), [items, localTitles]);

  const open = useCallback(
    (item: TraktPlaybackItem, poster?: string) => {
      const params = {
        title: item.title,
        type: item.type,
        year: item.year,
        imdbId: item.imdbId,
        poster,
        ...(item.type === 'series' ? {season: item.season, episode: item.episode} : {}),
      };
      (navigation.getParent?.() ?? navigation).navigate('TorrentsStack', {screen: 'StreamFinder', initial: false, params});
    },
    [navigation],
  );

  const remove = useCallback((item: TraktPlaybackItem) => {
    showAppDialog({
      title: 'Remove from this row?',
      message: `${item.title} leaves Continue on Trakt on this device. Trakt keeps your progress.`,
      actions: [
        {label: 'Cancel'},
        {
          label: 'Remove',
          variant: 'destructive',
          onPress: () => {
            hideTraktPlayback(item.id);
            setItems(readTraktPlayback());
          },
        },
      ],
    });
  }, []);

  if (!shown.length) return null;
  return (
    <View style={{gap: 12, marginTop: 24}}>
      <AppText role="titleLargeEmphasized" numberOfLines={1} style={{color: colors.onBackground, paddingHorizontal: 20}}>
        Continue on Trakt
      </AppText>
      <FlatList
        horizontal
        data={shown}
        keyExtractor={item => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{paddingHorizontal: 20, gap: 14}}
        renderItem={({item}) => <TraktCard item={item} onOpen={open} onRemove={remove} />}
      />
    </View>
  );
};

export default TraktContinueRow;
