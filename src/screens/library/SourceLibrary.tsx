import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';
import {FlashList, type FlashListRef} from '@shopify/flash-list';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, BackHandler, ScrollView, View, useWindowDimensions, type HostInstance} from 'react-native';
import MediaPosterCard from '../../components/MediaPosterCard';
import FixMatch from '../../components/netlib/FixMatch';
import Chip from '../../components/torrentSearch/Chip';
import {TVFocusable} from '../../components/tv';
import MaterialDialogSurface from '../../components/ui/MaterialDialogSurface';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import {getSourceSettings, removeDeviceSource, setSourceSettings} from '../../lib/netlib/cache';
import {itemTab, itemTitle, itemYear} from '../../lib/netlib/group';
import {NETLIB_PROVIDER, netlibLink, normalizeTitle, versionKey} from '../../lib/netlib/ids';
import {listNetlibFolder, scanNetlibSource, cancelNetlibScan, useNetlibLibrary, useNetlibStore} from '../../lib/netlib/library';
import {playNetlibVersion} from '../../lib/netlib/playback';
import {netlibResume} from '../../lib/netlib/continueWatching';
import {watchProgressStorage} from '../../lib/storage';
import {findNetlibSource} from '../../lib/netlib/resolve';
import {isNetlibVideo} from '../../lib/netlib/parsePath';
import type {NetlibEntry, NetlibItem, NetlibSort, NetlibSource} from '../../lib/netlib/types';
import {getNodeHandle, requestTVFocusByHandle} from '../../lib/tv/focus';
import {isTV} from '../../lib/tv/constants';
import {useM3Colors} from '../../theme/M3PaletteContext';

export type LibraryTab = 'movies' | 'shows' | 'other' | 'folders';

const TABS: {id: LibraryTab; label: string}[] = [
  {id: 'movies', label: 'Movies'},
  {id: 'shows', label: 'Shows'},
  {id: 'other', label: 'Other'},
  {id: 'folders', label: 'Folders'},
];

const SORTS: {id: NetlibSort; label: string}[] = [
  {id: 'title', label: 'A-Z'},
  {id: 'added', label: 'Recently added'},
  {id: 'year', label: 'Year'},
];

/** Sorts and searches one tab of a library. */
export const visibleItems = (items: NetlibItem[], tab: LibraryTab, sort: NetlibSort, query: string): NetlibItem[] => {
  const want = normalizeTitle(query);
  const shown = items.filter(
    item => itemTab(item) === tab && (!want || normalizeTitle(`${itemTitle(item)} ${item.title}`).includes(want)),
  );
  const byTitle = (a: NetlibItem, b: NetlibItem) => itemTitle(a).localeCompare(itemTitle(b), undefined, {sensitivity: 'base', numeric: true});
  return shown.sort((a, b) =>
    sort === 'added' ? b.added - a.added || byTitle(a, b) : sort === 'year' ? (itemYear(b) || 0) - (itemYear(a) || 0) || byTitle(a, b) : byTitle(a, b),
  );
};

const EMPTY_TEXT: Record<Exclude<LibraryTab, 'folders'>, string> = {
  movies: 'No movies yet. Files named like "Title (2010).mkv", or in a folder named that way, show up here.',
  shows: 'No shows yet. Episodes named like "Show S01E02.mkv", or in "Show/Season 1" folders, show up here.',
  other: 'Nothing here. Home videos and files without a title or year wait here until you fix their match.',
};

type Navigation = {navigate: (screen: string, params?: object) => void; goBack: () => void; getState?: () => {routeNames?: string[]}};

/** Info lives in the Library stack; from Settings it is reached through that tab. */
const openInfo = (navigation: Navigation, params: object) => {
  if (navigation.getState?.()?.routeNames?.includes('Info') !== false) navigation.navigate('Info', params);
  else navigation.navigate('WatchListStack', {screen: 'Info', params});
};

const Notice = ({icon, title, body, children}: {icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; title: string; body: string; children?: React.ReactNode}) => {
  const colors = useM3Colors();
  return (
    <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 20, margin: 16, alignItems: 'flex-start'}}>
      <MaterialCommunityIcons name={icon} size={36} color={colors.primary} />
      <AppText role="titleMedium" style={{color: colors.onSurface, marginTop: 10}}>{title}</AppText>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>{body}</AppText>
      {children ? <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14}}>{children}</View> : null}
    </View>
  );
};

