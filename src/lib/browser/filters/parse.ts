/**
 * Reads the practical part of the Adblock Plus / uBlock Origin filter syntax:
 * network rules (||domain^, | anchors, *, ^, /regex/, @@ exceptions and the
 * common $options) and cosmetic element hiding (## and #@# with plain CSS).
 * Scriptlets, procedural cosmetics and rules that rewrite requests are
 * skipped. Written for Droid Stream from the public syntax documentation.
 *
 * A compiled rule is one tab-separated line, read by both the JS engine
 * (engine.ts) and the native one (BrowserFilters.kt):
 *   action  host  regex  token  party  typesIn  typesOut  domainsIn  domainsOut  flags
 */

export const TYPE = {
  script: 1,
  image: 2,
  stylesheet: 4,
  object: 8,
  xmlhttprequest: 16,
  subdocument: 32,
  media: 64,
  font: 128,
  websocket: 256,
  ping: 512,
  other: 1024,
  document: 2048,
} as const;

/** A request whose type cannot be told from its URL or Accept header. */
export const UNKNOWN_TYPE = TYPE.script | TYPE.xmlhttprequest | TYPE.other;

const TYPE_OPTIONS: Record<string, number> = {
  script: TYPE.script,
  image: TYPE.image,
  stylesheet: TYPE.stylesheet,
  css: TYPE.stylesheet,
  object: TYPE.object,
  'object-subrequest': TYPE.object,
  xmlhttprequest: TYPE.xmlhttprequest,
  xhr: TYPE.xmlhttprequest,
  subdocument: TYPE.subdocument,
  frame: TYPE.subdocument,
  media: TYPE.media,
  font: TYPE.font,
  websocket: TYPE.websocket,
  ping: TYPE.ping,
  beacon: TYPE.ping,
  other: TYPE.other,
  document: TYPE.document,
  doc: TYPE.document,
};

/** Options that change a request instead of blocking it, or need a full engine. */
const UNSUPPORTED = new Set([
  'popup', 'popunder', 'redirect', 'redirect-rule', 'rewrite', 'removeparam', 'queryprune', 'csp', 'header',
  'permissions', 'replace', 'urltransform', 'uritransform', 'urlskip', 'to', 'denyallow', 'method', 'cname',
  'inline-script', 'inline-font', 'empty', 'mp4', 'strict1p', 'strict3p', 'strict-first-party', 'strict-third-party',
  'webrtc', 'genericblock', 'sitekey', 'ipaddress', 'reason', 'jsonprune', 'cookie',
]);

export interface NetworkRule {
  exception: boolean;
  /** Request host the rule is for (the URL's host or a subdomain of it), when the rule starts with ||host. */
  host: string;
  /** Regex source for the whole URL, or empty when the host is enough. */
  regex: string;
  /** A word that every matching URL contains, used to index the rule. */
  token: string;
  party: '' | '1' | '3';
  typesIn: number;
  typesOut: number;
  domainsIn: string[];
  domainsOut: string[];
  /** c: match case, i: important, d: whole page allowed, g: no generic hiding, h: no hiding, s: no site hiding. */
  flags: string;
}

export interface CosmeticRule {
  exception: boolean;
  domainsIn: string[];
  domainsOut: string[];
  selector: string;
}

export interface ParsedFilters {
  network: NetworkRule[];
  cosmetic: CosmeticRule[];
  /** Raw rules turned off by $badfilter. */
  badfilters: string[];
  skipped: number;
}

const REGEX_SPECIAL = /[.+?${}()|[\]\\]/;
const COMMON_TOKENS = new Set(['http', 'https', 'www', 'com', 'net', 'org', 'html', 'js', 'php', 'cdn', 'static', 'assets']);

