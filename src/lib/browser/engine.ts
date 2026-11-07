import type React from 'react';

/**
 * The browser's page engine, kept behind one interface so the rest of the
 * browser (tabs, media detection, ad blocking, userscripts, passwords,
 * layouts) does not depend on it. Droid Stream uses Android's WebView
 * (engines/webview.ts). Another build can add an engine (for example
 * GeckoView with Firefox add-ons) by implementing BrowserEngine and
 * returning it from browserEngine(); nothing else changes.
 *
 * What an engine must provide:
 * - TabView: one tab's page view. It runs `bootstrap` (inject.ts) at the
 *   start of every main-frame page, delivers the page's messages
 *   (window.ReactNativeWebView.postMessage, JSON) to callbacks.onMessage,
 *   reports navigation, pop-ups (onOpenWindow) and the app links pages open
 *   (onShouldStart), and registers a BrowserTabHandle.
 * - A request hook when it can (requestHook: true): blocks with the
 *   compiled rules (filters/parse.ts lines; the WebView engine reads them
 *   in BrowserFilters.kt) and reports media requests and file downloads
 *   through onEvent. Without it, the page script still finds media and
 *   hides ads with CSS.
 * - Cookies and site data, user agents, autofill and passkey switches.
 */

export interface TabState {
  id: string;
  /** What the tab first loads when its view is created. */
  startUrl: string;
  url: string;
  title: string;
  private: boolean;
  desktop: boolean;
  loading: boolean;
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  blocked: number;
}

/** What the browser can do with a tab's page once its view exists. */
export interface BrowserTabHandle {
  load: (url: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  /** Runs code in the page's main frame. Results come back as page messages. */
  injectScript: (code: string) => void;
}

export interface TabCallbacks {
  onMessage: (tabId: string, data: string) => void;
  onNavigation: (tabId: string, state: {url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean}) => void;
  onProgress: (tabId: string, progress: number) => void;
  onLoadEnd: (tabId: string, url: string, title: string) => void;
  /** target=_blank and window.open. */
  onOpenWindow: (tabId: string, url: string) => void;
  /** A main-frame navigation; false keeps the page (the app handles magnet:, intent: and the like). */
  onShouldStart: (tabId: string, url: string, isTopFrame: boolean) => boolean;
  onCrash: (tabId: string) => void;
  register: (tabId: string, handle: BrowserTabHandle | null) => void;
}

export interface BrowserTabViewProps {
  tab: TabState;
  visible: boolean;
  /** The page script (inject.ts buildBootstrap), run at the start of every page. */
  bootstrap: string;
  userAgent: string;
  /** Expose form fields to the phone's password manager. */
  autofill: boolean;
  passkeys: boolean;
  callbacks: TabCallbacks;
}

export type BrowserEngineEvent =
  | {type: 'media'; tab: string; url: string; pageUrl: string; accept: string}
  | {type: 'blocked'; tab: string; pageUrl: string; count: number}
  | {
      type: 'download';
      tab: string;
      url: string;
      pageUrl: string;
      userAgent: string;
      contentDisposition: string;
      mimeType: string;
      contentLength: number;
      fileName: string;
    };

export interface BrowserEngine {
  name: string;
  TabView: React.ComponentType<BrowserTabViewProps>;
  /** Whether requests can be blocked and watched outside the page. */
  requestHook: () => boolean;
  userAgents: {desktop: string; mobile: string};
  blocking: {
    /** Loads compiled rule lines from a file; skips the work when that file is loaded already. */
    load: (path: string) => Promise<number>;
    clear: () => void;
    /** On or off, and the sites where it is off. */
    configure: (enabled: boolean, allowedSites: string[]) => void;
    /** Whether a request would be blocked (used for pop-ups). */
    check: (url: string, pageUrl: string, type: number) => Promise<boolean>;
  };
  cookies: {
    /** The Cookie header the engine would send to this URL. */
    header: (url: string) => Promise<string>;
    clearSite: (url: string) => Promise<void>;
    clearAll: () => Promise<void>;
    /** Writes cookies to disk, so sign-ins survive the app being closed. */
    flush: () => void;
  };
  /** Deletes local storage, IndexedDB and caches of these origins. */
  clearSiteData: (origins: string[]) => Promise<void>;
  passkeysSupported: () => Promise<boolean>;
  onEvent: (listener: (event: BrowserEngineEvent) => void) => () => void;
}

let engine: BrowserEngine | undefined;

/** The engine of this build. Loaded on first use, so screens that never browse do not load it. */
export const browserEngine = (): BrowserEngine => {
  if (!engine) engine = (require('./engines/webview') as typeof import('./engines/webview')).webViewEngine;
  return engine;
};

/** Tests only. */
export const setBrowserEngineForTests = (value: BrowserEngine | undefined): void => {
  engine = value;
};
