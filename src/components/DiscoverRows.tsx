import {useNavigation} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import React from 'react';
import {FlatList, View} from 'react-native';
import {fetchCatalog, fetchMeta, findImdb, type StremioMeta} from '../lib/stremio';
import useContinueWatchingStore from '../lib/zustand/continueWatchingStore';
import {useM3Colors} from '../theme/M3PaletteContext';
import FadeIn from './FadeIn';
import MediaPosterCard from './MediaPosterCard';
import PosterRowSkeleton from './PosterRowSkeleton';
import AppText from './ui/Text';

type MediaType = 'movie' | 'series';

const CARD_WIDTH = 124;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_COUNT = 10;
const SIMILAR_COUNT = 15;

export const yearOf = (meta: StremioMeta): number | undefined =>
  Number(String(meta.releaseInfo || meta.year || '').slice(0, 4)) || undefined;

/** Titles from the same main genre, without the one just watched. */
export const similarTitles = (metas: StremioMeta[], watchedId: string, limit = SIMILAR_COUNT): StremioMeta[] =>
  metas.filter(meta => meta.id !== watchedId && meta.poster).slice(0, limit);

const Row = ({title, type, metas, ranked}: {title: string; type: MediaType; metas: StremioMeta[]; ranked?: boolean}) => {
  const colors = useM3Colors();
  const navigation = useNavigation<any>();
  if (!metas.length) return null;
  return (
    <FadeIn style={{marginTop: 24}}>
      <AppText role="titleLargeEmphasized" numberOfLines={1} style={{color: colors.onBackground, paddingHorizontal: 20, marginBottom: 12}}>{title}</AppText>
      <FlatList
        horizontal
        data={metas}
        keyExtractor={meta => meta.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{paddingHorizontal: 20, gap: 12}}
        renderItem={({item, index}) => (
          <MediaPosterCard
            title={item.name}
            poster={item.poster}
            width={CARD_WIDTH}
            cornerTag={ranked ? `#${index + 1}` : undefined}
            onPress={() => {
              const params = {title: item.name, type, imdbId: item.id, poster: item.poster, year: yearOf(item)};
              (navigation.getParent() ?? navigation).navigate('TorrentsStack', {screen: 'StreamFinder', initial: false, params});
            }}
          />
        )}
      />
    </FadeIn>
  );
};

/** Top 10 lists and a personal row, from the public Cinemeta catalog. */
const DiscoverRows = () => {
  const latest = useContinueWatchingStore(state =>
    state.items.reduce<(typeof state.items)[number] | undefined>(
      (newest, item) => (!newest || item.updatedAt > newest.updatedAt ? item : newest),
      undefined,
    ),
  );
  const watchedTitle = latest?.title;
  const watchedType: MediaType = latest?.type === 'movie' ? 'movie' : 'series';

  const movies = useQuery({
    queryKey: ['discover', 'top', 'movie'],
    queryFn: () => fetchCatalog('movie'),
    staleTime: DAY_MS,
  });
  const series = useQuery({
    queryKey: ['discover', 'top', 'series'],
    queryFn: () => fetchCatalog('series'),
    staleTime: DAY_MS,
  });
  const similar = useQuery({
    queryKey: ['discover', 'because', watchedType, watchedTitle],
    enabled: Boolean(watchedTitle),
    staleTime: DAY_MS,
    queryFn: async () => {
      const found = await findImdb(watchedTitle!, watchedType);
      const meta = found && (await fetchMeta(watchedType, found.id));
      const genre = meta?.genres?.[0];
      if (!found || !genre) return [];
      return similarTitles(await fetchCatalog(watchedType, genre), found.id);
    },
  });

  return (
    <View>
      {similar.data?.length ? <Row title={`Because you watched ${watchedTitle}`} type={watchedType} metas={similar.data} /> : null}
      {movies.isLoading ? <PosterRowSkeleton /> : null}
      <Row title="Top 10 movies" type="movie" metas={(movies.data || []).slice(0, TOP_COUNT)} ranked />
      {series.isLoading ? <PosterRowSkeleton /> : null}
      <Row title="Top 10 shows" type="series" metas={(series.data || []).slice(0, TOP_COUNT)} ranked />
    </View>
  );
};

export default DiscoverRows;
