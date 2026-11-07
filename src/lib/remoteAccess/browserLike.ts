/**
 * "Use a browser-like connection" for sites the user lists: a Chrome-like
 * TLS setup and Chrome's headers in Chrome's order (done natively in
 * BrowserLikeConnection.kt) and Chrome's headers for yt-dlp. Off for every
 * site until it is added. Debrid hosts are never changed.
 */
import {hostInList, isDebridHost, isLocalHost, normalizeHost} from '../unblock/unblockHosts';

export const CHROME_MAJOR = 142;
export const CHROME_USER_AGENT = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Mobile Safari/537.36`;
export const CHROME_SEC_CH_UA = `"Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}", "Not_A Brand";v="99"`;

export const MAX_BROWSER_LIKE_SITES = 100;

/** The host of a link, or undefined. */
export const hostOfUrl = (url: string): string | undefined => {
  const match = url.trim().match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)/i);
  return match ? normalizeHost(match[1]) : undefined;
};

/** Reads what the user typed (a host or a link) as a site, or says why it cannot be used. */
export const normalizeSite = (input: string): {host: string} | {error: string} => {
  const text = input.trim();
  if (!text) return {error: 'Enter a site, for example example.com.'};
  const host = (text.includes('://') ? hostOfUrl(text) : hostOfUrl(`https://${text}`))?.replace(/^\*\./, '').replace(/^www\./, '');
  if (!host || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(host)) {
    return {error: 'That is not a site name.'};
  }
  if (isLocalHost(host)) return {error: 'Devices on your network do not need this.'};
  if (isDebridHost(host)) return {error: 'Debrid services always use the normal connection.'};
  return {host};
};

/** Adds a site to the list, keeping it sorted and without repeats. */
export const addSite = (sites: readonly string[], input: string): {sites: string[]} | {error: string} => {
  const result = normalizeSite(input);
  if ('error' in result) return result;
  if (sites.includes(result.host)) return {sites: [...sites]};
  if (sites.length >= MAX_BROWSER_LIKE_SITES) return {error: `Up to ${MAX_BROWSER_LIKE_SITES} sites.`};
  return {sites: [...sites, result.host].sort()};
};

/** Keeps only valid entries; used on stored lists. */
export const cleanSites = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string').map(entry => normalizeSite(entry)).flatMap(result => ('host' in result ? [result.host] : [])))]
        .sort()
        .slice(0, MAX_BROWSER_LIKE_SITES)
    : [];

/** True when a request to [host] uses the browser-like connection. */
export const usesBrowserLike = (host: string, sites: readonly string[]): boolean =>
  sites.length > 0 && !isDebridHost(host) && !isLocalHost(host) && hostInList(host, sites);

/** Chrome's headers for a yt-dlp download of [url], put before the other options so the user's own still win. */
export const browserLikeYtdlArgs = (url: string, sites: readonly string[]): string[] => {
  const host = hostOfUrl(url);
  if (!host || !usesBrowserLike(host, sites)) return [];
  return [
    '--add-headers',
    `User-Agent:${CHROME_USER_AGENT}`,
    '--add-headers',
    `Sec-CH-UA:${CHROME_SEC_CH_UA}`,
    '--add-headers',
    'Sec-CH-UA-Mobile:?1',
    '--add-headers',
    'Sec-CH-UA-Platform:"Android"',
    '--add-headers',
    'Accept-Language:en-US,en;q=0.9',
  ];
};
