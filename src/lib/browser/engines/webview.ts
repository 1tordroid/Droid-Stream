import {clearAllCookies, clearSiteCookies, getCookieHeader} from '../../services/cookieManager';
import type {BrowserEngine} from '../engine';
import {
  browserNativeAvailable,
  clearNativeFilters,
  clearOrigins,
  flushCookies,
  loadNativeFilters,
  onBrowserEvent,
  passkeysSupported,
  setNativeBlocking,
  wouldBlock,
} from '../native';
import {DESKTOP_USER_AGENT, MOBILE_USER_AGENT} from '../url';
import WebViewTab from './WebViewTab';

/** Android System WebView through react-native-webview, with BrowserModule.kt for what the library lacks. */
export const webViewEngine: BrowserEngine = {
  name: 'Android WebView',
  TabView: WebViewTab,
  requestHook: browserNativeAvailable,
  userAgents: {desktop: DESKTOP_USER_AGENT, mobile: MOBILE_USER_AGENT},
  blocking: {
    load: loadNativeFilters,
    clear: clearNativeFilters,
    configure: setNativeBlocking,
    check: wouldBlock,
  },
  cookies: {
    header: getCookieHeader,
    clearSite: clearSiteCookies,
    clearAll: clearAllCookies,
    flush: flushCookies,
  },
  clearSiteData: clearOrigins,
  passkeysSupported,
  onEvent: onBrowserEvent,
};
