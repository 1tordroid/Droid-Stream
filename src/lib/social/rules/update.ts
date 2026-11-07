import {socialStore} from '../settings';
import {getSocialRules, setActiveSocialRules} from './active';
import {BUNDLED_RULES} from './rules.default';
import {verifyRulesSignature} from './signature';
import type {SocialRules} from './ruleSchema';
import {parseRules, RULES_LIMITS} from './validate';

export const RULES_URL = 'https://raw.githubusercontent.com/1tordroid/Droid-Stream/main/rules/social-rules.json';
export const RULES_SIGNATURE_URL = `${RULES_URL}.sig`;

const KEY_RULES = 'rules.text';
const KEY_CHECKED = 'rules.checkedAt';
const KEY_UPDATED = 'rules.updatedAt';
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 20_000;

let loaded = false;

/** Rules stored from an earlier update, when they are still valid. */
const storedRules = (): SocialRules | undefined => {
  try {
    const text = socialStore.getString(KEY_RULES);
    return text ? parseRules(text) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Makes the newest valid rules active: the stored update, or the bundled
 * rules when the app itself brought a newer version. Cheap after the first call.
 */
export const loadSocialRules = (): SocialRules => {
  if (!loaded) {
    loaded = true;
    const stored = storedRules();
    setActiveSocialRules(stored && stored.version > BUNDLED_RULES.version ? stored : BUNDLED_RULES);
  }
  return getSocialRules();
};

export interface RulesInfo {
  version: number;
  /** Day the rules were changed, YYYY-MM-DD. */
  updated: string;
  /** The rules came with the app (no newer update taken). */
  bundled: boolean;
  /** Last check, in ms since 1970, or 0. */
  checkedAt: number;
}

export const socialRulesInfo = (): RulesInfo => {
  const rules = loadSocialRules();
  return {
    version: rules.version,
    updated: rules.updated,
    bundled: rules === BUNDLED_RULES,
    checkedAt: Number(socialStore.getString(KEY_CHECKED)) || 0,
  };
};

export type RulesCheck =
  | {status: 'updated'; version: number}
  | {status: 'current'; version: number}
  | {status: 'skipped'; version: number}
  | {status: 'failed'; version: number; reason: string};

type Fetcher = (url: string, init: {signal: AbortSignal; headers: Record<string, string>}) => Promise<{ok: boolean; status: number; text: () => Promise<string>}>;

export interface CheckOptions {
  /** "Check now": ignore the once-a-day limit. */
  force?: boolean;
  now?: number;
  fetch?: Fetcher;
  publicKey?: string;
}

const download = async (fetcher: Fetcher, url: string, maxBytes: number): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(url, {signal: controller.signal, headers: {Accept: 'text/plain, application/json'}});
    if (!response.ok) throw new Error(`error ${response.status}`);
    const text = await response.text();
    if (text.length > maxBytes) throw new Error('the file is too large');
    return text;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Looks for newer site rules in the repository: at most once a day unless
 * forced. A file is taken only when its Ed25519 signature matches the key in
 * the app, it passes every check, and its version is higher than the active
 * one. On any failure the current rules stay.
 */
export const checkSocialRules = async (options: CheckOptions = {}): Promise<RulesCheck> => {
  const current = loadSocialRules();
  const now = options.now ?? Date.now();
  const last = Number(socialStore.getString(KEY_CHECKED)) || 0;
  if (!options.force && last && now - last < DAY_MS && now >= last) return {status: 'skipped', version: current.version};
  socialStore.setString(KEY_CHECKED, String(now));
  const fetcher: Fetcher = options.fetch || ((url, init) => fetch(url, {...init, credentials: 'omit', cache: 'no-store'} as RequestInit));
  try {
    const [text, signature] = await Promise.all([
      download(fetcher, RULES_URL, RULES_LIMITS.fileBytes),
      download(fetcher, RULES_SIGNATURE_URL, 1024),
    ]);
    if (!verifyRulesSignature(text, signature, options.publicKey)) throw new Error('the signature does not match');
    const rules = parseRules(text);
    if (rules.version <= current.version) return {status: 'current', version: current.version};
    socialStore.setString(KEY_RULES, text);
    socialStore.setString(KEY_UPDATED, String(now));
    setActiveSocialRules(rules);
    return {status: 'updated', version: rules.version};
  } catch (error) {
    return {status: 'failed', version: current.version, reason: error instanceof Error ? error.message : String(error)};
  }
};

/** For tests: forget what was loaded. */
export const resetSocialRulesForTests = (): void => {
  loaded = false;
  setActiveSocialRules(BUNDLED_RULES);
};
