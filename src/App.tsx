import {
  navigationWorkListeners,
  beginUIInteraction,
  endUIInteraction,
  flushInteractionCommits,
  scheduleWhenIdle,
} from './lib/performance/idleWork';
import React, {useCallback, useEffect, useMemo} from 'react';
import {M3ThemeProvider} from './theme/M3ThemeProvider';
import {THEME_ROLES} from './theme/themeMode';
import useThemeStore from './lib/zustand/themeStore';
import {startTransferRules} from './lib/torrent/transferPolicy';
import './global.css';
import Home from './screens/home/Home';
import Info from './screens/home/Info';
import Player from './screens/home/Player';
import {getInitialVideoIntent, subscribeVideoIntent, setVideoIntentsEnabled, supportsVideoIntents, videoIntentPlayerParams, type VideoIntentPayload} from './lib/services/videoIntent';
import Settings from './screens/settings/Settings';
import Library from './screens/Library';
import LocalContent from './screens/LocalContent';
import LocalLibrary from './screens/LocalLibrary';
import OpenSourceLicenses from './screens/settings/OpenSourceLicenses';
import AdvancedDownloads from './screens/settings/AdvancedDownloads';
import Credits from './screens/settings/Credits';
import CloudFiles from './screens/library/CloudFiles';
import TordroidPlus from './screens/library/TordroidPlus';
import Sources from './screens/Sources';
import LibraryHub from './screens/library/LibraryHub';
import SourceLibrary from './screens/library/SourceLibrary';
import LiveTV from './screens/livetv/LiveTV';
import LiveGuide from './screens/livetv/LiveGuide';
import Torrents from './screens/torrents/Torrents';
import TorrentDetails from './screens/torrents/TorrentDetails';
import TorrentOptions from './screens/torrents/TorrentOptions';
import TorrentSearch from './screens/torrents/TorrentSearch';
import TorrentSources from './screens/torrents/TorrentSources';
import DebridSettings from './screens/torrents/DebridSettings';
import StreamFinder from './screens/torrents/StreamFinder';
import StremioAddons from './screens/torrents/StremioAddons';
import WatchSync from './screens/settings/WatchSync';
import LanguageSettings from './screens/settings/LanguageSettings';
import Profiles from './screens/settings/Profiles';
import ProfileEdit from './screens/settings/ProfileEdit';
import ProfileGate from './components/profiles/ProfileGate';
import useProfilesStore from './lib/profiles/useProfiles';
import YtdlDownload from './screens/ytdl/YtdlDownload';
import YtdlSettings from './screens/ytdl/YtdlSettings';
import YtdlCookies from './screens/ytdl/YtdlCookies';
import Browser from './screens/browser/Browser';
import BrowserSettings from './screens/browser/BrowserSettings';
import BrowserPasswords from './screens/browser/BrowserPasswords';
import SocialDownload from './screens/social/SocialDownload';
import {startYtdlScheduler} from './lib/ytdl/queue';
import UndoSnackbar from './components/UndoSnackbar';
import Search from './screens/Search';
import {isTV} from './lib/tv';
import ScrollList from './screens/ScrollList';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import 'react-native-reanimated';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import WebView from './screens/WebView';
import SearchResults from './screens/SearchResults';
// import DisableProviders from './screens/settings/DisableProviders';
import About from './screens/settings/About';
import {checkForUpdate} from './lib/updates/checkForUpdate';
import {startLinkIntake} from './lib/linkIntake';
import FirstRunTips from './components/FirstRunTips';
import BootSplash from 'react-native-bootsplash';
import {SystemBars} from 'react-native-edge-to-edge';
import {enableFreeze, enableScreens} from 'react-native-screens';
import Preferences from './screens/settings/Preference';
import Ed2k from './screens/settings/Ed2k';
import PlayerSettings from './screens/settings/PlayerSettings';
import PlayerControlSettings from './screens/settings/PlayerControlSettings';
import Appearance from './screens/settings/Appearance';
import DataManagement from './screens/settings/DataManagement';
import {AppState, Linking, LogBox, useWindowDimensions} from 'react-native';
import {vegaCastService} from './lib/remote/vegaCastService';
import {EpisodeLink, Stream} from './lib/providers/types';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import Downloads from './screens/downloads/Downloads';
import DownloadedDetails from './screens/downloads/DownloadedDetails';
import SubtitlePreference from './screens/settings/SubtitleSettings';
import Extensions from './screens/settings/Extensions';
import Constants from 'expo-constants';
import {settingsStorage, migrateWatchProgressFromCacheStorage} from './lib/storage';
import {ensureFreshAll} from './lib/watchSync';
import {flushScrobbleQueue} from './lib/watchSync/scrobble';
import {syncParallelStreaming} from './lib/parallelStreaming';
import {updateProvidersService} from './lib/services/UpdateProviders';
import {QueryClientProvider} from '@tanstack/react-query';
import {queryClient} from './lib/client';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
import notifee, {EventType} from '@notifee/react-native';
import notificationService from './lib/services/Notification';
import WafWebViewDialog from './components/WafWebViewDialog';
import VerificationConsentDialog from './components/VerificationConsentDialog';
import ProviderSandboxHost from './components/ProviderSandboxHost';
import {syncDohSettings} from './lib/services/dohService';
import {startUnblockEvents, syncUnblock} from './lib/unblock/unblockService';
import TorrentVpnTip from './components/unblock/TorrentVpnTip';
import {
  getInitialSourceIntent,
  setPendingSourceToken,
  subscribeSourceIntent,
  type SourceIntentPayload,
} from './lib/services/sourceIntent';
import {
  reconcileCompletedDownloadOutputs,
  reconcileDownloadState,
} from './lib/downloadReconciliation';
import useDownloadsStore from './lib/zustand/downloadsStore';
import {
  initializeSyncService,
  publishSyncManifest,
  syncFromSharedFolder,
} from './lib/sync/syncService';
import StreamingTabBar from './components/navigation/StreamingTabBar';
import AppDialogHost from './components/AppDialogHost';
import {RemoteVolumeToast} from './components/remote-player/RemoteVolumeToast';

