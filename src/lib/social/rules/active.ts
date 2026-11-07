import type {SocialContext, SocialSite} from '../types';
import {BUNDLED_RULES} from './rules.default';
import {SITE_HOSTS, type RulePattern, type SiteRules, type SocialRules} from './ruleSchema';

let active: SocialRules = BUNDLED_RULES;

/** The rules the site readers use now: an update when one was taken, otherwise the bundled ones. */
export const getSocialRules = (): SocialRules => active;

/** Only for rules that passed validateRules (and, from the network, the signature check). */
export const setActiveSocialRules = (rules: SocialRules): void => {
  active = rules;
};

/** One site's rules for a reader; tests pass their own rules in the context. */
export const siteRules = <S extends SocialSite>(context: Pick<SocialContext, 'rules'> | undefined, site: S): SiteRules[S] =>
  (context?.rules || active).sites[site];

const compiled = new Map<string, RegExp>();

/** The compiled pattern of a rule; [extraFlags] is "g" for matchAll. Patterns were checked when the rules were read. */
export const ruleRegex = (rule: RulePattern, extraFlags = ''): RegExp => {
  const flags = [...new Set(`${rule.flags || ''}${extraFlags}`)].join('');
  const key = `${flags}/${rule.pattern}`;
  let found = compiled.get(key);
  if (!found) {
    if (compiled.size > 500) compiled.clear();
    found = new RegExp(rule.pattern, flags);
    compiled.set(key, found);
  }
  // A shared "g" pattern keeps lastIndex between uses.
  found.lastIndex = 0;
  return found;
};

const hostAllowed = (site: SocialSite, host: string): boolean =>
  SITE_HOSTS[site].some(allowed => host === allowed || host.endsWith(`.${allowed}`));

/**
 * Fills a link template such as "https://{blog}.tumblr.com/api/read/json?id={id}".
 * Values go in as given (callers encode them where the site expects it), and
 * the result must still be an https link on the site's own hosts.
 */
export const fillUrl = (site: SocialSite, template: string, values: Record<string, string> = {}): string => {
  const url = template.replace(/\{([A-Za-z]{1,24})\}/g, (whole, name: string) => (name in values ? values[name] : whole));
  let host = '';
  try {
    const parsed = new URL(url);
    host = parsed.protocol === 'https:' ? parsed.hostname.toLowerCase() : '';
  } catch {
    host = '';
  }
  if (!host || !hostAllowed(site, host)) throw new Error(`The site rules give a link outside ${SITE_HOSTS[site][0]}.`);
  return url;
};

/** Value at a dotted path such as "data.user", or undefined. */
export const atPath = (value: unknown, path: string): unknown => {
  let node = value;
  for (const key of path.split('.')) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(node, key)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
};
