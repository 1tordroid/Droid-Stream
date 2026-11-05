import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList, Image, Keyboard, Pressable, ScrollView, TextInput, View} from 'react-native';
import Chip from '../../components/torrentSearch/Chip';
import ResultActions from '../../components/torrentSearch/ResultActions';
import ResultRow, {engineName} from '../../components/torrentSearch/ResultRow';
import {TVFocusable} from '../../components/tv';
import AppText from '../../components/ui/Text';
import {identifyResults, type Identified} from '../../lib/torrentSearch/identify';
import {checkAllCaches, connectedServices, readDebridSettings, type DebridId} from '../../lib/debrid';
import {applyFilters, sortResults, suggestions} from '../../lib/torrentSearch/rank';
import {activeEngines, searchAll, type SearchRun} from '../../lib/torrentSearch/search';
import {
  clearHistory,
  pushHistory,
  readBookmarks,
  readHistory,
  readSearchSettings,
  removeHistory,
  toggleBookmark,
  updateSearchSettings,
} from '../../lib/torrentSearch/store';
import {
  defaultFilters,
  TORRENT_CATEGORIES,
  type EngineStatus,
  type ResultFilters,
  type SortKey,
  type TorrentCategory,
  type TorrentResult,
} from '../../lib/torrentSearch/types';
import {useM3Colors} from '../../theme/M3PaletteContext';

type Mode = 'results' | 'trending' | 'saved';

const SORTS: {id: SortKey; label: string}[] = [
  {id: 'relevance', label: 'Best match'},
  {id: 'seeders', label: 'Seeders'},
  {id: 'size', label: 'Size'},
  {id: 'date', label: 'Newest'},
  {id: 'leechers', label: 'Leechers'},
  {id: 'name', label: 'Name'},
];

const QUALITIES = ['2160p', '1080p', '720p', '480p'];