enableScreens(true);
enableFreeze(true);

export type HomeStackParamList = {
  Home: undefined;
  Info: {link: string; provider?: string; poster?: string};
  ScrollList: {
    filter: string;
    title?: string;
    providerValue?: string;
    isSearch: boolean;
  };
  Webview: {link: string};
  LiveTV: undefined;
  LiveGuide: {sourceId: string; group?: string};
};

export type RootStackParamList = {
  TabStack:
    | {
        screen?: keyof TabStackParamList;
        params?: {
          screen?: string;
          // Nested screen params, or a leaf screen's own params.
          params?: Record<string, unknown>;
        };
      }
    | undefined;
  Player: {
    linkIndex: number;
    episodeList: EpisodeLink[];
    directUrl?: string;
    localContent?: boolean;
    externalVideo?: {mimeType: string};
    type: string;
    primaryTitle?: string;
    secondaryTitle?: string;
    poster: {
      logo?: string;
      poster?: string;
      background?: string;
    };
    file?: string;
    providerValue?: string;
    infoUrl?: string;
    alwaysCast?: boolean;
    // Plays first, before online servers load (an unfinished download).
    initialStream?: Stream;
    /** What is playing, when known: used for Trakt/Simkl/AniList, AniSkip, and subtitles. */
    meta?: import('./lib/watchMeta').WatchMeta;
    /** A live TV channel: no watch progress or resume point is saved. */
    live?: boolean;
    /** A Live TV catch-up replay: a fixed programme, so no "Go live". */
    catchup?: boolean;
    /** A network library file: episode links are version keys, history stays in the netlib store. */
    netlib?: boolean;
    /** Play best: sources to fall back on when the playing one is dead. */
    playBest?: import('./lib/streams/play').PlayBestPlan;
  };
  /** The yt-dlp Download sheet, from Share or from Downloads. */
  YtdlDownload: {url?: string} | undefined;
  /** The built-in browser (not in a kids profile). */
  Browser: {url?: string; private?: boolean} | undefined;
  BrowserSettings: undefined;
  BrowserPasswords: undefined;
  /** Photos, carousels, stories and songs from a social post. */
  SocialDownload: {url: string};
};

export type SearchStackParamList = {
  Search: undefined;
  ScrollList: {
    filter: string;
    title?: string;
    providerValue?: string;
    isSearch: boolean;
  };
  Info: {link: string; provider?: string; poster?: string};
  SearchResults: {filter: string; availableProviders?: string[]};
};

