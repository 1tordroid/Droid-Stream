/**
 * User mirror rules for GitHub and Hugging Face downloads. None are built in.
 * Pure: no React Native imports, so it runs in unit tests.
 *
 * A rule's match is a host ("github.com") or a URL prefix
 * ("https://github.com/"). A host stands for "https://host/" and
 * "http://host/". The matching start of the address is replaced by the mirror
 * prefix, so "https://github.com/" -> "https://my-mirror/https://github.com/"
 * turns https://github.com/a/b into https://my-mirror/https://github.com/a/b.
 */

export interface MirrorRule {
  id: string;
  match: string;
  mirror: string;
}

/** Only downloads from these hosts use mirrors. */
export const MIRROR_HOSTS = [
  'github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'huggingface.co',
] as const;

const hostOf = (url: string): string | undefined => {
  const match = /^https?:\/\/([^/?#:@]+)(?::\d+)?(?:[/?#]|$)/i.exec(url.trim());
  return match?.[1].toLowerCase();
};

export const isMirrorableUrl = (url: string): boolean => {
  const host = hostOf(url);
  return Boolean(host && (MIRROR_HOSTS as readonly string[]).includes(host));
};

const isHostRule = (match: string): boolean => !/^[a-z]+:\/\//i.test(match);

/** Checks a rule typed by the user. Returns an error message, or the cleaned rule. */
export const validateMirrorRule = (match: string, mirror: string): {rule: Omit<MirrorRule, 'id'>} | {error: string} => {
  const cleanMatch = match.trim();
  const cleanMirror = mirror.trim();
  if (!cleanMatch || !cleanMirror) return {error: 'Enter both addresses.'};
  if (!/^https?:\/\/[^/\s]+/i.test(cleanMirror) || /\s/.test(cleanMirror)) return {error: 'The mirror must start with https:// or http://.'};
  const host = isHostRule(cleanMatch) ? cleanMatch.toLowerCase().replace(/\/+$/, '') : hostOf(cleanMatch);
  if (!host || !(MIRROR_HOSTS as readonly string[]).includes(host)) {
    return {error: `Mirrors work only for ${MIRROR_HOSTS.join(', ')}.`};
  }
  if (!isHostRule(cleanMatch) && !/^https?:\/\//i.test(cleanMatch)) return {error: 'The address must start with https:// or http://.'};
  return {rule: {match: isHostRule(cleanMatch) ? host : cleanMatch, mirror: cleanMirror}};
};

const withSlash = (value: string): string => (value.endsWith('/') ? value : `${value}/`);

/** The prefix a rule replaces in this URL, or undefined when it does not apply. */
const matchedPrefix = (url: string, rule: MirrorRule): string | undefined => {
  if (isHostRule(rule.match)) {
    const match = /^(https?:\/\/)([^/?#]+)\//i.exec(url);
    return match && match[2].toLowerCase() === rule.match.toLowerCase() ? match[0] : undefined;
  }
  const prefix = rule.match;
  return url.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase() ? url.slice(0, prefix.length) : undefined;
};

/** The mirrored address, using the longest matching rule. Undefined when no rule applies. */
export const applyMirrors = (url: string, rules: MirrorRule[]): string | undefined => {
  if (!isMirrorableUrl(url)) return undefined;
  let best: {prefix: string; rule: MirrorRule} | undefined;
  for (const rule of rules) {
    const prefix = matchedPrefix(url, rule);
    if (prefix !== undefined && (!best || prefix.length > best.prefix.length)) best = {prefix, rule};
  }
  if (!best) return undefined;
  const mirror = isHostRule(best.rule.match) || best.prefix.endsWith('/') ? withSlash(best.rule.mirror) : best.rule.mirror;
  const mirrored = mirror + url.slice(best.prefix.length);
  return mirrored === url ? undefined : mirrored;
};
