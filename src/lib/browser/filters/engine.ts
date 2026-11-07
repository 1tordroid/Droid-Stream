import {getDomain} from 'tldts';
import {lineToRule, TYPE, UNKNOWN_TYPE, type NetworkRule} from './parse';

/**
 * Matches requests against compiled network rules. The native engine
 * (BrowserFilters.kt) follows the same steps, so this one is what the tests
 * check. Rules are indexed by host (for ||host rules) and by one word of
 * their pattern, so a request only tests a handful of them.
 */

interface IndexedRule extends NetworkRule {
  compiled?: RegExp | null;
}

interface RuleSet {
  byHost: Map<string, IndexedRule[]>;
  byToken: Map<string, IndexedRule[]>;
  generic: IndexedRule[];
}

const emptySet = (): RuleSet => ({byHost: new Map(), byToken: new Map(), generic: []});

const add = (map: Map<string, IndexedRule[]>, key: string, rule: IndexedRule) => {
  const list = map.get(key);
  if (list) list.push(rule);
  else map.set(key, [rule]);
};

/** "a.b.example.com" and every parent domain, longest first. */
export const hostSuffixes = (host: string): string[] => {
  const out: string[] = [];
  let rest = host;
  while (rest) {
    out.push(rest);
    const dot = rest.indexOf('.');
    if (dot < 0) break;
    rest = rest.slice(dot + 1);
  }
  return out;
};

export const urlTokens = (url: string): string[] => {
  const tokens = url.toLowerCase().split(/[^a-z0-9]+/);
  return Array.from(new Set(tokens.filter(token => token.length >= 2)));
};

const domainMatches = (host: string, domain: string): boolean =>
  host === domain || (host.length > domain.length && host.endsWith(domain) && host[host.length - domain.length - 1] === '.');

export const siteOf = (host: string): string => getDomain(host, {allowPrivateDomains: false}) || host;

export const isThirdParty = (requestHost: string, pageHost: string): boolean =>
  Boolean(pageHost) && siteOf(requestHost) !== siteOf(pageHost);

const MEDIA_EXT = /\.(mp4|webm|m3u8|mpd|ts|m4s|m4a|m4v|mp3|aac|ogg|oga|opus|wav|flac|mkv|mov)$/;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/;

