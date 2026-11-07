/**
 * Saved "Keep next episodes ready" rules, one per show. Each profile has its
 * own rules (watched state is per profile). The Wi-Fi and storage limits are
 * for the device, like downloads.
 */
import {openStore} from '../storage/openStore';
import {profileKey} from '../profiles/scope';
import {clampKeep, type RollingRuleState, type RollingStatus} from './rolling';
import type {SourceChoice} from './sourceChoice';

export interface SeriesRule extends RollingRuleState {
  id: string;
  showTitle: string;
  provider: string;
  /** The title page link (provider meta link). */
  infoUrl: string;
  type: string;
  poster?: string;
  background?: string;
  imdbId?: string;
  synopsis?: string;
  /** The season followed now; moves on when one is finished. */
  seasonTitle: string;
  choice?: SourceChoice;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastStatus?: RollingStatus;
  lastReady?: number;
  lastTotal?: number;
  /** A problem from the last run, shown on the card. */
  lastError?: string;
}

export interface SeriesDownloadSettings {
  wifiOnly: boolean;
  /** Rolling downloads stop below this much free space. */
  minFreeGb: number;
}

export const FREE_SPACE_CHOICES = [1, 2, 5, 10];
export const DEFAULT_SERIES_SETTINGS: SeriesDownloadSettings = {wifiOnly: true, minFreeGb: 2};

const store = openStore('droid-stream-series-downloads');
const RULES_KEY = 'rules';
const SETTINGS_KEY = 'settings';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => {
  try {
    listener();
  } catch {
    // A listener must not stop the others.
  }
});

export const subscribeSeriesRules = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const seriesRuleId = (provider: string, infoUrl: string): string => `${provider}|${infoUrl}`;

export const readSeriesRules = (): SeriesRule[] => {
  try {
    const parsed = JSON.parse(store.getString(profileKey(RULES_KEY)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(rule => rule && typeof rule.id === 'string') : [];
  } catch {
    return [];
  }
};

const writeRules = (rules: SeriesRule[]): void => {
  store.setString(profileKey(RULES_KEY), JSON.stringify(rules));
  notify();
};

export const findSeriesRule = (provider: string, infoUrl: string): SeriesRule | undefined =>
  readSeriesRules().find(rule => rule.id === seriesRuleId(provider, infoUrl));

export type NewSeriesRule = Pick<SeriesRule, 'showTitle' | 'provider' | 'infoUrl' | 'type' | 'seasonTitle' | 'keep' | 'deleteAfterWatching'> &
  Partial<Pick<SeriesRule, 'poster' | 'background' | 'imdbId' | 'synopsis' | 'choice'>>;

/** Adds the show's rule, or updates it when there is one. */
export const saveSeriesRule = (draft: NewSeriesRule, now = Date.now()): SeriesRule => {
  const rules = readSeriesRules();
  const id = seriesRuleId(draft.provider, draft.infoUrl);
  const existing = rules.find(rule => rule.id === id);
  const rule: SeriesRule = {
    owned: {},
    failures: {},
    paused: false,
    createdAt: now,
    ...existing,
    ...draft,
    keep: clampKeep(draft.keep),
    id,
    updatedAt: now,
  };
  writeRules(existing ? rules.map(item => (item.id === id ? rule : item)) : [...rules, rule]);
  return rule;
};

export const updateSeriesRule = (id: string, patch: Partial<SeriesRule> | ((rule: SeriesRule) => Partial<SeriesRule>)): SeriesRule | undefined => {
  const rules = readSeriesRules();
  let updated: SeriesRule | undefined;
  const next = rules.map(rule => {
    if (rule.id !== id) return rule;
    const change = typeof patch === 'function' ? patch(rule) : patch;
    updated = {...rule, ...change, id, ...(change.keep !== undefined ? {keep: clampKeep(change.keep)} : {})};
    return updated;
  });
  if (updated) writeRules(next);
  return updated;
};

export const removeSeriesRule = (id: string): void => {
  writeRules(readSeriesRules().filter(rule => rule.id !== id));
};

export const readSeriesSettings = (): SeriesDownloadSettings => {
  try {
    const parsed = JSON.parse(store.getString(SETTINGS_KEY) || '{}');
    return {
      wifiOnly: typeof parsed.wifiOnly === 'boolean' ? parsed.wifiOnly : DEFAULT_SERIES_SETTINGS.wifiOnly,
      minFreeGb: typeof parsed.minFreeGb === 'number' && parsed.minFreeGb >= 0 ? parsed.minFreeGb : DEFAULT_SERIES_SETTINGS.minFreeGb,
    };
  } catch {
    return {...DEFAULT_SERIES_SETTINGS};
  }
};

export const writeSeriesSettings = (patch: Partial<SeriesDownloadSettings>): SeriesDownloadSettings => {
  const next = {...readSeriesSettings(), ...patch};
  store.setString(SETTINGS_KEY, JSON.stringify(next));
  notify();
  return next;
};