export type WatchListStackParamList = {
  LibraryHome: undefined;
  DebridSettings: undefined;
  CloudFiles: {mode?: 'list'} | undefined;
  TordroidPlus: undefined;
  LiveTV: undefined;
  LiveGuide: {sourceId: string; group?: string};
  LocalContent: {editId?: string; collectionId?: string} | undefined;
  WatchList: undefined;
  LocalLibrary: undefined;
  SourceLibrary: {sourceId: string};
  Sources: {kind?: string; openId?: string; returnTo?: {tab: string; screen: string}; prefill?: import('./screens/Sources').SourcesParams['prefill']} | undefined;
  Info: {link: string; provider?: string; poster?: string};
};

export type TorrentsStackParamList = {
  Torrents: {highlight?: string} | undefined;
  TorrentDetails: {infoHash: string; highlight?: string};
  TorrentOptions: {highlight?: string} | undefined;
  TorrentSearch: {query?: string; category?: import('./lib/torrentSearch/types').TorrentCategory} | undefined;
  TorrentSources: undefined;
  DebridSettings: undefined;
  StreamFinder: import('./lib/streams/finder').WantedVideo | undefined;
  StremioAddons: undefined;
};

export type SettingsStackParamList = {
  Settings: undefined;
  Appearance: undefined;
  DisableProviders: undefined;
  About: undefined;
  Preferences: undefined;
  Ed2k: undefined;
  PlayerSettings: undefined;
  PlayerControlSettings: undefined;
  SubTitlesPreferences: undefined;
  Extensions: {addSource?: string; requestId?: number} | undefined;
  DownloadsStack: undefined;
  DataManagement: undefined;
  LocalLibrary: undefined;
  OpenSourceLicenses: undefined;
  AdvancedDownloads: undefined;
  Credits: {section?: import('./screens/settings/creditsData').CreditSectionId} | undefined;
  WatchSync: undefined;
  Languages: undefined;
  Profiles: undefined;
  ProfileEdit: {id?: string};
  YtdlSettings: undefined;
  YtdlCookies: undefined;
};

export type DownloadsStackParamList = {
  Downloads: undefined;
  DownloadedDetails: {groupId: string; localTitleId?: never} | {localTitleId: string; groupId?: never};
  Info: {link: string; provider?: string; poster?: string};
};

export type TabStackParamList = {
  HomeStack: undefined;
  SearchStack: undefined;
  TorrentsStack: undefined;
  WatchListStack: undefined;
  SettingsStack: undefined;
};
const Tab = createBottomTabNavigator<TabStackParamList>();
// Navigators and their screen components live at module scope. Created inside
// App, every App render made new component types and remounted all tabs.
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
const SearchStack = createNativeStackNavigator<SearchStackParamList>();
const WatchListStack = createNativeStackNavigator<WatchListStackParamList>();
const TorrentsStack = createNativeStackNavigator<TorrentsStackParamList>();
const DownloadsStack = createNativeStackNavigator<DownloadsStackParamList>();
const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
let pendingVideo: VideoIntentPayload | undefined;
const openVideoIntent = (payload: VideoIntentPayload): void => {
  if (!settingsStorage.isOpenVideosFromOtherAppsEnabled()) return;
  if (!navigationRef.isReady()) {
    pendingVideo = payload;
    return;
  }
  pendingVideo = undefined;
  // Replace an already-open player so its episode and stream state is reset.
  navigationRef.dispatch({
    type: navigationRef.getCurrentRoute()?.name === 'Player' ? 'REPLACE' : 'PUSH',
    payload: {name: 'Player', params: videoIntentPlayerParams(payload)},
  });
};
let pendingDownloadsNavigation = false;
let pendingAddSource: SourceIntentPayload | undefined;

LogBox.ignoreLogs([
  'You have passed a style to FlashList',
  'new NativeEventEmitter()',
  'Failed to fetch manifest',
]);