/** Request type from the URL and the Accept header, as far as they tell. */
export const inferRequestType = (url: string, accept: string, mainFrame: boolean): number => {
  if (mainFrame) return TYPE.document;
  const lowerAccept = accept.toLowerCase();
  if (lowerAccept.startsWith('text/html')) return TYPE.subdocument;
  if (lowerAccept.startsWith('image/')) return TYPE.image;
  if (lowerAccept.startsWith('text/css')) return TYPE.stylesheet;
  if (/^wss?:/i.test(url)) return TYPE.websocket;
  const path = url.toLowerCase().split(/[?#]/)[0];
  if (/\.m?js$/.test(path)) return TYPE.script;
  if (path.endsWith('.css')) return TYPE.stylesheet;
  if (IMAGE_EXT.test(path)) return TYPE.image;
  if (/\.(woff2?|ttf|otf|eot)$/.test(path)) return TYPE.font;
  if (MEDIA_EXT.test(path)) return TYPE.media;
  return UNKNOWN_TYPE;
};

export interface RequestContext {
  url: string;
  host: string;
  pageHost: string;
  type: number;
  thirdParty: boolean;
}

export const makeContext = (url: string, pageUrl: string, type: number): RequestContext => {
  const host = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^:/?#]+)/i.exec(url)?.[1]?.toLowerCase() || '';
  const pageHost = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^:/?#]+)/i.exec(pageUrl)?.[1]?.toLowerCase() || '';
  return {url, host, pageHost, type, thirdParty: isThirdParty(host, pageHost)};
};

const optionsMatch = (rule: IndexedRule, context: RequestContext): boolean => {
  if (rule.party === '3' && !context.thirdParty) return false;
  if (rule.party === '1' && context.thirdParty) return false;
  if (rule.typesIn && !(rule.typesIn & context.type)) return false;
  if (rule.typesOut && (rule.typesOut & context.type) === context.type) return false;
  if (rule.domainsOut.length && rule.domainsOut.some(domain => domainMatches(context.pageHost, domain))) return false;
  if (rule.domainsIn.length && !rule.domainsIn.some(domain => domainMatches(context.pageHost, domain))) return false;
  if (rule.regex) {
    if (rule.compiled === undefined) {
      try {
        rule.compiled = new RegExp(rule.regex, rule.flags.includes('c') ? '' : 'i');
      } catch {
        rule.compiled = null;
      }
    }
    if (!rule.compiled || !rule.compiled.test(context.url)) return false;
  }
  return true;
};

const findIn = (set: RuleSet, context: RequestContext, suffixes: string[], tokens: string[]): IndexedRule | undefined => {
  for (const suffix of suffixes) {
    const rules = set.byHost.get(suffix);
    if (rules) for (const rule of rules) if (optionsMatch(rule, context)) return rule;
  }
  for (const token of tokens) {
    const rules = set.byToken.get(token);
    if (rules) for (const rule of rules) if (optionsMatch(rule, context)) return rule;
  }
  for (const rule of set.generic) if (optionsMatch(rule, context)) return rule;
  return undefined;
};

export interface MatchResult {
  blocked: boolean;
  rule?: NetworkRule;
  exception?: NetworkRule;
}

export class FilterEngine {
  private blocks = emptySet();
  private important = emptySet();
  private exceptions = emptySet();
  /** Exceptions with page-wide flags ($document, $elemhide, $generichide, $specifichide). */
  private pageRules: IndexedRule[] = [];
  size = 0;

  static fromLines(lines: string[]): FilterEngine {
    const engine = new FilterEngine();
    for (const line of lines) {
      const rule = lineToRule(line);
      if (rule) engine.add(rule);
    }
    return engine;
  }

  add(rule: NetworkRule): void {
    this.size += 1;
    if (rule.exception && /[dghs]/.test(rule.flags)) {
      this.pageRules.push(rule);
      return;
    }
    const set = rule.exception ? this.exceptions : rule.flags.includes('i') ? this.important : this.blocks;
    if (rule.host) add(set.byHost, rule.host, rule);
    else if (rule.token) add(set.byToken, rule.token, rule);
    else set.generic.push(rule);
  }

  /** Page-wide exception flags for a page: d (nothing blocked), g, h, s (hiding off). */
  pageFlags(pageUrl: string): string {
    if (!this.pageRules.length) return '';
    const context = makeContext(pageUrl, pageUrl, TYPE.document);
    let flags = '';
    for (const rule of this.pageRules) {
      if (rule.host && !hostSuffixes(context.host).includes(rule.host)) continue;
      if (optionsMatch(rule, context)) flags += rule.flags.replace(/[ci]/g, '');
    }
    return Array.from(new Set(flags.split(''))).join('');
  }

  match(url: string, pageUrl: string, type: number): MatchResult {
    const context = makeContext(url, pageUrl, type);
    if (!context.host) return {blocked: false};
    const suffixes = hostSuffixes(context.host);
    const tokens = urlTokens(url);
    const important = findIn(this.important, context, suffixes, tokens);
    if (important) return {blocked: true, rule: important};
    const rule = findIn(this.blocks, context, suffixes, tokens);
    if (!rule) return {blocked: false};
    const exception = findIn(this.exceptions, context, suffixes, tokens);
    if (exception) return {blocked: false, rule, exception};
    return {blocked: true, rule};
  }

  /** The whole decision for one request, as the native hook makes it. */
  shouldBlock(url: string, pageUrl: string, type: number): boolean {
    if (type === TYPE.document) return false;
    if (this.pageFlags(pageUrl).includes('d')) return false;
    return this.match(url, pageUrl, type).blocked;
  }
}