const TorrentSearch = ({navigation, route}: {navigation: any; route?: {params?: {query?: string; category?: TorrentCategory}}}) => {
  const colors = useM3Colors();
  const initial = readSearchSettings();
  const [query, setQuery] = useState(route?.params?.query || '');
  const [submitted, setSubmitted] = useState('');
  const [mode, setMode] = useState<Mode>('results');
  const [category, setCategory] = useState<TorrentCategory>(route?.params?.category || initial.category);
  const [sort, setSort] = useState<SortKey>(initial.sort);
  const [filters, setFilters] = useState<ResultFilters>(initial.filters);
  const [showFilters, setShowFilters] = useState(false);
  const [rows, setRows] = useState<TorrentResult[]>([]);
  const [status, setStatus] = useState<Record<string, EngineStatus>>({});
  const [showStatus, setShowStatus] = useState(false);
  const [page, setPage] = useState(1);
  const [cached, setCached] = useState<Record<string, DebridId[]>>({});
  const [focused, setFocused] = useState(false);
  const [history, setHistory] = useState(readHistory);
  const [bookmarks, setBookmarks] = useState(readBookmarks);
  const [selected, setSelected] = useState<TorrentResult>();
  const [notice, setNotice] = useState(!initial.acknowledged);
  const [identified, setIdentified] = useState<Identified>();
  const runRef = useRef<SearchRun | undefined>(undefined);
  const cacheTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refreshCache = useCallback((list: TorrentResult[]) => {
    if (!connectedServices().some(service => service.canCheckCache)) return;
    clearTimeout(cacheTimer.current);
    cacheTimer.current = setTimeout(() => {
      checkAllCaches(list.map(row => row.infoHash || '').filter(Boolean)).then(setCached).catch(() => undefined);
    }, 700);
  }, []);

  const start = useCallback(
    (text: string, nextMode: Mode, nextCategory: TorrentCategory, nextPage = 1) => {
      runRef.current?.cancel();
      Keyboard.dismiss();
      setFocused(false);
      if (nextMode === 'saved') return;
      if (nextMode === 'results' && !text.trim()) return;
      if (nextPage === 1) setRows([]);
      const previous = nextPage === 1 ? [] : rows;
      if (nextMode === 'results') setHistory(pushHistory(text));
      setSubmitted(text.trim());
      setPage(nextPage);
      runRef.current = searchAll(text.trim(), {
        category: nextCategory,
        page: nextPage,
        mode: nextMode === 'trending' ? 'trending' : 'search',
        onUpdate: (found, nextStatus) => {
          const merged = nextPage === 1 ? found : [...previous, ...found.filter(row => !previous.some(old => old.id === row.id))];
          setRows(merged);
          setStatus(nextStatus);
          refreshCache(merged);
        },
      });
    },
    [rows, refreshCache],
  );

  useEffect(() => {
    if (route?.params?.query) start(route.params.query, 'results', category);
    return () => runRef.current?.cancel();
  }, [route?.params?.query]);

  const loadingNow = Object.values(status).some(item => item.state === 'loading');
  useEffect(() => {
    if (mode !== 'results' || loadingNow || rows.length < 3) {
      if (!rows.length) setIdentified(undefined);
      return;
    }
    let live = true;
    identifyResults(rows).then(found => live && setIdentified(found)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [rows, loadingNow, mode]);

  const source = mode === 'saved' ? bookmarks : rows;
  const visible = useMemo(() => {
    const filtered = applyFilters(source, filters).filter(row => mode === 'saved' || category === 'all' || row.category === category || row.category === 'other');
    const cachedOnly = readDebridSettings().cachedOnly && Object.keys(cached).length > 0;
    const list = cachedOnly ? filtered.filter(row => row.infoHash && cached[row.infoHash]) : filtered;
    const sorted = sortResults(list, sort, submitted);
    // Cached torrents first: they play instantly.
    return Object.keys(cached).length ? [...sorted.filter(row => row.infoHash && cached[row.infoHash]), ...sorted.filter(row => !(row.infoHash && cached[row.infoHash]))] : sorted;
  }, [source, filters, sort, submitted, cached, category, mode]);

  const states = Object.values(status);
  const loading = states.some(item => item.state === 'loading');
  const done = states.filter(item => item.state === 'done').length;
  const failed = states.filter(item => item.state === 'error');
  const filterCount =
    (filters.minSeeders ? 1 : 0) + (filters.minSizeMb || filters.maxSizeMb ? 1 : 0) + filters.qualities.length + (filters.exclude ? 1 : 0) + (filters.within ? 1 : 0) + (filters.hideZeroSeed ? 1 : 0);

  const saveFilters = (next: ResultFilters) => {
    setFilters(next);
    updateSearchSettings({filters: next});
  };
  const chooseCategory = (next: TorrentCategory) => {
    setCategory(next);
    updateSearchSettings({category: next});
    if (mode === 'trending' || submitted) start(mode === 'trending' ? '' : submitted, mode, next);
  };
  const chooseMode = (next: Mode) => {
    setMode(next);
    if (next === 'saved') setBookmarks(readBookmarks());
    if (next === 'trending') start('', 'trending', category);
    if (next === 'results' && submitted) start(submitted, 'results', category);
  };

  const header = (
    <View>
      {notice ? (
        <View style={{backgroundColor: colors.surfaceContainerHigh, borderRadius: 16, padding: 12, marginBottom: 8}}>
          <AppText role="bodyMedium" style={{color: colors.onSurface}}>
            Droid Stream searches public sites you turn on. It hosts nothing. Only download what you have the rights to, and use a VPN for direct torrents.
          </AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss search notice" onPress={() => { updateSearchSettings({acknowledged: true}); setNotice(false); }} style={{minHeight: 44, justifyContent: 'center'}}>
            <AppText style={{color: colors.primary}}>I understand</AppText>
          </Pressable>
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingVertical: 4}}>
        {TORRENT_CATEGORIES.map(item => (
          <Chip key={item.id} label={item.label} icon={item.icon as any} selected={category === item.id} onPress={() => chooseCategory(item.id)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingVertical: 8}}>
        <Chip label={filterCount ? `Filters · ${filterCount}` : 'Filters'} icon="filter-variant" selected={showFilters || filterCount > 0} onPress={() => setShowFilters(value => !value)} />
        {SORTS.map(item => (
          <Chip key={item.id} label={item.label} selected={sort === item.id} onPress={() => { setSort(item.id); updateSearchSettings({sort: item.id}); }} />
        ))}
      </ScrollView>
      {showFilters ? <FilterPanel filters={filters} onChange={saveFilters} /> : null}
      {identified?.meta && mode === 'results' ? (
        <TVFocusable accessibilityRole="button" accessibilityLabel={`Find streams for ${identified.meta.name}`}
          onPress={() => navigation.navigate('StreamFinder', {title: identified.meta!.name, type: identified.type, year: identified.year, imdbId: identified.meta!.id, poster: identified.meta!.poster})}
          borderRadius={16} style={{flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerHigh, borderRadius: 16, padding: 10, marginBottom: 8}}>
          {identified.meta.poster ? <Image source={{uri: identified.meta.poster}} style={{width: 44, height: 64, borderRadius: 8, marginRight: 12}} /> : null}
          <View style={{flex: 1}}>
            <AppText role="titleSmall" style={{color: colors.onSurface}}>{identified.meta.name}{identified.meta.releaseInfo ? ` (${identified.meta.releaseInfo})` : ''}</AppText>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{identified.type === 'series' ? 'Pick an episode and play the best source' : 'Play the best source from add-ons, sites, and caches'}</AppText>
          </View>
          <MaterialCommunityIcons name="play-circle" size={32} color={colors.primary} />
        </TVFocusable>
      ) : null}
      {states.length && mode !== 'saved' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Show site status" onPress={() => setShowStatus(value => !value)} style={{minHeight: 40, flexDirection: 'row', alignItems: 'center'}}>
          <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, flex: 1}}>
            {loading ? `Searching ${states.length - done - failed.length} of ${states.length} sites…` : `${done} of ${states.length} sites answered`} · {visible.length} results
            {failed.length ? ` · ${failed.length} failed` : ''}
          </AppText>
          <MaterialCommunityIcons name={showStatus ? 'chevron-up' : 'chevron-down'} size={20} color={colors.onSurfaceVariant} />
        </Pressable>
      ) : null}
      {showStatus ? (
        <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 12, padding: 8, marginBottom: 8}}>
          {states.map(item => (
            <View key={item.engine} style={{flexDirection: 'row', paddingVertical: 4}}>
              <MaterialCommunityIcons name={item.state === 'done' ? 'check-circle' : item.state === 'error' ? 'alert-circle' : 'progress-clock'} size={18}
                color={item.state === 'done' ? '#4CAF50' : item.state === 'error' ? colors.error : colors.onSurfaceVariant} />
              <AppText role="bodySmall" style={{color: colors.onSurface, marginLeft: 8, flex: 1}}>
                {engineName(item.engine)} · {item.state === 'error' ? item.error : item.state === 'done' ? `${item.count} in ${(item.ms / 1000).toFixed(1)}s` : 'waiting'}
              </AppText>
            </View>
          ))}
          <Pressable accessibilityRole="button" accessibilityLabel="Manage torrent sites" onPress={() => navigation.navigate('TorrentSources')} style={{minHeight: 40, justifyContent: 'center'}}>
            <AppText style={{color: colors.primary}}>Manage sites and mirrors</AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} hitSlop={8} style={{minWidth: 40, minHeight: 48, justifyContent: 'center'}}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerHigh, borderRadius: 28, paddingHorizontal: 16, minHeight: 52}}>
          <MaterialCommunityIcons name="magnify" size={22} color={colors.onSurfaceVariant} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setFocused(true)}
            onSubmitEditing={() => { setMode('results'); start(query, 'results', category); }}
            returnKeyType="search"
            placeholder={`Search ${activeEngines(category).length} torrent sites`}
            placeholderTextColor={colors.onSurfaceVariant}
            accessibilityLabel="Search torrent sites"
            autoCorrect={false}
            style={{flex: 1, color: colors.onSurface, marginLeft: 8, fontSize: 16}}
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} hitSlop={8}>
              <MaterialCommunityIcons name="close" size={20} color={colors.onSurfaceVariant} />
            </Pressable>
          ) : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Debrid and cloud services" onPress={() => navigation.navigate('DebridSettings')} hitSlop={8} style={{minWidth: 40, minHeight: 48, alignItems: 'center', justifyContent: 'center'}}>
          <MaterialCommunityIcons name="lightning-bolt" size={24} color={connectedServices().length ? colors.primary : colors.onSurfaceVariant} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Torrent sites" onPress={() => navigation.navigate('TorrentSources')} hitSlop={8} style={{minWidth: 40, minHeight: 48, alignItems: 'center', justifyContent: 'center'}}>
          <MaterialCommunityIcons name="web" size={24} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>
      {focused ? (
        <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 16, marginTop: 8, paddingVertical: 4}}>
          {suggestions(query, history).map(item => (
            <View key={item} style={{flexDirection: 'row', alignItems: 'center'}}>
              <TVFocusable accessibilityRole="button" accessibilityLabel={`Search ${item}`} onPress={() => { setQuery(item); setMode('results'); start(item, 'results', category); }}
                style={{flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 16}}>
                <MaterialCommunityIcons name={history.includes(item) ? 'history' : 'magnify'} size={20} color={colors.onSurfaceVariant} />
                <AppText role="bodyLarge" numberOfLines={1} style={{color: colors.onSurface, marginLeft: 12}}>{item}</AppText>
              </TVFocusable>
              {history.includes(item) ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item} from history`} onPress={() => setHistory(removeHistory(item))} hitSlop={8} style={{padding: 12}}>
                  <MaterialCommunityIcons name="close" size={18} color={colors.onSurfaceVariant} />
                </Pressable>
              ) : null}
            </View>
          ))}
          {history.length ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search history" onPress={() => { clearHistory(); setHistory([]); }} style={{minHeight: 44, justifyContent: 'center', paddingHorizontal: 16}}>
              <AppText style={{color: colors.primary}}>Clear history</AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={{flexDirection: 'row', gap: 8, marginTop: 10}}>
        <Chip label="Results" icon="format-list-bulleted" selected={mode === 'results'} onPress={() => chooseMode('results')} />
        <Chip label="Trending" icon="fire" selected={mode === 'trending'} onPress={() => chooseMode('trending')} />
        <Chip label={`Saved${bookmarks.length ? ` · ${bookmarks.length}` : ''}`} icon="bookmark" selected={mode === 'saved'} onPress={() => chooseMode('saved')} />
      </View>
      <FlatList
        data={visible}
        keyExtractor={item => item.id}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{paddingTop: 8, paddingBottom: 96}}
        renderItem={({item}) => (
          <ResultRow
            item={item}
            cached={item.infoHash ? cached[item.infoHash] : undefined}
            bookmarked={bookmarks.some(saved => saved.id === item.id)}
            onPress={() => setSelected(item)}
            onBookmark={() => { toggleBookmark(item); setBookmarks(readBookmarks()); }}
          />
        )}
        ListEmptyComponent={
          <View style={{alignItems: 'center', paddingTop: 48}}>
            <MaterialCommunityIcons name={mode === 'saved' ? 'bookmark-outline' : loading ? 'progress-clock' : 'magnet'} size={48} color={colors.outline} />
            <AppText role="bodyLarge" style={{color: colors.onSurfaceVariant, marginTop: 12, textAlign: 'center'}}>
              {mode === 'saved'
                ? 'Saved torrents appear here.'
                : loading
                  ? 'Searching…'
                  : submitted || mode === 'trending'
                    ? 'Nothing found. Try other words, another category, or turn on more sites.'
                    : 'Search movies, shows, anime, music, games, apps, and books across every site you turn on.'}
            </AppText>
          </View>
        }
        ListFooterComponent={
          mode === 'results' && submitted && !loading && rows.length ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Load more results" onPress={() => start(submitted, 'results', category, page + 1)} style={{minHeight: 52, alignItems: 'center', justifyContent: 'center'}}>
              <AppText style={{color: colors.primary}}>Load more</AppText>
            </Pressable>
          ) : null
        }
      />
      {selected ? (
        <ResultActions
          result={selected}
          cached={selected.infoHash ? cached[selected.infoHash] : undefined}
          navigation={navigation}
          onClose={() => setSelected(undefined)}
          onBookmarkChange={() => setBookmarks(readBookmarks())}
        />
      ) : null}
    </View>
  );
};

const FilterPanel = ({filters, onChange}: {filters: ResultFilters; onChange: (next: ResultFilters) => void}) => {
  const colors = useM3Colors();
  const number = (label: string, value: number, key: keyof ResultFilters) => (
    <View style={{flex: 1}}>
      <AppText role="labelMedium" style={{color: colors.onSurfaceVariant}}>{label}</AppText>
      <TextInput accessibilityLabel={label} keyboardType="number-pad" value={value ? String(value) : ''} placeholder="Any" placeholderTextColor={colors.outline}
        onChangeText={text => onChange({...filters, [key]: Number(text.replace(/\D/g, '') || 0)})} style={{color: colors.onSurface, minHeight: 44, borderBottomWidth: 1, borderColor: colors.outlineVariant}} />
    </View>
  );
  return (
    <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 16, padding: 12, marginBottom: 8, gap: 10}}>
      <View style={{flexDirection: 'row', gap: 12}}>
        {number('Min seeders', filters.minSeeders, 'minSeeders')}
        {number('Min size MB', filters.minSizeMb, 'minSizeMb')}
        {number('Max size MB', filters.maxSizeMb, 'maxSizeMb')}
      </View>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
        {QUALITIES.map(quality => (
          <Chip key={quality} label={quality === '2160p' ? '4K' : quality} selected={filters.qualities.includes(quality)}
            onPress={() => onChange({...filters, qualities: filters.qualities.includes(quality) ? filters.qualities.filter(item => item !== quality) : [...filters.qualities, quality]})} />
        ))}
        <Chip label="Hide dead" icon="skull-outline" selected={filters.hideZeroSeed} onPress={() => onChange({...filters, hideZeroSeed: !filters.hideZeroSeed})} />
      </View>
      <TextInput accessibilityLabel="Search within results" value={filters.within} onChangeText={within => onChange({...filters, within})} placeholder="Search within results"
        placeholderTextColor={colors.outline} style={{color: colors.onSurface, minHeight: 44, borderBottomWidth: 1, borderColor: colors.outlineVariant}} />
      <TextInput accessibilityLabel="Exclude words" value={filters.exclude} onChangeText={exclude => onChange({...filters, exclude})} placeholder="Exclude words, e.g. cam ts hindi"
        placeholderTextColor={colors.outline} autoCapitalize="none" style={{color: colors.onSurface, minHeight: 44, borderBottomWidth: 1, borderColor: colors.outlineVariant}} />
      <Pressable accessibilityRole="button" accessibilityLabel="Reset filters" onPress={() => onChange(defaultFilters())} style={{minHeight: 40, justifyContent: 'center'}}>
        <AppText style={{color: colors.primary}}>Reset filters</AppText>
      </Pressable>
    </View>
  );
};

export default TorrentSearch;