export const openDownloadsScreen = (): void => {
  // Downloads sit under Settings, which a kids profile does not have.
  if (useProfilesStore.getState().kids) return;
  if (!navigationRef.isReady()) {
    pendingDownloadsNavigation = true;
    return;
  }
  pendingDownloadsNavigation = false;
  navigationRef.navigate('TabStack', {
    screen: 'SettingsStack',
    params: {screen: 'DownloadsStack'},
  });
};

const openTorrentVpnSetting = (): void => {
  if (!navigationRef.isReady()) return;
  (navigationRef.navigate as (...args: unknown[]) => void)('TabStack', {
    screen: 'TorrentsStack',
    params: {screen: 'TorrentOptions', params: {highlight: 'torrent-vpn'}},
  });
};

const openProfilesScreen = (): void => {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('TabStack', {screen: 'SettingsStack', params: {screen: 'Profiles'}});
};

// Opens Extensions with the add source dialog prefilled. The user still
// confirms there, so another app or web page cannot add a source silently.
const openAddSourceScreen = (payload: SourceIntentPayload): void => {
  if (useProfilesStore.getState().kids) return;
  if (!navigationRef.isReady()) {
    pendingAddSource = payload;
    return;
  }
  pendingAddSource = undefined;
  const requestId = Date.now();
  setPendingSourceToken(requestId, payload.token);
  navigationRef.navigate('TabStack', {
    screen: 'SettingsStack',
    params: {
      screen: 'Extensions',
      params: {addSource: payload.url, requestId},
    },
  });
};

const stackScreenOptions = {
  headerShown: false,
  animation: 'ios_from_right',
  animationDuration: 200,
  freezeOnBlur: true,
} as const;

// Pages without their own artwork or safe area stay below the status bar.
const useTopInsetOptions = () => {
  const insets = useSafeAreaInsets();
  return useMemo(
    () => ({contentStyle: {flex: 1, paddingTop: isTV ? 0 : insets.top}}),
    [insets.top],
  );
};

const rootStackScreenOptions = {
  ...stackScreenOptions,
  contentStyle: {backgroundColor: 'transparent'},
} as const;

const navigationTheme = {
  fonts: {
    regular: {
      fontFamily: 'Inter_400Regular',
      fontWeight: '400',
    },
    medium: {
      fontFamily: 'Inter_500Medium',
      fontWeight: '500',
    },
    bold: {
      fontFamily: 'Inter_700Bold',
      fontWeight: '700',
    },
    heavy: {
      fontFamily: 'Inter_800ExtraBold',
      fontWeight: '800',
    },
  },
  dark: true,
  colors: {
    background: 'transparent',
    card: 'black',
    primary: '#E4E4E4',
    text: 'white',
    border: 'black',
    notification: '#E4E4E4',
  },
} as const;

const playerScreenOptions = ({route}: {route: {params?: object}}) => {
  const isRemotePortrait =
    !isTV &&
    (Boolean((route.params as any)?.alwaysCast) ||
      settingsStorage.isAlwaysCastMode());
  return {
    orientation: isTV
      ? ('landscape' as const)
      : isRemotePortrait
        ? ('portrait' as const)
        : ('default' as const),
    statusBarHidden: isTV || !isRemotePortrait,
    navigationBarHidden: isTV || !isRemotePortrait,
    autoHideHomeIndicator: isTV || !isRemotePortrait,
  };
};

type TabIconProps = {focused: boolean; color: string; size: number};
type TabIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const makeTabIcon =
  (focusedName: TabIconName, unfocusedName: TabIconName) =>
  ({focused, color, size}: TabIconProps) => (
    <MaterialCommunityIcons
      name={focused ? focusedName : unfocusedName}
      color={color}
      size={size}
    />
  );

const homeTabOptions = {
  title: 'Home',
  tabBarIcon: makeTabIcon('home-variant', 'home-variant-outline'),
};
const searchTabOptions = {
  title: 'Search',
  tabBarIcon: makeTabIcon('magnify', 'magnify'),
};
const watchListTabOptions = {
  title: 'Library',
  tabBarIcon: makeTabIcon('bookmark', 'bookmark-outline'),
};
const settingsTabOptions = {
  title: 'Settings',
  tabBarIcon: makeTabIcon('cog', 'cog-outline'),
};

const renderTabBar = (props: React.ComponentProps<typeof StreamingTabBar>) => (
  <StreamingTabBar {...props} />
);

