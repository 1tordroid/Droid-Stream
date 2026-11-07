import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useFocusEffect, useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BackHandler, Linking, Pressable, ToastAndroid, View} from 'react-native';
import {TVFocusable} from '../../components/tv';
import IconButton from '../../components/ui/IconButton';
import ScreenSafeArea from '../../components/ui/ScreenSafeArea';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import {copyText} from '../../lib/clipboard';
import {TYPE} from '../../lib/browser/filters/parse';
import {ensureFilters, hidingSelectorsFor} from '../../lib/browser/filters/lists';
import {
  downloadFile,
  downloadStream,
  handlePageDownload,
  openExternally,
  openInYtdl,
  openTorrent,
  shareLink,
  type PageContext,
} from '../../lib/browser/handoff';
import {buildBootstrap, buildUserscriptInjection, callPage} from '../../lib/browser/inject';
import {classifyMedia, isYtdlSite, mergeMedia, qualityOf, type MediaItem} from '../../lib/browser/media';
import {browserEngine, type BrowserTabHandle, type TabCallbacks, type TabState} from '../../lib/browser/engine';
import {addNeverSite, decideSave, isNeverSite, loginOrigin, loginsForUrl, markLoginUsed, readLogins, saveLogin, type SavedLogin} from '../../lib/browser/passwords';
import {clearPrivateData, rememberPrivateHost} from '../../lib/browser/privacy';
import {
  addHistory,
  isBookmarked,
  layoutFor,
  onSettingsChange,
  readSavedTabs,
  readSettings,
  rememberLayout,
  saveTabs,
  setHistoryTitle,
  shouldAskLayout,
  toggleBookmark,
  updateSettings,
  type Layout,
} from '../../lib/browser/store';
import {displayUrl, hostOf, isWebUrl, resolveInput, searchQueryOf} from '../../lib/browser/url';
import {gmRequest} from '../../lib/browser/userscripts/gm';
import {isUserscriptUrl, scriptRunsOn} from '../../lib/browser/userscripts/meta';
import {deleteValue, installUserscriptFromUrl, readUserscripts, readValues, writeValue} from '../../lib/browser/userscripts/store';
import {useIsKidsProfile} from '../../lib/profiles/useProfiles';
import {isTV} from '../../lib/tv';
import {ytdlSupported} from '../../lib/ytdl/native';
import {isPageLink} from '../../lib/ytdl/formats';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {LayoutSheet, LinksSheet, LoginsSheet, TabsSheet} from './BrowserSheets';
import MediaSheet from './MediaSheet';
import NewTabPage from './NewTabPage';
import {Sheet, SheetRow} from './Sheet';

type Params = {Browser: {url?: string; private?: boolean} | undefined};
type SheetKind = null | 'menu' | 'tabs' | 'media' | 'bookmarks' | 'history' | 'logins' | 'context';

/** Inactive tabs whose pages stay loaded; older ones reload when opened again. */
const KEEP_LOADED = 3;

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const randomToken = () => Array.from({length: 4}, () => Math.random().toString(36).slice(2)).join('');
const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.SHORT);

const makeTab = (url: string, isPrivate: boolean, desktop: boolean): TabState => ({
  id: newId(),
  startUrl: url,
  url,
  title: '',
  private: isPrivate,
  desktop,
  loading: Boolean(url),
  progress: 0,
  canGoBack: false,
  canGoForward: false,
  blocked: 0,
});

const initialState = (params: Params['Browser']): {tabs: TabState[]; active: string} => {
  const settings = readSettings();
  const saved = readSavedTabs();
  const tabs: TabState[] = saved.tabs.map(tab => ({...makeTab(tab.url, false, tab.desktop), id: tab.id, title: tab.title}));
  let active = saved.active && tabs.some(tab => tab.id === saved.active) ? saved.active : tabs[tabs.length - 1]?.id;
  if (params?.url || params?.private || !tabs.length) {
    const url = params?.url ? resolveInput(params.url, settings.searchEngine) : '';
    const tab = makeTab(url, Boolean(params?.private), layoutFor(url || 'about:blank', settings) === 'desktop');
    tabs.push(tab);
    active = tab.id;
  }
  return {tabs, active: active || tabs[0].id};
};

