/**
 * Userscript metadata (the ==UserScript== block) and the rules for which
 * pages a script runs on: @match patterns, @include and @exclude globs or
 * /regex/. Written for Droid Stream from the Greasemonkey and Tampermonkey
 * documentation.
 */

export type RunAt = 'document-start' | 'document-end' | 'document-idle';

export interface UserscriptMeta {
  name: string;
  namespace?: string;
  version?: string;
  description?: string;
  author?: string;
  match: string[];
  include: string[];
  exclude: string[];
  excludeMatch: string[];
  runAt: RunAt;
  grant: string[];
  require: string[];
  connect: string[];
  noframes: boolean;
  updateURL?: string;
  downloadURL?: string;
}

/** The GM functions Droid Stream provides. Others are absent from the page. */
export const SUPPORTED_GRANTS = [
  'GM_addStyle',
  'GM_setValue',
  'GM_getValue',
  'GM_deleteValue',
  'GM_listValues',
  'GM_xmlhttpRequest',
  'GM_openInTab',
  'GM_setClipboard',
  'GM_notification',
  'GM_info',
  'unsafeWindow',
  'GM.addStyle',
  'GM.setValue',
  'GM.getValue',
  'GM.deleteValue',
  'GM.listValues',
  'GM.xmlHttpRequest',
  'GM.openInTab',
  'GM.setClipboard',
  'GM.notification',
  'GM.info',
  'none',
] as const;

export const parseUserscript = (code: string): UserscriptMeta | null => {
  const block = /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/.exec(code);
  if (!block) return null;
  const meta: UserscriptMeta = {
    name: '',
    match: [],
    include: [],
    exclude: [],
    excludeMatch: [],
    runAt: 'document-idle',
    grant: [],
    require: [],
    connect: [],
    noframes: false,
  };
  for (const raw of block[1].split(/\r?\n/)) {
    const line = /^\s*\/\/\s*@([\w:.-]+)(?:\s+(.*))?$/.exec(raw);
    if (!line) continue;
    const key = line[1];
    const value = (line[2] || '').trim();
    switch (key) {
      case 'name':
        if (!meta.name) meta.name = value;
        break;
      case 'namespace':
      case 'version':
      case 'description':
      case 'author':
      case 'updateURL':
      case 'downloadURL':
        if (meta[key] === undefined && value) meta[key] = value;
        break;
      case 'match':
        if (value) meta.match.push(value);
        break;
      case 'include':
        if (value) meta.include.push(value);
        break;
      case 'exclude':
        if (value) meta.exclude.push(value);
        break;
      case 'exclude-match':
        if (value) meta.excludeMatch.push(value);
        break;
      case 'run-at':
        if (value === 'document-start' || value === 'document-end' || value === 'document-idle') meta.runAt = value;
        else if (value === 'document-body') meta.runAt = 'document-end';
        break;
      case 'grant':
        if (value) meta.grant.push(value);
        break;
      case 'require':
        if (value) meta.require.push(value);
        break;
      case 'connect':
        if (value) meta.connect.push(value);
        break;
      case 'noframes':
        meta.noframes = true;
        break;
      default:
        break;
    }
  }
  if (!meta.name) return null;
  return meta;
};

const escapeRegex = (value: string): string => value.replace(/[.+?^${}()|[\]\\/]/g, '\\$&');

/**
 * A @match pattern ("*://*.example.com/path*", "<all_urls>") as a regex.
 * Returns null for a pattern that is not valid.
 */
export const matchPatternToRegex = (pattern: string): RegExp | null => {
  if (pattern === '<all_urls>') return /^(https?|file|ftp):\/\//i;
  const match = /^(\*|https?|file|ftp|wss?):\/\/(\*|\*\.[^/*]+|[^/*]*)(\/.*)?$/i.exec(pattern.trim());
  if (!match) return null;
  const [, scheme, host, path = '/*'] = match;
  const schemePart = scheme === '*' ? 'https?' : escapeRegex(scheme.toLowerCase());
  let hostPart: string;
  if (host === '*') hostPart = '[^/:]+';
  else if (host.startsWith('*.')) hostPart = `(?:[^/:]+\\.)?${escapeRegex(host.slice(2).toLowerCase())}`;
  else hostPart = escapeRegex(host.toLowerCase());
  const pathPart = path.split('*').map(escapeRegex).join('.*');
  return new RegExp(`^${schemePart}://${hostPart}(?::\\d+)?${pathPart}$`, 'i');
};

/** An @include or @exclude glob, or a /regex/ when written that way. ".tld" matches any top-level domain. */
export const includeToRegex = (pattern: string): RegExp | null => {
  const text = pattern.trim();
  if (!text) return null;
  if (text.length > 2 && text.startsWith('/') && text.endsWith('/')) {
    try {
      return new RegExp(text.slice(1, -1), 'i');
    } catch {
      return null;
    }
  }
  if (text === '*') return /^/;
  const source = text
    .split('*')
    .map(part => escapeRegex(part).replace(/\\\.tld(?=\\\/|$)/gi, '\\.[a-z]{2,}(?:\\.[a-z]{2,})?'))
    .join('.*');
  return new RegExp(`^${source}$`, 'i');
};

const anyMatches = (patterns: string[], url: string, convert: (pattern: string) => RegExp | null): boolean =>
  patterns.some(pattern => convert(pattern)?.test(url) === true);

/** Whether a script runs on a page. A script with no @match or @include runs everywhere. */
export const scriptRunsOn = (meta: Pick<UserscriptMeta, 'match' | 'include' | 'exclude' | 'excludeMatch'>, url: string): boolean => {
  if (!/^https?:\/\//i.test(url)) return false;
  if (anyMatches(meta.exclude, url, includeToRegex)) return false;
  if (anyMatches(meta.excludeMatch, url, matchPatternToRegex)) return false;
  if (!meta.match.length && !meta.include.length) return true;
  return anyMatches(meta.match, url, matchPatternToRegex) || anyMatches(meta.include, url, includeToRegex);
};

/** The regex sources the page checks itself (the injected script runs every enabled script's check). */
export const runRules = (meta: Pick<UserscriptMeta, 'match' | 'include' | 'exclude' | 'excludeMatch'>): {include: string[]; exclude: string[]; everywhere: boolean} => {
  const include = [
    ...meta.match.map(matchPatternToRegex),
    ...meta.include.map(includeToRegex),
  ].filter((item): item is RegExp => Boolean(item)).map(item => item.source);
  const exclude = [
    ...meta.exclude.map(includeToRegex),
    ...meta.excludeMatch.map(matchPatternToRegex),
  ].filter((item): item is RegExp => Boolean(item)).map(item => item.source);
  return {include, exclude, everywhere: !meta.match.length && !meta.include.length};
};

export const isUserscriptUrl = (url: string): boolean => /^https?:\/\/[^?#]+\.user\.js(\?|#|$)/i.test(url);