function HomeStackScreen() {
  const subpageOptions = useTopInsetOptions();

  return (
    <HomeStack.Navigator
      screenListeners={navigationWorkListeners}
      screenOptions={stackScreenOptions}>
      <HomeStack.Screen name="Home" component={Home} />
      <HomeStack.Screen name="Info" component={Info} />
      <HomeStack.Screen name="ScrollList" component={ScrollList} />
      <HomeStack.Screen name="Webview" component={WebView} />
      <HomeStack.Screen name="LiveTV" component={LiveTV} options={subpageOptions} />
      <HomeStack.Screen name="LiveGuide" component={LiveGuide} options={subpageOptions} />
    </HomeStack.Navigator>
  );
}

function SearchStackScreen() {
  return (
    <SearchStack.Navigator
      screenListeners={navigationWorkListeners}
      screenOptions={stackScreenOptions}>
      <SearchStack.Screen name="Search" component={Search} />
      <SearchStack.Screen name="ScrollList" component={ScrollList} />
      <SearchStack.Screen name="Info" component={Info} />
      <SearchStack.Screen name="SearchResults" component={SearchResults} />
      <HomeStack.Screen name="Webview" component={WebView} />
    </SearchStack.Navigator>
  );
}

function WatchListStackScreen() {
  const subpageOptions = useTopInsetOptions();

  return (
    <WatchListStack.Navigator
      screenListeners={navigationWorkListeners}
      screenOptions={stackScreenOptions}>
      <WatchListStack.Screen name="LibraryHome" component={LibraryHub} options={subpageOptions} />
      <WatchListStack.Screen name="DebridSettings" component={DebridSettings} options={subpageOptions} />
      <WatchListStack.Screen name="CloudFiles" component={CloudFiles} options={subpageOptions} />
      <WatchListStack.Screen name="TordroidPlus" component={TordroidPlus} options={subpageOptions} />
      <WatchListStack.Screen name="LiveTV" component={LiveTV} options={subpageOptions} />
      <WatchListStack.Screen name="LiveGuide" component={LiveGuide} options={subpageOptions} />
      <WatchListStack.Screen name="WatchList" component={Library} />
      <WatchListStack.Screen name="LocalLibrary" component={LocalLibrary} options={subpageOptions} />
      <WatchListStack.Screen name="SourceLibrary" component={SourceLibrary} options={subpageOptions} />
      <WatchListStack.Screen name="Sources" component={Sources} options={subpageOptions} />
      <WatchListStack.Screen name="LocalContent" component={LocalContent} />
      <WatchListStack.Screen name="Info" component={Info} />
    </WatchListStack.Navigator>
  );
}

function TorrentsStackScreen() {
  const subpageOptions = useTopInsetOptions();
  const screenOptions = useMemo(
    () => ({...stackScreenOptions, ...subpageOptions}),
    [subpageOptions],
  );

  return (
    <TorrentsStack.Navigator screenListeners={navigationWorkListeners} screenOptions={screenOptions}>
      <TorrentsStack.Screen name="Torrents" component={Torrents} />
      <TorrentsStack.Screen name="TorrentDetails" component={TorrentDetails} />
      <TorrentsStack.Screen name="TorrentOptions" component={TorrentOptions} />
      <TorrentsStack.Screen name="TorrentSearch" component={TorrentSearch} />
      <TorrentsStack.Screen name="TorrentSources" component={TorrentSources} />
      <TorrentsStack.Screen name="DebridSettings" component={DebridSettings} />
      <TorrentsStack.Screen name="StreamFinder" component={StreamFinder} />
      <TorrentsStack.Screen name="StremioAddons" component={StremioAddons} />
    </TorrentsStack.Navigator>
  );
}

function DownloadsStackScreen() {
  return (
    <DownloadsStack.Navigator
      screenListeners={navigationWorkListeners}
      screenOptions={stackScreenOptions}>
      <DownloadsStack.Screen name="Downloads" component={Downloads} />
      <DownloadsStack.Screen
        name="DownloadedDetails"
        component={DownloadedDetails}
      />
      <DownloadsStack.Screen name="Info" component={Info} />
    </DownloadsStack.Navigator>
  );
}