/** Turns an intent:// link into something this phone can open: its web fallback or the app's own scheme. */
const fromIntentUrl = (url: string): {fallback?: string; app?: string} => {
  const fallback = /[;#]S\.browser_fallback_url=([^;]+)/.exec(url)?.[1];
  const scheme = /;scheme=([^;]+)/.exec(url)?.[1];
  const body = url.replace(/^intent:\/\//i, '').split('#Intent')[0];
  return {
    fallback: fallback ? decodeURIComponent(fallback) : undefined,
    app: scheme && !/^(https?|javascript|file|content)$/i.test(scheme) ? `${scheme}://${body}` : undefined,
  };
};

const Browser = () => {
  const colors = useM3Colors();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<Params, 'Browser'>>();
  const kids = useIsKidsProfile();
  const [settings, setSettings] = useState(readSettings);
  const [initial] = useState(() => initialState(route.params));
  const [tabs, setTabs] = useState<TabState[]>(initial.tabs);
  const [activeId, setActiveId] = useState(initial.active);
  const [loadedIds, setLoadedIds] = useState<string[]>([initial.active]);
  const [media, setMedia] = useState<Record<string, MediaItem[]>>({});
  const [focusMedia, setFocusMedia] = useState<MediaItem | null>(null);
  const [loginForms, setLoginForms] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState('');
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [contextTarget, setContextTarget] = useState<{href: string; src: string; text: string} | null>(null);
  const [find, setFind] = useState({open: false, text: '', count: 0, index: 0});
  const [layoutRequest, setLayoutRequest] = useState<{url: string; layout: Layout; private: boolean} | null>(null);
  // Re-renders after a password or bookmark change.
  const [, setRevision] = useState(0);
  const token = useMemo(randomToken, []);
  const engine = useMemo(browserEngine, []);
  const TabView = engine.TabView;
  const webViews = useRef(new Map<string, BrowserTabHandle>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const active = tabs.find(tab => tab.id === activeId) || tabs[0];
  const activeMedia = useMemo(() => media[active?.id] || [], [media, active?.id]);
  const routeNames = (navigation.getState()?.routeNames || []) as readonly string[];
  const navigate = useCallback((screen: string, params?: object) => (navigation.navigate as (name: string, value?: object) => void)(screen, params), [navigation]);

  useEffect(() => onSettingsChange(setSettings), []);

  // A link opened while the browser is already open gets its own tab.
  const routeUrl = route.params?.url;
  const firstRouteUrl = useRef(routeUrl);
  useEffect(() => {
    if (!routeUrl || routeUrl === firstRouteUrl.current) return;
    firstRouteUrl.current = routeUrl;
    const url = resolveInput(routeUrl, settingsRef.current.searchEngine);
    const tab = makeTab(url, Boolean(route.params?.private), layoutFor(url, settingsRef.current) === 'desktop');
    setTabs(list => [...list, tab]);
    setActiveId(tab.id);
    setLoadedIds(list => [tab.id, ...list].slice(0, KEEP_LOADED + 1));
  }, [routeUrl, route.params?.private]);

  useEffect(() => {
    if (kids) navigation.goBack();
  }, [kids, navigation]);

  useEffect(() => {
    // Leftovers of private tabs from a run that ended before they closed.
    clearPrivateData().catch(() => undefined);
    ensureFilters().catch(() => undefined);
  }, []);

  useEffect(() => engine.blocking.configure(settings.blockAds, settings.allowedSites), [engine, settings.blockAds, settings.allowedSites]);

  // Open tabs come back after a restart; private ones never do.
  useEffect(() => {
    const timer = setTimeout(() => {
      saveTabs(
        tabs.filter(tab => !tab.private).map(tab => ({id: tab.id, url: tab.url || tab.startUrl, title: tab.title, desktop: tab.desktop})),
        tabs.find(tab => tab.id === activeId && !tab.private)?.id,
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [tabs, activeId]);

  // Leaving the browser closes private tabs.
  useEffect(
    () => () => {
      if (tabsRef.current.some(tab => tab.private)) clearPrivateData().catch(() => undefined);
    },
    [],
  );

  const updateTab = useCallback((id: string, patch: Partial<TabState> | ((tab: TabState) => Partial<TabState>)) => {
    setTabs(list => list.map(tab => (tab.id === id ? {...tab, ...(typeof patch === 'function' ? patch(tab) : patch)} : tab)));
  }, []);

  const inject = useCallback((id: string, code: string) => webViews.current.get(id)?.injectScript(code), []);

  const pageContext = useCallback((tab: TabState | undefined): PageContext => ({
    pageUrl: tab?.url || '',
    userAgent: tab?.desktop ? engine.userAgents.desktop : engine.userAgents.mobile,
    isPrivate: Boolean(tab?.private),
  }), [engine]);

  const selectTab = useCallback((id: string) => {
    setActiveId(id);
    setLoadedIds(list => [id, ...list.filter(item => item !== id)].slice(0, KEEP_LOADED + 1));
    setEditing(false);
    setFind({open: false, text: '', count: 0, index: 0});
  }, []);

  const addTab = useCallback((url: string, isPrivate: boolean, layout?: Layout) => {
    const tab = makeTab(url, isPrivate, (layout || layoutFor(url || 'about:blank', settingsRef.current)) === 'desktop');
    setTabs(list => [...list, tab]);
    selectTab(tab.id);
    if (!url) {
      setAddress('');
      setEditing(true);
    }
    return tab;
  }, [selectTab]);

  /** A page asked for a new tab: ask Desktop or Mobile first when that is on. */
  const openInNewTab = useCallback((url: string, isPrivate: boolean) => {
    if (shouldAskLayout(url, settingsRef.current)) setLayoutRequest({url, layout: layoutFor(url, settingsRef.current), private: isPrivate});
    else addTab(url, isPrivate);
  }, [addTab]);

  const closeTab = useCallback((id: string) => {
    const list = tabsRef.current;
    const closing = list.find(tab => tab.id === id);
    const rest = list.filter(tab => tab.id !== id);
    if (closing?.private && !rest.some(tab => tab.private)) clearPrivateData().catch(() => undefined);
    setMedia(value => {
      const next = {...value};
      delete next[id];
      return next;
    });
    if (!rest.length) {
      const fresh = makeTab('', false, settingsRef.current.defaultLayout === 'desktop');
      setTabs([fresh]);
      selectTab(fresh.id);
      return;
    }
    setTabs(rest);
    if (id === activeId) selectTab(rest[rest.length - 1].id);
  }, [activeId, selectTab]);

  /** Loads an address in the open tab. A typed address uses the site's remembered layout or the default. */
  const go = useCallback((input: string, typed = true) => {
    const tab = tabsRef.current.find(item => item.id === activeId);
    if (!tab) return;
    const url = resolveInput(input, settingsRef.current.searchEngine);
    setEditing(false);
    if (/^magnet:/i.test(url)) {
      openTorrent(url, navigate);
      return;
    }
    const desktop = typed ? layoutFor(url, settingsRef.current) === 'desktop' : tab.desktop;
    if (!tab.startUrl || desktop !== tab.desktop || !webViews.current.get(tab.id)) {
      // A new WebView: first page of the tab, or a different user agent.
      updateTab(tab.id, {startUrl: url, url, desktop, loading: true, progress: 0, title: ''});
      setLoadedIds(list => [tab.id, ...list.filter(item => item !== tab.id)]);
      return;
    }
    updateTab(tab.id, {url, loading: true});
    webViews.current.get(tab.id)?.load(url);
  }, [activeId, navigate, updateTab]);

  /** Desktop site on or off for this tab, remembered for the site. */
  const setDesktop = useCallback((desktop: boolean) => {
    const tab = tabsRef.current.find(item => item.id === activeId);
    if (!tab) return;
    if (tab.url) rememberLayout(tab.url, desktop ? 'desktop' : 'mobile');
    updateTab(tab.id, {desktop, startUrl: tab.url || tab.startUrl, loading: Boolean(tab.url || tab.startUrl)});
  }, [activeId, updateTab]);

  const offerSave = useCallback((tab: TabState, message: {url?: string; username?: string; password?: string}) => {
    const current = settingsRef.current;
    if (tab.private || !current.useAppPasswords || !message.password) return;
    // The address the WebView reports, not what the page says about itself.
    if (loginOrigin(message.url || '') !== loginOrigin(tab.url)) return;
    const url = tab.url;
    if (isNeverSite(url)) return;
    const username = String(message.username || '');
    const password = String(message.password);
    const decision = decideSave(readLogins(), url, username, password);
    if (decision === 'same') return;
    const site = hostOf(url).replace(/^www\./, '');
    showAppDialog({
      title: decision === 'update' ? `Update password for ${site}?` : `Save password for ${site}?`,
      message: username || 'No user name was found on the page.',
      actions: [
        {label: 'Not now'},
        {label: 'Never for this site', onPress: () => addNeverSite(url)},
        {
          label: decision === 'update' ? 'Update' : 'Save',
          variant: 'primary',
          onPress: () => {
            saveLogin(url, username, password);
            setRevision(value => value + 1);
          },
        },
      ],
    });
  }, []);

  const fillLogin = useCallback((tab: TabState, login: SavedLogin, automatic: boolean) => {
    inject(tab.id, callPage('__dsFill', token, loginOrigin(tab.url), login.username, login.password, automatic));
    if (!automatic) markLoginUsed(login.id);
  }, [inject, token]);

  const handleGm = useCallback(async (tab: TabState, message: any) => {
    const script = readUserscripts().find(item => item.id === message.script && item.enabled);
    if (!script) return;
    const grants = script.meta.grant;
    switch (message.op) {
      case 'set':
        writeValue(script.id, String(message.key), message.value);
        return;
      case 'delete':
        deleteValue(script.id, String(message.key));
        return;
      case 'open':
        if (/^https?:\/\//i.test(message.url)) addTab(message.url, tab.private);
        return;
      case 'clipboard':
        copyText(String(message.text || ''));
        return;
      case 'notify':
        toast([message.title, message.text].filter(Boolean).join(': ') || script.meta.name);
        return;
      case 'xhr': {
        const done = (result: object) => inject(tab.id, callPage('__dsGmDone', token, message.call, result));
        if (!grants.includes('GM_xmlhttpRequest') && !grants.includes('GM.xmlHttpRequest')) {
          done({error: 'GM_xmlhttpRequest is not granted to this script'});
          return;
        }
        const target = hostOf(String(message.request?.url || ''));
        const connect = script.meta.connect;
        const allowed = !connect.length || connect.some(entry => entry === '*' || (entry === 'self' && target === hostOf(tab.url)) || target === entry || target.endsWith(`.${entry}`));
        if (!allowed) {
          done({error: `@connect does not allow ${target}`});
          return;
        }
        try {
          done({response: await gmRequest(message.request)});
        } catch (error) {
          done({error: error instanceof Error ? error.message : String(error)});
        }
        return;
      }
      default:
    }
  }, [addTab, inject, token]);

  const addMedia = useCallback((tabId: string, item: MediaItem) => {
    setMedia(value => ({...value, [tabId]: mergeMedia(value[tabId] || [], item)}));
  }, []);

  const callbacks = useMemo<TabCallbacks>(() => ({
    register: (id, handle) => {
      if (handle) webViews.current.set(id, handle);
      else webViews.current.delete(id);
    },
    onMessage: (id, data) => {
      let message: any;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      if (!message?.__dsb) return;
      const tab = tabsRef.current.find(item => item.id === id);
      if (!tab) return;
      const current = settingsRef.current;
      switch (message.type) {
        case 'page': {
          const url = String(message.url || '');
          if (!/^https?:/i.test(url)) return;
          setMedia(value => ({...value, [id]: (value[id] || []).filter(item => item.pageUrl === url)}));
          setLoginForms(value => ({...value, [id]: false}));
          const selectors = hidingSelectorsFor(url);
          if (selectors.length) inject(id, callPage('__dsHide', selectors));
          if (current.userscripts) {
            for (const script of readUserscripts()) {
              if (!script.enabled || !scriptRunsOn(script.meta, url)) continue;
              inject(id, buildUserscriptInjection(token, {id: script.id, code: script.code, runAt: script.meta.runAt, name: script.meta.name, version: script.meta.version, namespace: script.meta.namespace, description: script.meta.description}, readValues(script.id)));
            }
          }
          if (current.useAppPasswords && !tab.private) {
            const logins = loginsForUrl(readLogins(), url);
            if (logins.length === 1) inject(id, callPage('__dsFill', token, loginOrigin(url), logins[0].username, logins[0].password, true));
          }
          return;
        }
        case 'media': {
          for (const found of Array.isArray(message.items) ? message.items.slice(0, 100) : []) {
            const pageUrl = String(message.pageUrl || tab.url);
            if (found.blob) {
              addMedia(id, {url: `blob:${pageUrl}`, kind: 'video', blob: true, pageUrl, title: message.title, poster: found.poster || undefined, width: found.width, height: found.height, source: 'page', foundAt: Date.now()});
              continue;
            }
            const url = String(found.url || '');
            let kind = classifyMedia(url, found.mime);
            if (!kind && (found.tag === 'video' || found.tag === 'source')) kind = 'video';
            if (!kind && found.tag === 'audio') kind = 'audio';
            if (!kind || (kind === 'image' && found.tag !== 'img')) continue;
            addMedia(id, {url, kind, pageUrl, title: found.text || message.title, poster: found.poster || undefined, width: found.width || undefined, height: found.height || undefined, quality: kind === 'image' ? undefined : qualityOf(url, found.height), source: 'page', foundAt: Date.now()});
          }
          return;
        }
        case 'videoButton': {
          const item: MediaItem = message.blob || !message.url
            ? {url: `blob:${message.pageUrl}`, kind: 'video', blob: true, pageUrl: message.pageUrl, title: message.title, poster: message.poster, source: 'page', foundAt: Date.now()}
            : {url: message.url, kind: classifyMedia(message.url) || 'video', pageUrl: message.pageUrl, title: message.title, poster: message.poster, quality: qualityOf(message.url, message.height), width: message.width, height: message.height, source: 'page', foundAt: Date.now()};
          // A video on a site yt-dlp reads well goes there directly.
          if ((item.blob || isYtdlSite(item.pageUrl)) && ytdlSupported()) {
            openInYtdl(item.pageUrl, pageContext(tab), navigate).catch(error => toast(error.message));
            return;
          }
          addMedia(id, item);
          setFocusMedia(item);
          setSheet('media');
          return;
        }
        case 'context':
          setContextTarget({href: String(message.href || ''), src: String(message.src || ''), text: String(message.text || '')});
          setSheet('context');
          return;
        case 'find':
          setFind(value => ({...value, count: Number(message.count) || 0, index: Number(message.index) || 0}));
          return;
        case 'loginForm':
          setLoginForms(value => ({...value, [id]: Boolean(message.present)}));
          return;
        case 'login':
          if (message.__ds === token) offerSave(tab, message);
          return;
        case 'gm':
          if (message.__ds === token) handleGm(tab, message).catch(() => undefined);
          return;
        default:
      }
    },
    onNavigation: (id, state) => {
      const tab = tabsRef.current.find(item => item.id === id);
      if (tab?.private) rememberPrivateHost(hostOf(state.url));
      updateTab(id, {url: state.url, title: state.title || hostOf(state.url), loading: state.loading, canGoBack: state.canGoBack, canGoForward: state.canGoForward});
    },
    onProgress: (id, progress) => updateTab(id, {progress}),
    onLoadEnd: (id, url, title) => {
      const tab = tabsRef.current.find(item => item.id === id);
      updateTab(id, {loading: false, progress: 1});
      if (tab && !tab.private) {
        addHistory(url, title);
        if (title) setHistoryTitle(url, title);
      }
    },
    onOpenWindow: (id, url) => {
      const tab = tabsRef.current.find(item => item.id === id);
      if (!tab || !url) return;
      if (!isWebUrl(url)) return;
      engine.blocking.check(url, tab.url, TYPE.subdocument).then(blocked => {
        if (blocked) toast('Pop-up blocked');
        else openInNewTab(url, tab.private);
      });
    },
    onShouldStart: (id, url, isTopFrame) => {
      const tab = tabsRef.current.find(item => item.id === id);
      if (isWebUrl(url)) {
        if (isTopFrame && isUserscriptUrl(url) && settingsRef.current.userscripts) {
          showAppDialog({
            title: 'Install this userscript?',
            message: url,
            actions: [
              {label: 'Cancel'},
              {
                label: 'Install',
                variant: 'primary',
                onPress: () =>
                  installUserscriptFromUrl(url)
                    .then(script => toast(`Installed ${script.meta.name}`))
                    .catch(error => toast(error.message)),
              },
            ],
          });
          return false;
        }
        return true;
      }
      if (/^magnet:/i.test(url)) {
        openTorrent(url, navigate);
        return false;
      }
      if (/^(javascript|file|content):/i.test(url)) return false;
      const open = () => {
        if (/^intent:/i.test(url)) {
          const target = fromIntentUrl(url);
          if (target.app) {
            Linking.openURL(target.app).catch(() => {
              if (target.fallback && tab) go(target.fallback, false);
              else toast('No app on this phone opens this link');
            });
          } else if (target.fallback) go(target.fallback, false);
          return;
        }
        openExternally(url);
      };
      if (settingsRef.current.confirmExternalApps) {
        showAppDialog({
          title: 'Open in another app?',
          message: url.slice(0, 200),
          actions: [{label: 'Stay here'}, {label: 'Open', variant: 'primary', onPress: open}],
        });
      } else open();
      return false;
    },
    onCrash: id => {
      const tab = tabsRef.current.find(item => item.id === id);
      if (!tab) return;
      webViews.current.delete(id);
      updateTab(id, {startUrl: tab.url || tab.startUrl});
      setLoadedIds(list => list.filter(item => item !== id));
      setTimeout(() => setLoadedIds(list => [id, ...list]), 50);
      toast('The page stopped working and was reloaded');
    },
  }), [addMedia, engine, go, handleGm, inject, navigate, offerSave, openInNewTab, pageContext, token, updateTab]);

  // Native hook: blocked counts, streams the page loaded, and file downloads.
  useEffect(
    () =>
      engine.onEvent(event => {
        const tab = tabsRef.current.find(item => item.id === event.tab);
        if (!tab) return;
        if (event.type === 'blocked') updateTab(tab.id, {blocked: event.count});
        else if (event.type === 'media') {
          const kind = classifyMedia(event.url, event.accept.startsWith('video/') || event.accept.startsWith('audio/') ? event.accept : '');
          if (kind && kind !== 'image') addMedia(tab.id, {url: event.url, kind, pageUrl: event.pageUrl || tab.url, title: tab.title, quality: qualityOf(event.url), source: 'network', foundAt: Date.now()});
        } else if (event.type === 'download') {
          handlePageDownload(event, pageContext(tab), navigate).catch(error => toast(error.message));
        }
      }),
    [addMedia, engine, navigate, pageContext, updateTab],
  );

  const bootstraps = useRef(new Map<string, string>());
  const bootstrapFor = (tab: TabState): string => {
    const options = {
      token,
      desktop: tab.desktop,
      darkPages: settings.darkPages,
      videoButton: settings.showVideoButton,
      detectLogins: settings.useAppPasswords && !tab.private,
    };
    const key = JSON.stringify(options);
    let code = bootstraps.current.get(key);
    if (!code) {
      code = buildBootstrap(options);
      bootstraps.current.set(key, code);
    }
    return code;
  };

  const goBack = useCallback((): boolean => {
    if (sheet) {
      setSheet(null);
      return true;
    }
    if (find.open) {
      setFind({open: false, text: '', count: 0, index: 0});
      inject(activeId, callPage('__dsFind', ''));
      return true;
    }
    if (editing) {
      setEditing(false);
      return true;
    }
    const tab = tabsRef.current.find(item => item.id === activeId);
    if (tab?.canGoBack && webViews.current.get(tab.id)) {
      webViews.current.get(tab.id)?.goBack();
      return true;
    }
    return false;
  }, [activeId, editing, find.open, inject, sheet]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', goBack);
      return () => subscription.remove();
    }, [goBack]),
  );

  if (kids || !active) return null;

  const logins = active.url && settings.useAppPasswords && !active.private ? loginsForUrl(readLogins(), active.url) : [];
  const context = pageContext(active);
  const secure = /^https:/i.test(active.url);
  const playableCount = activeMedia.filter(item => item.kind !== 'image').length;
  const blockingOff = settings.allowedSites.some(site => hostOf(active.url) === site || hostOf(active.url).endsWith(`.${site}`));

  const startEditing = () => {
    setAddress(active.url ? searchQueryOf(active.url) || active.url : '');
    setEditing(true);
  };

  const toggleSiteBlocking = () => {
    const host = hostOf(active.url).replace(/^www\./, '');
    if (!host) return;
    const allowed = blockingOff ? settings.allowedSites.filter(site => !(hostOf(active.url) === site || hostOf(active.url).endsWith(`.${site}`))) : [...settings.allowedSites, host];
    updateSettings({allowedSites: allowed});
    engine.blocking.configure(settings.blockAds, allowed);
    toast(blockingOff ? `Blocking on for ${host}` : `Blocking off for ${host}`);
    webViews.current.get(active.id)?.reload();
  };

  const runFind = (text: string, backwards = false) => {
    setFind(value => ({...value, text}));
    inject(active.id, callPage('__dsFind', text, backwards));
  };

  const closeSheet = () => {
    setSheet(null);
    setFocusMedia(null);
  };

  const menu = (
    <Sheet visible={sheet === 'menu'} onClose={closeSheet}>
      <View style={{flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 12, paddingBottom: 4}}>
        <IconButton icon="arrow-left" label="Back" disabled={!active.canGoBack} onPress={() => { closeSheet(); webViews.current.get(active.id)?.goBack(); }} />
        <IconButton icon="arrow-right" label="Forward" disabled={!active.canGoForward} onPress={() => { closeSheet(); webViews.current.get(active.id)?.goForward(); }} />
        <IconButton icon="refresh" label="Reload" disabled={!active.url} onPress={() => { closeSheet(); webViews.current.get(active.id)?.reload(); }} />
        <IconButton
          icon={active.url && isBookmarked(active.url) ? 'bookmark' : 'bookmark-outline'}
          label="Bookmark"
          disabled={!active.url}
          onPress={() => {
            const added = toggleBookmark(active.url, active.title);
            toast(added ? 'Bookmarked' : 'Bookmark removed');
            setRevision(value => value + 1);
          }}
        />
        <IconButton icon="share-variant" label="Share" disabled={!active.url} onPress={() => { closeSheet(); shareLink(active.url, active.title); }} />
      </View>
      <SheetRow icon="plus" label="New tab" onPress={() => { closeSheet(); addTab('', false); }} preferredFocus />
      <SheetRow icon="incognito" label="New private tab" onPress={() => { closeSheet(); addTab('', true); }} />
      <SheetRow icon="download-circle-outline" label="Media on this page" detail={playableCount ? `${playableCount} found` : undefined} onPress={() => setSheet('media')} />
      <SheetRow icon="bookmark-multiple-outline" label="Bookmarks" onPress={() => setSheet('bookmarks')} />
      {!active.private ? <SheetRow icon="history" label="History" onPress={() => setSheet('history')} /> : null}
      <SheetRow icon="magnify" label="Find in page" disabled={!active.url} onPress={() => { closeSheet(); setFind({open: true, text: '', count: 0, index: 0}); }} />
      <SheetRow icon="monitor" label="Desktop site" toggle={active.desktop} onPress={() => { closeSheet(); setDesktop(!active.desktop); }} />
      <SheetRow icon="theme-light-dark" label="Dark pages" toggle={settings.darkPages} onPress={() => { updateSettings({darkPages: !settings.darkPages}); webViews.current.get(active.id)?.reload(); }} />
      {settings.blockAds && active.url ? (
        <SheetRow icon="shield-check-outline" label="Block ads on this site" detail={active.blocked ? `${active.blocked} blocked on this page` : undefined} toggle={!blockingOff} onPress={toggleSiteBlocking} />
      ) : null}
      {ytdlSupported() && active.url && isPageLink(active.url) ? (
        <SheetRow icon="youtube" label="Download with yt-dlp" onPress={() => { closeSheet(); openInYtdl(active.url, context, navigate).catch(error => toast(error.message)); }} />
      ) : null}
      {logins.length || loginForms[active.id] ? <SheetRow icon="key-variant" label="Saved passwords" onPress={() => setSheet('logins')} /> : null}
      {active.url ? <SheetRow icon="open-in-new" label="Open in another browser" onPress={() => { closeSheet(); openExternally(active.url); }} /> : null}
      {active.url ? <SheetRow icon="content-copy" label="Copy link" onPress={() => { closeSheet(); copyText(active.url); toast('Link copied'); }} /> : null}
      <SheetRow icon="cog-outline" label="Browser settings" onPress={() => { closeSheet(); navigate('BrowserSettings'); }} />
      <SheetRow icon="close" label="Close browser" onPress={() => { closeSheet(); navigation.goBack(); }} />
    </Sheet>
  );

  const contextSheet = contextTarget ? (
    <Sheet visible={sheet === 'context'} onClose={closeSheet} title={contextTarget.text || contextTarget.href || contextTarget.src}>
      {contextTarget.href ? (
        <>
          <SheetRow icon="tab-plus" label="Open in new tab" onPress={() => { closeSheet(); openInNewTab(contextTarget.href, active.private); }} preferredFocus />
          {!active.private ? <SheetRow icon="incognito" label="Open in private tab" onPress={() => { closeSheet(); addTab(contextTarget.href, true); }} /> : null}
          <SheetRow
            icon="download"
            label="Download link"
            onPress={() => {
              closeSheet();
              const href = contextTarget.href;
              const kind = classifyMedia(href);
              const item: MediaItem = {url: href, kind: kind || 'file', pageUrl: active.url, source: 'page', foundAt: Date.now()};
              if (kind === 'magnet' || kind === 'torrent') openTorrent(href, navigate);
              else if (kind === 'hls' || kind === 'dash') downloadStream(item, context, navigate).catch(error => toast(error.message));
              else if (!kind && isPageLink(href) && ytdlSupported()) openInYtdl(href, context, navigate).catch(error => toast(error.message));
              else downloadFile({url: href}, context).catch(error => toast(error.message));
            }}
          />
          <SheetRow icon="content-copy" label="Copy link" onPress={() => { closeSheet(); copyText(contextTarget.href); toast('Link copied'); }} />
          <SheetRow icon="share-variant" label="Share link" onPress={() => { closeSheet(); shareLink(contextTarget.href); }} />
        </>
      ) : null}
      {contextTarget.src ? (
        <>
          <SheetRow icon="image-move" label="Download image" onPress={() => { closeSheet(); downloadFile({url: contextTarget.src}, context).catch(error => toast(error.message)); }} />
          <SheetRow icon="image-search-outline" label="Open image in new tab" onPress={() => { closeSheet(); addTab(contextTarget.src, active.private, 'mobile'); }} />
        </>
      ) : null}
    </Sheet>
  ) : null;

  return (
    <ScreenSafeArea style={{backgroundColor: colors.background}}>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 4, gap: 2, backgroundColor: colors.surfaceContainer}}>
        <IconButton icon={active.canGoBack ? 'arrow-left' : 'close'} label={active.canGoBack ? 'Back' : 'Close browser'} onPress={() => (goBack() ? undefined : navigation.goBack())} />
        {editing ? (
          <View style={{flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerHighest, borderRadius: 24, paddingLeft: 14, minHeight: 44}}>
            <TextInput
              value={address}
              onChangeText={setAddress}
              onSubmitEditing={() => go(address)}
              autoFocus
              selectTextOnFocus
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={isTV ? 'default' : 'url'}
              returnKeyType="go"
              placeholder="Search or type an address"
              placeholderTextColor={colors.onSurfaceVariant}
              accessibilityLabel="Address"
              style={{flex: 1, color: colors.onSurface, fontSize: 16, paddingVertical: 8}}
            />
            {address ? <IconButton icon="close-circle" label="Clear" size={18} onPress={() => setAddress('')} /> : null}
          </View>
        ) : (
          <TVFocusable
            onPress={startEditing}
            accessibilityLabel={`Address ${displayUrl(active.url) || 'empty'}`}
            borderRadius={24}
            focusScale={1.02}
            style={{flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerHighest, borderRadius: 24, paddingHorizontal: 12, minHeight: 44}}>
            <MaterialCommunityIcons
              name={active.private ? 'incognito' : !active.url ? 'magnify' : secure ? 'lock' : 'alert-circle-outline'}
              size={16}
              color={colors.onSurfaceVariant}
              style={{marginRight: 8}}
            />
            <AppText role="bodyLarge" style={{color: active.url ? colors.onSurface : colors.onSurfaceVariant, flex: 1}} numberOfLines={1}>
              {active.url ? searchQueryOf(active.url) || displayUrl(active.url) : 'Search or type an address'}
            </AppText>
            {settings.blockAds && active.blocked && !blockingOff ? (
              <Pressable onPress={() => setSheet('menu')} focusable={false} accessibilityLabel={`${active.blocked} ads and trackers blocked`} style={{flexDirection: 'row', alignItems: 'center', marginLeft: 6}}>
                <MaterialCommunityIcons name="shield-check" size={16} color={colors.primary} />
                <AppText role="labelMedium" style={{color: colors.primary, marginLeft: 2}}>{active.blocked > 999 ? '999+' : active.blocked}</AppText>
              </Pressable>
            ) : null}
          </TVFocusable>
        )}
        {!editing && logins.length ? <IconButton icon="key-variant" label="Saved passwords" onPress={() => setSheet('logins')} /> : null}
        <TVFocusable onPress={() => setSheet('tabs')} accessibilityLabel={`Tabs, ${tabs.length} open`} borderRadius={12} style={{width: 44, height: 44, alignItems: 'center', justifyContent: 'center'}}>
          <View style={{minWidth: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.onSurface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3}}>
            <AppText role="labelMedium" style={{color: colors.onSurface}}>{tabs.length > 99 ? ':)' : tabs.length}</AppText>
          </View>
        </TVFocusable>
        <IconButton icon="dots-vertical" label="Browser menu" onPress={() => setSheet('menu')} />
      </View>
      <View style={{height: 2, backgroundColor: colors.surfaceContainer}}>
        {active.loading && active.url ? <View style={{height: 2, width: `${Math.max(5, Math.round(active.progress * 100))}%`, backgroundColor: colors.primary}} /> : null}
      </View>
      {find.open ? (
        <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 4, backgroundColor: colors.surfaceContainerHigh}}>
          <TextInput
            value={find.text}
            onChangeText={text => runFind(text)}
            onSubmitEditing={() => runFind(find.text)}
            autoFocus
            placeholder="Find in page"
            placeholderTextColor={colors.onSurfaceVariant}
            accessibilityLabel="Find in page"
            style={{flex: 1, color: colors.onSurface, minHeight: 40}}
          />
          <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginHorizontal: 8}}>
            {find.text ? `${find.index}/${find.count}` : ''}
          </AppText>
          <IconButton icon="chevron-up" label="Previous match" size={20} onPress={() => runFind(find.text, true)} />
          <IconButton icon="chevron-down" label="Next match" size={20} onPress={() => runFind(find.text)} />
          <IconButton icon="close" label="Close find" size={20} onPress={() => { setFind({open: false, text: '', count: 0, index: 0}); inject(active.id, callPage('__dsFind', '')); }} />
        </View>
      ) : null}
      <View style={{flex: 1}}>
        {tabs
          .filter(tab => tab.startUrl && (tab.id === active.id || loadedIds.includes(tab.id)))
          .map(tab => (
            <TabView
              key={`${tab.id}:${tab.desktop ? 'd' : 'm'}`}
              tab={tab}
              visible={tab.id === active.id}
              bootstrap={bootstrapFor(tab)}
              userAgent={tab.desktop ? engine.userAgents.desktop : engine.userAgents.mobile}
              autofill={settings.useDevicePasswords && !tab.private}
              passkeys={settings.passkeys && !tab.private}
              callbacks={callbacks}
            />
          ))}
        {!active.startUrl ? <NewTabPage onOpen={url => go(url, true)} isPrivate={active.private} /> : null}
        {active.startUrl && playableCount > 0 && !sheet ? (
          <View style={{position: 'absolute', right: 16, bottom: 24}}>
            <TVFocusable
              onPress={() => setSheet('media')}
              accessibilityLabel={`Media on this page, ${playableCount} found`}
              borderRadius={28}
              style={{width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primaryContainer, alignItems: 'center', justifyContent: 'center', elevation: 4}}>
              <MaterialCommunityIcons name="download" size={26} color={colors.onPrimaryContainer} />
              <View style={{position: 'absolute', top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4}}>
                <AppText role="labelSmall" style={{color: colors.onPrimary}}>{playableCount > 99 ? '99+' : playableCount}</AppText>
              </View>
            </TVFocusable>
          </View>
        ) : null}
      </View>

      {menu}
      {contextSheet}
      <TabsSheet
        visible={sheet === 'tabs'}
        onClose={closeSheet}
        tabs={tabs}
        activeId={active.id}
        onSelect={id => { closeSheet(); selectTab(id); }}
        onCloseTab={closeTab}
        onNew={isPrivate => { closeSheet(); addTab('', isPrivate); }}
        onCloseAll={() => {
          closeSheet();
          if (tabsRef.current.some(tab => tab.private)) clearPrivateData().catch(() => undefined);
          const fresh = makeTab('', false, settings.defaultLayout === 'desktop');
          setTabs([fresh]);
          setMedia({});
          selectTab(fresh.id);
        }}
      />
      <MediaSheet visible={sheet === 'media'} onClose={closeSheet} items={activeMedia} focus={focusMedia} context={context} navigate={navigate} routeNames={routeNames} />
      <LinksSheet visible={sheet === 'bookmarks' || sheet === 'history'} kind={sheet === 'history' ? 'history' : 'bookmarks'} onClose={closeSheet} onOpen={url => { closeSheet(); go(url, false); }} />
      <LoginsSheet
        visible={sheet === 'logins'}
        onClose={closeSheet}
        logins={logins}
        onFill={login => { closeSheet(); fillLogin(active, login, false); }}
        onManage={() => { closeSheet(); navigate('BrowserPasswords'); }}
      />
      <LayoutSheet
        request={layoutRequest}
        onClose={() => setLayoutRequest(null)}
        onChoose={(layout, remember) => {
          const request = layoutRequest;
          setLayoutRequest(null);
          if (!request) return;
          if (remember) rememberLayout(request.url, layout);
          addTab(request.url, request.private, layout);
        }}
      />
    </ScreenSafeArea>
  );
};

export default Browser;