/** ABP pattern body (no anchors) to a regex source that works in JavaScript and Java. */
export const patternToRegex = (body: string, hostAnchor: boolean, startAnchor: boolean, endAnchor: boolean): string => {
  let out = '';
  for (const char of body) {
    if (char === '*') out += '.*';
    else if (char === '^') out += '(?:[^\\w\\-.%]|$)';
    else if (REGEX_SPECIAL.test(char)) out += `\\${char}`;
    else out += char;
  }
  const prefix = hostAnchor ? '^[a-z][a-z0-9+.\\-]*://(?:[^/?#]*\\.)?' : startAnchor ? '^' : '';
  let source = prefix + out + (endAnchor ? '$' : '');
  // Leading and trailing wildcards add nothing to a search.
  if (!prefix) source = source.replace(/^(\.\*)+/, '');
  if (!endAnchor) source = source.replace(/(\.\*)+$/, '');
  return source;
};

/**
 * The longest word in the pattern that must appear whole in a matching URL:
 * one bounded by separators or anchors, not by a wildcard.
 */
export const patternToken = (body: string, hostAnchor: boolean, startAnchor: boolean, endAnchor: boolean): string => {
  const lower = body.toLowerCase();
  let best = '';
  let bestScore = 0;
  const runs = lower.matchAll(/[a-z0-9]+/g);
  for (const run of runs) {
    const start = run.index ?? 0;
    const end = start + run[0].length;
    const before = start > 0 ? lower[start - 1] !== '*' : hostAnchor || startAnchor;
    const after = end < lower.length ? lower[end] !== '*' : endAnchor;
    if (!before || !after || run[0].length < 2) continue;
    const score = run[0].length - (COMMON_TOKENS.has(run[0]) ? 10 : 0) + 20;
    if (score > bestScore) {
      best = run[0];
      bestScore = score;
    }
  }
  return best;
};

/** Domain list of $domain= or a cosmetic rule. Entity domains (google.*) cannot be checked and are left out. */
const splitDomains = (value: string, separator: string): {include: string[]; exclude: string[]; dropped: boolean} => {
  const include: string[] = [];
  const exclude: string[] = [];
  let dropped = false;
  for (const raw of value.split(separator)) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    const negated = entry.startsWith('~');
    const domain = negated ? entry.slice(1) : entry;
    if (!/^[a-z0-9.-]+$/.test(domain) || domain.endsWith('.')) {
      if (!negated) dropped = true;
      continue;
    }
    (negated ? exclude : include).push(domain);
  }
  return {include, exclude, dropped};
};

const OPTION_TEXT = /^~?[a-z0-9_-]+(=.*)?$/i;