function SettingsStackScreen() {
  const subpageOptions = useTopInsetOptions();

  return (
    <SettingsStack.Navigator
      screenListeners={navigationWorkListeners}
      screenOptions={stackScreenOptions}>
      <SettingsStack.Screen name="Settings" component={Settings} />
      <SettingsStack.Screen
        name="Appearance"
        component={Appearance}
        options={subpageOptions}
      />
      {/* <SettingsStack.Screen
        name="DisableProviders"
        component={DisableProviders}
      /> */}
      <SettingsStack.Screen
        name="About"
        component={About}
        options={subpageOptions}
      />
      <SettingsStack.Screen name="PlayerSettings" component={PlayerSettings} options={subpageOptions} />
      <SettingsStack.Screen name="PlayerControlSettings" component={PlayerControlSettings} options={subpageOptions} />
      <SettingsStack.Screen name="DataManagement" component={DataManagement} options={subpageOptions} />
      <SettingsStack.Screen
        name="Preferences"
        component={Preferences}
        options={subpageOptions}
      />
      <SettingsStack.Screen
        name="Extensions"
        component={Extensions}
        options={subpageOptions}
      />
      <SettingsStack.Screen
        name="DownloadsStack"
        component={DownloadsStackScreen}
      />
      <SettingsStack.Screen
        name="SubTitlesPreferences"
        component={SubtitlePreference}
        options={subpageOptions}
      />
      <SettingsStack.Screen name="LocalLibrary" component={LocalLibrary} options={subpageOptions} />
      <SettingsStack.Screen name="Credits" component={Credits} options={subpageOptions} />
      <SettingsStack.Screen name="OpenSourceLicenses" component={OpenSourceLicenses} options={subpageOptions} />
      <SettingsStack.Screen name="AdvancedDownloads" component={AdvancedDownloads} options={subpageOptions} />
      <SettingsStack.Screen name="WatchSync" component={WatchSync} options={subpageOptions} />
      <SettingsStack.Screen name="Languages" component={LanguageSettings} options={subpageOptions} />
      <SettingsStack.Screen name="Profiles" component={Profiles} options={subpageOptions} />
      <SettingsStack.Screen name="ProfileEdit" component={ProfileEdit} options={subpageOptions} />
      {/* These two place themselves below the status bar. */}
      <SettingsStack.Screen name="YtdlSettings" component={YtdlSettings} />
      <SettingsStack.Screen name="YtdlCookies" component={YtdlCookies} />
      <SettingsStack.Screen name="Ed2k" component={Ed2k} options={subpageOptions} />
    </SettingsStack.Navigator>
  );
}

function TabStack() {
  // Native tab retention can leave inactive Screen roots above Home on Android.
  // Use the navigator's native detach policy until retention is touch-safe.
  const {width: windowWidth, height: windowHeight} = useWindowDimensions();
  const isLargeScreen = isTV || Math.min(windowWidth, windowHeight) >= 600;
  const screenOptions = useMemo(
    () => ({
      animation: isTV ? ('shift' as const) : ('fade' as const),
      popToTopOnBlur: false,
      tabBarPosition: isLargeScreen ? ('left' as const) : ('bottom' as const),
      headerShown: false,
      freezeOnBlur: true,
      tabBarHideOnKeyboard: true,
    }),
    [isLargeScreen],
  );
  // A kids profile has no Torrents or Settings tab. Switching profile stays on Home.
  const kids = useProfilesStore(state => state.kids);
  const tabs = (
    <Tab.Navigator
      screenListeners={navigationWorkListeners}
      detachInactiveScreens
      tabBar={renderTabBar}
      screenOptions={screenOptions}>
      <Tab.Screen
        name="HomeStack"
        component={HomeStackScreen}
        options={homeTabOptions}
      />
      <Tab.Screen
        name="SearchStack"
        component={SearchStackScreen}
        options={searchTabOptions}
      />
      {kids ? null : (
        <Tab.Screen
          name="TorrentsStack"
          component={TorrentsStackScreen}
          options={{title: 'Torrents', tabBarIcon: makeTabIcon('magnet', 'magnet-on')}}
        />
      )}
      <Tab.Screen
        name="WatchListStack"
        component={WatchListStackScreen}
        options={watchListTabOptions}
      />
      {kids ? null : (
        <Tab.Screen
          name="SettingsStack"
          component={SettingsStackScreen}
          options={settingsTabOptions}
        />
      )}
    </Tab.Navigator>
  );
  return tabs;
}

