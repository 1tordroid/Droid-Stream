/**
 * Address bar input: a web address, a search, or a link the app handles
 * itself (magnet). Pure functions, so they are easy to test.
 */

export type SearchEngineId = 'duckduckgo' | 'google' | 'bing' | 'brave' | 'startpage';

export const SEARCH_ENGINES: {id: SearchEngineId; name: string; url: string}[] = [
  {id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s'},
  {id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s'},
  {id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s'},
  {id: 'brave', name: 'Brave', url: 'https://search.brave.com/search?q=%s'},
  {id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s'},
];

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = 'duckduckgo';

export const searchUrl = (query: string, engine: SearchEngineId = DEFAULT_SEARCH_ENGINE): string => {
  const template = (SEARCH_ENGINES.find(item => item.id === engine) || SEARCH_ENGINES[0]).url;
  return template.replace('%s', encodeURIComponent(query.trim()));
};

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// A host name with a dot and a known-looking ending, an IP address, or localhost.
const HOST_LIKE = /^(localhost|(\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\]|([a-z0-9-]+\.)+[a-z][a-z0-9-]{1,62})(:\d{1,5})?([/?#].*)?$/i;

/** True for text that should be opened as an address rather than searched. */
export const looksLikeUrl = (input: string): boolean => {
  const text = input.trim();
  if (/^(https?:\/\/\S|about:|magnet:|data:|blob:|file:)/i.test(text)) return true;
  if (!text || /\s/.test(text)) return false;
  return HOST_LIKE.test(text);
};

/**
 * What to load for address bar text: the address itself (https:// added when
 * no scheme is given) or a search with the chosen engine.
 */
export const resolveInput = (input: string, engine: SearchEngineId = DEFAULT_SEARCH_ENGINE): string => {
  const text = input.trim();
  if (!text) return 'about:blank';
  if (looksLikeUrl(text)) {
    if (SCHEME.test(text) && !/^localhost:\d/i.test(text)) return text;
    return /^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?([/?#]|$)/i.test(text) ? `http://${text}` : `https://${text}`;
  }
  return searchUrl(text, engine);
};

/** Pages the WebView may open itself. Everything else (intent:, market:, magnet:) is the app's to handle. */
export const isWebUrl = (url: string): boolean => /^(https?:|about:blank|about:srcdoc|data:|blob:)/i.test(url);

export const hostOf = (url: string): string => {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(url.trim());
  return match ? match[1].toLowerCase().replace(/\.$/, '') : '';
};

export const originOf = (url: string): string => {
  const match = /^(https?:\/\/(?:[^@/?#]*@)?[^/?#]+)/i.exec(url.trim());
  return match ? match[1].replace(/\/\/[^@/]*@/, '//').toLowerCase() : '';
};

/** Short form for the address bar while not editing: host and path without the scheme. */
export const displayUrl = (url: string): string => {
  if (!url || url === 'about:blank') return '';
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
};

/** The query, when the URL is a search on one of the engines. */
export const searchQueryOf = (url: string): string | undefined => {
  for (const engine of SEARCH_ENGINES) {
    const prefix = engine.url.split('%s')[0];
    if (url.startsWith(prefix)) {
      const value = url.slice(prefix.length).split('&')[0];
      try {
        return decodeURIComponent(value.replace(/\+/g, ' '));
      } catch {
        return value;
      }
    }
  }
  return undefined;
};

export interface Shortcut {
  id: string;
  title: string;
  url: string;
  icon?: string;
}

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  {id: 'youtube', title: 'YouTube', url: 'https://m.youtube.com/', icon: 'youtube'},
  {id: 'instagram', title: 'Instagram', url: 'https://www.instagram.com/', icon: 'instagram'},
  {id: 'facebook', title: 'Facebook', url: 'https://m.facebook.com/', icon: 'facebook'},
  {id: 'x', title: 'X', url: 'https://x.com/', icon: 'twitter'},
  {id: 'tiktok', title: 'TikTok', url: 'https://www.tiktok.com/', icon: 'music-note'},
  {id: 'reddit', title: 'Reddit', url: 'https://www.reddit.com/', icon: 'reddit'},
  {id: 'pinterest', title: 'Pinterest', url: 'https://www.pinterest.com/', icon: 'pinterest'},
];

/** Desktop Chrome on Windows, used for desktop mode. */
export const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/**
 * Mobile Chrome. The WebView's own agent says "wv", which some sites (and
 * Google sign-in) turn away.
 */
export const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

/**
 * The title (and so the folder) a browser download is grouped under. A real
 * page or video title is kept; an address such as "site.com/a/b.html" becomes
 * the site name, so files from one site land in one tidy folder.
 */
export const downloadTitle = (title: string | undefined, pageUrl: string, fallback: string): string => {
  const clean = title?.trim() || '';
  const looksLikeAddress = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(clean);
  if (clean && !looksLikeAddress) return clean;
  return hostOf(pageUrl).replace(/^www\./, '') || clean || fallback;
};