const SettingRow = ({label, description, on, onPress, icon}: {label: string; description?: string; on?: boolean; onPress: () => void; icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name']}) => {
  const colors = useM3Colors();
  return (
    <TVFocusable accessibilityRole={on === undefined ? 'button' : 'switch'} accessibilityLabel={label} accessibilityState={on === undefined ? undefined : {checked: on}} onPress={onPress} borderRadius={14} focusScale={1}
      style={{flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 12, borderRadius: 14, gap: 12}}>
      <MaterialCommunityIcons name={icon || (on ? 'checkbox-marked' : 'checkbox-blank-outline')} size={24} color={colors.primary} />
      <View style={{flex: 1}}>
        <AppText role="bodyLarge" style={{color: colors.onSurface}}>{label}</AppText>
        {description ? <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{description}</AppText> : null}
      </View>
    </TVFocusable>
  );
};

export interface SourceLibraryViewProps {
  sourceId: string;
  navigation: Navigation;
  /** Device folders: pick another folder. */
  onChangeFolder?: () => void;
}

/** Poster grid of one source: Movies, Shows, Other and Folders. */
export const SourceLibraryView = ({sourceId, navigation, onChangeFolder}: SourceLibraryViewProps) => {
  const colors = useM3Colors();
  const {width} = useWindowDimensions();
  const [source, setSource] = useState<NetlibSource | undefined>(() => findNetlibSource(sourceId));
  const library = useNetlibLibrary(sourceId);
  const scan = useNetlibStore(state => state.scans[sourceId]);
  const error = useNetlibStore(state => state.errors[sourceId]);
  const [settings, setSettings] = useState(() => getSourceSettings(sourceId));
  const [tab, setTab] = useState<LibraryTab>('movies');
  const [sort, setSort] = useState<NetlibSort>('title');
  const [query, setQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fixing, setFixing] = useState<NetlibItem>();
  const [folders, setFolders] = useState<{path: string; name: string}[]>([]);
  const [entries, setEntries] = useState<NetlibEntry[]>();
  const [folderError, setFolderError] = useState<string>();
  const [initialCardFocused, setInitialCardFocused] = useState(false);
  const listRef = useRef<FlashListRef<NetlibItem>>(null);
  const topRef = useRef<HostInstance>(null);
  const scrolled = useRef(false);

  useFocusEffect(useCallback(() => setSource(findNetlibSource(sourceId)), [sourceId]));

  // The first visit builds the library; later visits show the saved one.
  useEffect(() => {
    if (source && !library && !scan && !error) scanNetlibSource(sourceId);
  }, [source, library, scan, error, sourceId]);

  const items = useMemo(() => library?.items || [], [library]);
  const counts = useMemo(() => {
    const result = {movies: 0, shows: 0, other: 0};
    items.forEach(item => {
      result[itemTab(item)] += 1;
    });
    return result;
  }, [items]);
  const tabs = TABS.filter(entry => entry.id !== 'other' || (!settings.hideOther && counts.other > 0) || tab === 'other');
  const shown = useMemo(() => (tab === 'folders' ? [] : visibleItems(items, tab, sort, query)), [items, tab, sort, query]);

  // Open on the tab that has something in it.
  useEffect(() => {
    if (tab === 'movies' && library && !counts.movies && counts.shows) setTab('shows');
  }, [library, counts.movies, counts.shows, tab]);

  const posterWidth = isTV ? 150 : 108;
  const columns = Math.max(2, Math.floor((width - 24) / (posterWidth + 12)));
  const cardWidth = Math.floor((width - 24) / columns) - 12;

  const currentFolder = folders[folders.length - 1];
  const loadFolder = useCallback(
    (path: string) => {
      if (!source) return;
      setEntries(undefined);
      setFolderError(undefined);
      listNetlibFolder(source, path)
        .then(list =>
          setEntries(
            list
              .filter(entry => entry.directory || isNetlibVideo(entry.name))
              .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, {numeric: true})),
          ),
        )
        .catch((cause: any) => setFolderError(cause?.message || 'Could not open this folder'));
    },
    [source],
  );
  useEffect(() => {
    if (tab === 'folders' && source) loadFolder(currentFolder?.path ?? (settings.root || source.root));
  }, [tab, source, currentFolder, settings.root, loadFolder]);

  // Back: up a folder, then to the top of the grid, then out.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (fixing || settingsOpen) return false;
        if (tab === 'folders' && folders.length) {
          setFolders(current => current.slice(0, -1));
          return true;
        }
        if (scrolled.current) {
          listRef.current?.scrollToOffset({offset: 0, animated: true});
          scrolled.current = false;
          const handle = getNodeHandle(topRef.current);
          if (isTV && handle) requestTVFocusByHandle(handle);
          return true;
        }
        return false;
      });
      return () => subscription.remove();
    }, [fixing, settingsOpen, tab, folders.length]),
  );

  const updateSettings = (patch: Parameters<typeof setSourceSettings>[1]) => setSettings(setSourceSettings(sourceId, patch));

  const openItem = (item: NetlibItem) =>
    openInfo(navigation, {link: netlibLink(item.id), provider: NETLIB_PROVIDER, poster: item.match?.poster});

  const playEntry = (entry: NetlibEntry) => {
    const key = versionKey(sourceId, entry.path);
    const owner = items.find(item => item.versions.some(version => version.key === key) || item.episodes.some(episode => episode.versions.some(version => version.key === key)));
    const loose: NetlibItem = {id: `${sourceId}|other|${normalizeTitle(entry.path)}|`, sourceId, kind: 'other', title: entry.name, versions: [{key, name: entry.name}], episodes: [], added: 0};
    playNetlibVersion(navigation, owner || loose, key);
  };

  if (!source) {
    return <Notice icon="folder-remove-outline" title="This source was removed" body="Add it again from Library to see its videos here." />;
  }

  const scanning = Boolean(scan);
  const header = (
    <View>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, gap: 4}}>
        <TVFocusable ref={topRef} accessibilityRole="button" accessibilityLabel="Go back" onPress={navigation.goBack} borderRadius={24} style={{padding: 10, borderRadius: 24}}>
          <MaterialCommunityIcons name="arrow-left" size={26} color={colors.onBackground} />
        </TVFocusable>
        <View style={{flex: 1, marginLeft: 4}}>
          <AppText role="titleLarge" numberOfLines={1} style={{color: colors.onBackground}}>{source.name}</AppText>
          <AppText role="bodySmall" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>
            {scan
              ? scan.phase === 'listing'
                ? `Looking for videos… ${scan.found} found`
                : 'Finding posters and details…'
              : library
                ? `${counts.movies} movies · ${counts.shows} shows${counts.other ? ` · ${counts.other} other` : ''}`
                : 'Not scanned yet'}
          </AppText>
        </View>
        {scanning ? <ActivityIndicator color={colors.primary} style={{marginHorizontal: 10}} /> : null}
        <TVFocusable accessibilityRole="button" accessibilityLabel={scanning ? 'Stop scanning' : 'Rescan'} onPress={() => (scanning ? cancelNetlibScan(sourceId) : scanNetlibSource(sourceId))} borderRadius={24} style={{padding: 10, borderRadius: 24}}>
          <MaterialCommunityIcons name={scanning ? 'stop-circle-outline' : 'refresh'} size={24} color={colors.onSurfaceVariant} />
        </TVFocusable>
        <TVFocusable accessibilityRole="button" accessibilityLabel="Library settings" onPress={() => setSettingsOpen(true)} borderRadius={24} style={{padding: 10, borderRadius: 24}}>
          <MaterialCommunityIcons name="tune-variant" size={24} color={colors.onSurfaceVariant} />
        </TVFocusable>
      </View>
      {tab !== 'folders' ? (
        <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerHigh, borderRadius: 28, minHeight: 48, paddingHorizontal: 16, marginHorizontal: 16, marginTop: 8}}>
          <MaterialCommunityIcons name="magnify" size={22} color={colors.onSurfaceVariant} />
          <TextInput value={query} onChangeText={setQuery} placeholder={`Search ${source.name}`} placeholderTextColor={colors.onSurfaceVariant} accessibilityLabel="Search this library" style={{flex: 1, color: colors.onSurface, marginLeft: 8, fontSize: 16}} />
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingHorizontal: 16, paddingTop: 12}}>
        {tabs.map(entry => (
          <Chip key={entry.id} label={entry.id === 'folders' || !library ? entry.label : `${entry.label} ${counts[entry.id as keyof typeof counts]}`} accessibilityLabel={entry.label} selected={tab === entry.id} onPress={() => setTab(entry.id)} />
        ))}
      </ScrollView>
      {tab !== 'folders' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingHorizontal: 16, paddingVertical: 10}}>
          {SORTS.map(entry => (
            <Chip key={entry.id} icon={sort === entry.id ? 'sort' : undefined} label={entry.label} accessibilityLabel={`Sort by ${entry.label}`} selected={sort === entry.id} onPress={() => setSort(entry.id)} />
          ))}
        </ScrollView>
      ) : null}
      {library?.truncated ? (
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, paddingHorizontal: 16}}>
          This source has more videos than one library shows. Pick a smaller folder in library settings.
        </AppText>
      ) : null}
    </View>
  );

  const emptyState = () => {
    if (error) {
      return (
        <Notice icon="cloud-alert-outline" title="Could not reach this source" body={error}>
          <Chip label="Try again" icon="refresh" onPress={() => scanNetlibSource(sourceId)} />
          {source.kind !== 'device' ? <Chip label="Check sign-in" icon="account-key-outline" onPress={() => navigation.navigate('Sources', {openId: sourceId})} /> : null}
        </Notice>
      );
    }
    if (!library || (scanning && !items.length)) {
      return <Notice icon="movie-search-outline" title="Building your library" body="Looking through the folders for videos. Posters appear as titles are found." />;
    }
    if (query) return <Notice icon="magnify-close" title="No matches" body={`Nothing in ${TABS.find(entry => entry.id === tab)?.label} matches "${query}".`} />;
    if (!items.length) {
      return (
        <Notice icon="folder-open-outline" title="No videos found" body="This folder has no video files yet. Pick another folder in library settings, or add videos and rescan.">
          <Chip label="Rescan" icon="refresh" onPress={() => scanNetlibSource(sourceId)} />
          <Chip label="Library settings" icon="tune-variant" onPress={() => setSettingsOpen(true)} />
        </Notice>
      );
    }
    return <Notice icon="information-outline" title="Nothing in this tab" body={EMPTY_TEXT[tab as Exclude<LibraryTab, 'folders'>]} />;
  };

  const folderView = (
    <ScrollView contentContainerStyle={{paddingBottom: 96}}>
      {header}
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8}}>
        <AppText role="labelLarge" numberOfLines={1} style={{color: colors.onSurfaceVariant, flex: 1}}>
          {['Top', ...folders.map(folder => folder.name)].join(' › ')}
        </AppText>
        {folders.length ? (
          <Chip
            label="Use as library folder"
            icon="folder-star-outline"
            onPress={() => {
              updateSettings({root: currentFolder.path});
              setFolders([]);
              setTab('movies');
              scanNetlibSource(sourceId);
            }}
          />
        ) : null}
      </View>
      {folderError ? <Notice icon="folder-alert-outline" title="Could not open this folder" body={folderError} /> : null}
      {!entries && !folderError ? <ActivityIndicator color={colors.primary} style={{marginTop: 24}} /> : null}
      {entries && !entries.length ? <Notice icon="folder-outline" title="Empty folder" body="No folders or videos here." /> : null}
      {entries?.map((entry, index) => (
        <TVFocusable
          key={entry.path}
          accessibilityRole="button"
          accessibilityLabel={entry.directory ? `Open ${entry.name}` : `Play ${entry.name}`}
          hasTVPreferredFocus={isTV && index === 0}
          onPress={() => (entry.directory ? setFolders(current => [...current, {path: entry.path, name: entry.name}]) : playEntry(entry))}
          borderRadius={14}
          focusScale={1}
          style={{flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, marginHorizontal: 12, paddingHorizontal: 12, borderRadius: 14}}>
          <MaterialCommunityIcons name={entry.directory ? 'folder' : 'play-circle-outline'} size={26} color={colors.primary} />
          <AppText role="bodyLarge" numberOfLines={2} style={{color: colors.onSurface, flex: 1}}>{entry.name}</AppText>
        </TVFocusable>
      ))}
    </ScrollView>
  );

  return (
    <View style={{flex: 1, backgroundColor: colors.background}}>
      {tab === 'folders' ? (
        folderView
      ) : (
        <FlashList
          ref={listRef}
          data={shown}
          numColumns={columns}
          key={`grid-${columns}`}
          keyExtractor={item => item.id}
          ListHeaderComponent={header}
          ListEmptyComponent={emptyState()}
          contentContainerStyle={{paddingHorizontal: 6, paddingBottom: 96}}
          onScroll={event => {
            scrolled.current = event.nativeEvent.contentOffset.y > 40;
          }}
          renderItem={({item, index}) => {
            const year = itemYear(item);
            const resume = netlibResume(item, key => watchProgressStorage.getProgress(key) || undefined);
            return (
              <View style={{padding: 6, alignItems: 'center'}}>
                <MediaPosterCard
                  title={itemTitle(item)}
                  poster={item.match?.poster}
                  width={cardWidth}
                  subtitle={item.kind === 'show' ? `${item.episodes.length} ${item.episodes.length === 1 ? 'episode' : 'episodes'}` : year ? String(year) : undefined}
                  badge={item.match?.rating}
                  progress={resume?.mode === 'resume' ? resume.progress : undefined}
                  watched={resume?.finished}
                  fullTitle={!item.match}
                  // FlashList reuses cells, so index 0 alone would claim focus again.
                  hasTVPreferredFocus={isTV && index === 0 && !initialCardFocused}
                  onFocus={initialCardFocused ? undefined : () => setInitialCardFocused(true)}
                  onPress={() => openItem(item)}
                  onLongPress={() => setFixing(item)}
                />
              </View>
            );
          }}
        />
      )}

      <MaterialDialogSurface visible={settingsOpen} onDismiss={() => setSettingsOpen(false)}>
        <AppText role="titleLarge" style={{color: colors.onSurface, marginBottom: 8}}>Library settings</AppText>
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginBottom: 12}}>
          {settings.root ? `Library folder: ${settings.root}` : 'The whole source is in this library.'}
        </AppText>
        <SettingRow
          label="Find posters and details online"
          description="Sends the titles read from file names to TMDB when a key is saved, otherwise to Cinemeta."
          on={settings.matchOnline}
          onPress={() => updateSettings({matchOnline: !settings.matchOnline})}
        />
        <SettingRow label="Show the Other tab" description="Home videos and files without a recognisable title." on={!settings.hideOther} onPress={() => updateSettings({hideOther: !settings.hideOther})} />
        {settings.root ? (
          <SettingRow icon="folder-home-outline" label="Use the whole source" onPress={() => {
            updateSettings({root: undefined});
            setSettingsOpen(false);
            scanNetlibSource(sourceId);
          }} />
        ) : (
          <SettingRow icon="folder-search-outline" label="Choose a library folder" description="Open Folders, go to a folder and pick Use as library folder." onPress={() => {
            setSettingsOpen(false);
            setTab('folders');
          }} />
        )}
        {onChangeFolder ? <SettingRow icon="folder-swap-outline" label="Choose another device folder" onPress={() => {
          setSettingsOpen(false);
          onChangeFolder();
        }} /> : null}
        <SettingRow icon="refresh" label="Rescan now" onPress={() => {
          setSettingsOpen(false);
          scanNetlibSource(sourceId);
        }} />
        {source.kind === 'device' ? (
          <SettingRow icon="folder-remove-outline" label="Remove this folder from Library" description="The videos stay on the device." onPress={() => {
            removeDeviceSource(sourceId);
            setSettingsOpen(false);
            navigation.goBack();
          }} />
        ) : null}
      </MaterialDialogSurface>
      <FixMatch item={fixing} onClose={() => setFixing(undefined)} />
    </View>
  );
};

const SourceLibrary = ({navigation, route}: {navigation: any; route: {params: {sourceId: string}}}) => (
  <SourceLibraryView sourceId={route.params.sourceId} navigation={navigation} />
);

export default SourceLibrary;