const App = () => {
  useEffect(()=>{
    void Linking.getInitialURL().then(url=>{if(url)vegaCastService.handleInvitation(url);});
    const subscription=Linking.addEventListener('url',event=>{vegaCastService.handleInvitation(event.url);});
    return()=>subscription.remove();
  },[]);
  useEffect(() => {
    syncParallelStreaming();
  }, []);

  // yt-dlp downloads that wait for a start time or for Wi-Fi.
  useEffect(() => {
    startYtdlScheduler();
  }, []);

  // Magnets and links opened from other apps, and copied magnets.
  useEffect(
    () =>
      startLinkIntake((screen, params) => {
        if (!navigationRef.isReady()) return;
        (navigationRef.navigate as (name: string, params?: object) => void)(screen, params);
      }),
    [],
  );

  // Safety fallback to ensure splash is hidden
  useEffect(() => {
    const timer = setTimeout(() => {
      BootSplash.hide({fade: true}).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    migrateWatchProgressFromCacheStorage().catch(error =>
      console.warn('Watch progress migration failed:', error),
    );
  }, []);

  // Reconcile downloads once the store hydrates, then start shared folder sync.
  useEffect(() => {
    let reconciled = false;
    const reconcile = () => {
      if (reconciled) {
        return;
      }
      reconciled = true;
      reconcileDownloadState()
        .then(() => initializeSyncService())
        .catch(error => console.error('Download startup failed:', error));
    };

    if (useDownloadsStore.persist.hasHydrated()) {
      reconcile();
      return;
    }
    return useDownloadsStore.persist.onFinishHydration(reconcile);
  }, []);

  useEffect(() => startTransferRules(), []);

  // One AppState listener and one timer. They were registered twice, so every
  // foreground, background and 30 s tick ran the sync twice.
  useEffect(() => {
    // Keeps watch-sync sign-ins renewed at start and on every return to the
    // app. ensureFreshAll itself runs at most once every 6 h.
    const renewWatchSync = () => {
      // Then sends Trakt scrobbles queued while offline.
      ensureFreshAll()
        .catch(() => undefined)
        .then(() => flushScrobbleQueue())
        .catch(() => undefined);
    };
    // Android can recreate the activity (for example after a launcher icon
    // change) and report "active" before this listener exists. A stale
    // 'app-background' hold would then block idle work, and settings pages
    // would stay half rendered, until the process restarts.
    if (AppState.currentState === 'active') {
      endUIInteraction('app-background');
      renewWatchSync();
    }
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        endUIInteraction('app-background');
        reconcileCompletedDownloadOutputs().catch(error =>
          console.warn('Download foreground reconciliation failed:', error),
        );
        renewWatchSync();
        if (settingsStorage.isSyncEnabled()) {
          syncFromSharedFolder().catch(error =>
            console.warn('[VegaSync] Foreground sync failed:', error),
          );
        }
      } else {
        beginUIInteraction('app-background');
        flushInteractionCommits();
        if (settingsStorage.isSyncEnabled()) {
          publishSyncManifest().catch(error =>
            console.warn('[VegaSync] Background publish failed:', error),
          );
        }
      }
    });
    const interval = setInterval(() => {
      if (AppState.currentState === 'active' && settingsStorage.isSyncEnabled()) {
        scheduleWhenIdle(() => syncFromSharedFolder());
      }
    }, 30000);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = notifee.onForegroundEvent(({type, detail}) => {
      notificationService.actionHandler({type, detail});
    });
    notifee
      .getInitialNotification()
      .then(initialNotification => {
        if (!initialNotification) {
          return;
        }
        const pressActionId = initialNotification.pressAction?.id;
        return notificationService.actionHandler({
          type:
            pressActionId && pressActionId !== 'default'
              ? EventType.ACTION_PRESS
              : EventType.PRESS,
          detail: initialNotification,
        });
      })
      .catch(error =>
        console.warn('Failed to handle initial notification:', error),
      );
    return () => {
      unsubscribe();
    };
  }, []);

  // Initialize update service
  useEffect(() => {
    // Start automatic update checking at app startup
    updateProvidersService.startAutomaticUpdateCheck();

    // Cleanup on unmount
    return () => {
      updateProvidersService.stopAutomaticUpdateCheck();
    };
  }, []);

  // Initialize DNS over HTTPS and Smart unblock (ByeDPI and Cloudflare WARP)
  useEffect(() => {
    syncDohSettings().catch(e =>
      console.warn('[DoH] Failed to sync settings:', e),
    );
    syncUnblock().catch(e =>
      console.warn('[Unblock] Failed to sync settings:', e),
    );
    return startUnblockEvents();
  }, []);

  useEffect(() => {
    const isPlayStore = Constants.expoConfig?.extra?.isPlayStore;
    if (!isPlayStore && settingsStorage.isAutoCheckUpdateEnabled()) {
      checkForUpdate(() => {}, settingsStorage.isAutoDownloadEnabled(), false);
    }
  }, []);

  useEffect(() => subscribeSourceIntent(openAddSourceScreen), []);
  useEffect(() => subscribeVideoIntent(openVideoIntent), []);
  useEffect(() => {
    if (supportsVideoIntents)
      setVideoIntentsEnabled(settingsStorage.isOpenVideosFromOtherAppsEnabled())
        .catch(error => console.warn('Failed to update video Open with support:', error));
  }, []);

  const handleNavigationReady = useCallback(async () => {
    if (pendingDownloadsNavigation) {
      openDownloadsScreen();
    }
    // Hide bootsplash
    await BootSplash.hide({fade: true});
    const initialSource = pendingAddSource ?? (await getInitialSourceIntent());
    if (initialSource) {
      openAddSourceScreen(initialSource);
    }
    try {
      const initialVideo = pendingVideo ?? (await getInitialVideoIntent());
      if (initialVideo) openVideoIntent(initialVideo);
    } catch (error) {
      console.warn('Failed to open incoming video:', error);
    }
  }, []);

  const themeMode = useThemeStore(state => state.mode);
  const themedNavigation = useMemo(() => {
    const background = THEME_ROLES[themeMode].background;
    return {
      ...navigationTheme,
      colors: {...navigationTheme.colors, card: background, border: background},
    };
  }, [themeMode]);

  return (
    <SafeAreaProvider>
      <SystemBars style="light" />
      <M3ThemeProvider>
        <AppDialogHost />
        <GlobalErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{flex: 1, backgroundColor: THEME_ROLES[themeMode].background}}>
              <UndoSnackbar />
              <NavigationContainer
                ref={navigationRef}
                onReady={handleNavigationReady}
                theme={themedNavigation}>
                <Stack.Navigator
                  screenListeners={navigationWorkListeners}
                  screenOptions={rootStackScreenOptions}>
                  <Stack.Screen name="TabStack" component={TabStack} />
                  <Stack.Screen
                    name="Player"
                    component={Player}
                    options={playerScreenOptions}
                  />
                  <Stack.Screen
                    name="YtdlDownload"
                    component={YtdlDownload}
                    options={{animation: 'slide_from_bottom'}}
                  />
                  <Stack.Screen name="Browser" component={Browser} />
                  <Stack.Screen name="BrowserSettings" component={BrowserSettings} />
                  <Stack.Screen name="BrowserPasswords" component={BrowserPasswords} />
                  <Stack.Screen
                    name="SocialDownload"
                    component={SocialDownload}
                    options={{animation: 'slide_from_bottom'}}
                  />
                </Stack.Navigator>
              </NavigationContainer>
              {/* Global WAF / captcha solving dialog, triggered by providers via
                providerContext.openWebView */}
              <VerificationConsentDialog />
              <WafWebViewDialog />
              <RemoteVolumeToast />
              <FirstRunTips />
              <TorrentVpnTip onOpenSetting={openTorrentVpnSetting} />
              <ProfileGate onManage={openProfilesScreen} />
              {/* Isolated realm that runs untrusted provider code. Must stay
                mounted for the app lifetime: every provider call is dispatched
                into it. */}
              <ProviderSandboxHost />
            </GestureHandlerRootView>
          </QueryClientProvider>
        </GlobalErrorBoundary>
      </M3ThemeProvider>
    </SafeAreaProvider>
  );
};

export default App;