const parseNetwork = (line: string, badfilters: string[]): NetworkRule | null => {
  let text = line;
  const exception = text.startsWith('@@');
  if (exception) text = text.slice(2);

  let optionsText = '';
  const isRegexRule = /^\/.+\/(\$.*)?$/.test(text) && !text.startsWith('//');
  let dollar = text.lastIndexOf('$');
  if (isRegexRule) {
    const end = text.lastIndexOf('/$');
    dollar = end > 0 ? end + 1 : -1;
  }
  if (dollar >= 0) {
    const candidate = text.slice(dollar + 1);
    if (candidate.split(',').every(option => OPTION_TEXT.test(option.trim()))) {
      optionsText = candidate;
      text = text.slice(0, dollar);
    }
  }

  const rule: NetworkRule = {
    exception,
    host: '',
    regex: '',
    token: '',
    party: '',
    typesIn: 0,
    typesOut: 0,
    domainsIn: [],
    domainsOut: [],
    flags: '',
  };
  let flags = '';
  let blocksDocument = false;
  for (const rawOption of optionsText ? optionsText.split(',') : []) {
    const option = rawOption.trim();
    const lower = option.toLowerCase();
    const negated = lower.startsWith('~');
    const name = (negated ? lower.slice(1) : lower).split('=')[0];
    if (name === 'badfilter') {
      badfilters.push(line.replace(/[$,]badfilter\b/i, '').replace(/\$$/, ''));
      return null;
    }
    if (name in TYPE_OPTIONS) {
      const bit = TYPE_OPTIONS[name];
      if (bit === TYPE.document && !negated) {
        if (!exception) blocksDocument = true;
        else flags += 'd';
        continue;
      }
      if (negated) rule.typesOut |= bit;
      else rule.typesIn |= bit;
    } else if (name === 'all') {
      rule.typesIn = 0;
    } else if (name === 'third-party' || name === '3p') {
      rule.party = negated ? '1' : '3';
    } else if (name === 'first-party' || name === '1p') {
      rule.party = negated ? '3' : '1';
    } else if (name === 'match-case') {
      flags += 'c';
    } else if (name === 'important') {
      flags += 'i';
    } else if (name === 'domain' || name === 'from') {
      const domains = splitDomains(option.slice(option.indexOf('=') + 1), '|');
      if (domains.dropped && !domains.include.length) return null;
      rule.domainsIn = domains.include;
      rule.domainsOut = domains.exclude;
    } else if (name === 'elemhide' || name === 'ehide') {
      if (!exception) return null;
      flags += 'h';
    } else if (name === 'generichide' || name === 'ghide') {
      if (!exception) return null;
      flags += 'g';
    } else if (name === 'specifichide' || name === 'shide') {
      if (!exception) return null;
      flags += 's';
    } else if (name === 'collapse') {
      // Hiding the blocked element's box is the browser's job here.
    } else if (UNSUPPORTED.has(name)) {
      return null;
    } else {
      return null;
    }
  }
  // Blocking whole pages and pop-ups is left out; the user opened them.
  if (blocksDocument) return null;
  rule.flags = flags;

  if (isRegexRule) {
    const source = text.slice(1, -1);
    // Lookbehind, named groups and Unicode classes differ between the
    // JavaScript and Java engines, so those rules are skipped.
    if (/\(\?<|\\[pPk]/.test(source)) return null;
    try {
      // eslint-disable-next-line no-new
      new RegExp(source);
    } catch {
      return null;
    }
    rule.regex = source;
    return rule;
  }

  const hostAnchor = text.startsWith('||');
  const startAnchor = !hostAnchor && text.startsWith('|');
  let body = hostAnchor ? text.slice(2) : startAnchor ? text.slice(1) : text;
  const endAnchor = body.length > 0 && body.endsWith('|');
  if (endAnchor) body = body.slice(0, -1);
  if (body.length > 1000) return null;

  if (!body || body === '*') {
    // Matches every request: only kept when options narrow it down.
    const pageFlags = flags.replace(/[ci]/g, '');
    if (!pageFlags && !rule.domainsIn.length && !rule.typesIn && !rule.party) return null;
    if (!pageFlags) rule.regex = '^';
    return rule;
  }

  if (hostAnchor) {
    const match = /^([a-z0-9.-]+)(.*)$/i.exec(body);
    if (match && !match[1].endsWith('.') && /^[\^/:]/.test(match[2])) {
      rule.host = match[1].toLowerCase();
      const hostOnly = match[2] === '^' && !endAnchor && !flags.includes('c');
      rule.regex = hostOnly ? '' : patternToRegex(body, true, false, endAnchor);
      return rule;
    }
  }
  rule.regex = patternToRegex(body, hostAnchor, startAnchor, endAnchor);
  rule.token = patternToken(body, hostAnchor, startAnchor, endAnchor);
  return rule;
};

/** Pseudo-classes and syntax that plain CSS cannot do. */
const PROCEDURAL = /:(-abp-|has-text\(|contains\(|style\(|xpath\(|upward\(|remove\(|remove-attr\(|remove-class\(|matches-css|matches-media|matches-path|matches-attr|matches-prop|min-text-length|watch-attr|others\(|if\(|if-not\(|nth-ancestor|properties\(|shadow-dom)/i;

const parseCosmetic = (line: string, hashIndex: number): CosmeticRule | null => {
  const domainsText = line.slice(0, hashIndex);
  const rest = line.slice(hashIndex);
  let exception = false;
  let selector: string;
  if (rest.startsWith('##')) selector = rest.slice(2);
  else if (rest.startsWith('#@#')) {
    exception = true;
    selector = rest.slice(3);
  } else return null;
  selector = selector.trim();
  if (!selector || selector.startsWith('+js(') || selector.startsWith('^') || PROCEDURAL.test(selector)) return null;
  if (/[{}]/.test(selector) || selector.length > 500) return null;
  const domains = splitDomains(domainsText, ',');
  if (domains.dropped && !domains.include.length) return null;
  return {exception, domainsIn: domains.include, domainsOut: domains.exclude, selector};
};

/** One line of a filter list. Returns what it was, or null for comments and unsupported rules. */
export const parseFilterLine = (
  raw: string,
  out: ParsedFilters,
): void => {
  const line = raw.trim();
  if (!line || line.startsWith('!') || line.startsWith('[') || line === '#' || line.startsWith('# ')) return;
  // Hosts files: "0.0.0.0 example.com".
  if (/^(?:0\.0\.0\.0|127\.0\.0\.1|::1?)\s/.test(line)) {
    const host = /^\S+\s+([a-z0-9.-]+\.[a-z0-9-]+)\s*(#.*)?$/i.exec(line)?.[1]?.toLowerCase();
    if (host && host !== 'localhost.localdomain') {
      out.network.push({exception: false, host, regex: '', token: '', party: '', typesIn: 0, typesOut: 0, domainsIn: [], domainsOut: [], flags: ''});
    }
    return;
  }
  const hash = line.indexOf('#');
  if (hash >= 0 && /^#@?[?$%]?#/.test(line.slice(hash)) && !line.slice(0, hash).includes('/')) {
    const cosmetic = parseCosmetic(line, hash);
    if (cosmetic) out.cosmetic.push(cosmetic);
    else out.skipped += 1;
    return;
  }
  const network = parseNetwork(line, out.badfilters);
  if (network) out.network.push(network);
  else out.skipped += 1;
};

export const emptyParsed = (): ParsedFilters => ({network: [], cosmetic: [], badfilters: [], skipped: 0});

export const parseFilters = (text: string, out: ParsedFilters = emptyParsed()): ParsedFilters => {
  for (const line of text.split(/\r?\n/)) parseFilterLine(line, out);
  return out;
};

/** The compiled line of a network rule. */
export const ruleToLine = (rule: NetworkRule): string =>
  [
    rule.exception ? 'e' : 'b',
    rule.host,
    rule.regex,
    rule.token,
    rule.party,
    String(rule.typesIn),
    String(rule.typesOut),
    rule.domainsIn.join(','),
    rule.domainsOut.join(','),
    rule.flags,
  ].join('\t');

export const lineToRule = (line: string): NetworkRule | null => {
  const parts = line.split('\t');
  if (parts.length < 10 || (parts[0] !== 'b' && parts[0] !== 'e')) return null;
  return {
    exception: parts[0] === 'e',
    host: parts[1],
    regex: parts[2],
    token: parts[3],
    party: parts[4] as NetworkRule['party'],
    typesIn: Number(parts[5]) || 0,
    typesOut: Number(parts[6]) || 0,
    domainsIn: parts[7] ? parts[7].split(',') : [],
    domainsOut: parts[8] ? parts[8].split(',') : [],
    flags: parts[9],
  };
};

/** Compiled network lines with duplicates and $badfilter targets removed. */
export const compileNetwork = (parsed: ParsedFilters, badfilterLines: string[] = []): string[] => {
  const seen = new Set<string>();
  const cancelled = new Set<string>();
  if (parsed.badfilters.length) {
    const scratch = emptyParsed();
    for (const text of parsed.badfilters) parseFilterLine(text, scratch);
    for (const rule of scratch.network) cancelled.add(ruleToLine(rule));
  }
  for (const line of badfilterLines) cancelled.add(line);
  const lines: string[] = [];
  for (const rule of parsed.network) {
    const line = ruleToLine(rule);
    if (seen.has(line) || cancelled.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
};
