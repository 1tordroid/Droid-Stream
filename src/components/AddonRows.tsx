import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FlatList, View} from 'react-native';
import {
  CATALOG_TTL_MS,
  itemsForProfile,
  loadCatalogRow,
  LOW_MEMORY_ROW_ITEM_LIMIT,
  ROW_ITEM_LIMIT,
  type RowItem,
} from '../lib/addonRows/catalogs';
import {rowsForHome, rowTitle, useAddonRowsStore, type AddonRow} from '../lib/addonRows/rows';
import {getTotalRamMB} from '../lib/deviceMemory';
import {scheduleWhenIdle} from '../lib/performance/idleWork';
import useProfilesStore from '../lib/profiles/useProfiles';
import {cacheStorage} from '../lib/storage/StorageService';
import {readAddons, type InstalledAddon} from '../lib/stremio';
import {isTV} from '../lib/tv/constants';
import {useM3Colors} from '../theme/M3PaletteContext';
import FadeIn from './FadeIn';
import MediaPosterCard from './MediaPosterCard';
import PosterRowSkeleton from './PosterRowSkeleton';
import AppText from './ui/Text';

const CARD_WIDTH = 124;
const LOW_MEMORY_RAM_MB = 2048;

const itemKey = (item: RowItem) => item.id;

/** Where a tap goes: Find streams, or provider search on a kids profile. */
export const itemRoute = (item: RowItem, kids: boolean) =>
  kids
    ? {tab: 'SearchStack', screen: 'SearchResults', params: {filter: item.name}}
    : {
        tab: 'TorrentsStack',
        screen: 'StreamFinder',
        params: {title: item.name, type: item.type, imdbId: item.imdbId, poster: item.poster, year: item.year},
      };

const CatalogRow = ({
  row,
  enabled,
  kids,
  limit,
  onSettled,
}: {
  row: AddonRow;
  enabled: boolean;
  kids: boolean;
  limit: number;
  onSettled: () => void;
}) => {
  const colors = useM3Colors();
  const navigation = useNavigation<any>();
  const query = useQuery({
    queryKey: ['addonRow', row.addonBase, row.type, row.catalogId, row.extra ?? null, limit],
    queryFn: ({signal}) => loadCatalogRow(row, {store: cacheStorage, limit, signal}),
    enabled,
    staleTime: CATALOG_TTL_MS,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });
  const settled = query.isSuccess || query.isError;
  useEffect(() => {
    if (settled) onSettled();
  }, [onSettled, settled]);

  const items = useMemo(() => itemsForProfile(query.data ?? [], kids), [kids, query.data]);
  const open = useCallback(
    (item: RowItem) => {
      const route = itemRoute(item, kids);
      (navigation.getParent() ?? navigation).navigate(route.tab, {screen: route.screen, initial: false, params: route.params});
    },
    [kids, navigation],
  );
  // Long-press opens the row editor. A kids profile has no Settings.
  const edit = useCallback(() => {
    (navigation.getParent() ?? navigation).navigate('SettingsStack', {screen: 'HomeRows', initial: false});
  }, [navigation]);

  if (enabled && query.isLoading) return <PosterRowSkeleton />;
  if (!items.length) return null;
  return (
    <FadeIn style={{marginTop: 24}}>
      <AppText role="titleLargeEmphasized" numberOfLines={1} style={{color: colors.onBackground, paddingHorizontal: 20, marginBottom: 12}}>
        {rowTitle(row)}
      </AppText>
      <FlatList
        horizontal
        data={items}
        keyExtractor={itemKey}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{paddingHorizontal: 20, gap: 12}}
        initialNumToRender={isTV ? 7 : 4}
        maxToRenderPerBatch={4}
        windowSize={isTV ? 5 : 3}
        removeClippedSubviews={!isTV}
        renderItem={({item}) => (
          <MediaPosterCard
            title={item.name}
            poster={item.poster}
            width={CARD_WIDTH}
            onPress={() => open(item)}
            onLongPress={kids ? undefined : edit}
          />
        )}
      />
    </FadeIn>
  );
};

/**
 * Rows from Stremio add-on catalogs, chosen in Settings > Home rows. They
 * come after the provider rows and the Top 10 rows. Rows load one after
 * another once Home is idle, and each keeps its titles for 6 hours.
 */
const AddonRows = () => {
  const rows = useAddonRowsStore(state => state.rows);
  const kids = useProfilesStore(state => state.kids);
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const [started, setStarted] = useState(false);
  const [settledCount, setSettledCount] = useState(0);
  const limit = useMemo(() => (getTotalRamMB() <= LOW_MEMORY_RAM_MB ? LOW_MEMORY_ROW_ITEM_LIMIT : ROW_ITEM_LIMIT), []);

  // Add-ons can be added or turned off on another screen.
  useFocusEffect(
    useCallback(() => {
      if (!rows.length) return;
      return scheduleWhenIdle(() => {
        setAddons(readAddons());
        setStarted(true);
      });
    }, [rows.length]),
  );

  const visible = useMemo(() => rowsForHome(rows, addons, {kids}), [addons, kids, rows]);
  const settle = useCallback((index: number) => setSettledCount(count => Math.max(count, index + 1)), []);
  const callbacks = useMemo(() => visible.map((_, index) => () => settle(index)), [settle, visible]);

  if (!started || !visible.length) return null;
  return (
    <View>
      {visible.map((row, index) => (
        <CatalogRow
          key={row.id}
          row={row}
          enabled={index <= settledCount}
          kids={kids}
          limit={limit}
          onSettled={callbacks[index]}
        />
      ))}
    </View>
  );
};

export default AddonRows;
