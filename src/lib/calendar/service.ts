/**
 * Loads the calendar for the profile in use, keeps the last result for
 * offline use, and keeps new-episode alerts scheduled. Runs when the app
 * opens, once a day while it (or the download service) keeps running, and
 * when an alert is delivered.
 */
import {AppState} from 'react-native';
import notifee, {AlarmType, AndroidImportance, AuthorizationStatus, TriggerType} from '@notifee/react-native';
import RNApkInstaller from '@himanshu8443/react-native-apk-installer';
import {openStore} from '../storage/openStore';
import {cacheStorage, settingsStorage, watchListStorage} from '../storage';
import {getActiveProfileId, profileKey} from '../profiles/scope';
import {isKidsProfileActive} from '../profiles/profiles';
import useContinueWatchingStore from '../zustand/continueWatchingStore';
import {DEFAULT_ALERT_SETTINGS, planAlerts, staleAlertIds, type AlertSettings} from './alerts';
import {collectShows, kidsFilter, type SavedInfo} from './shows';
import {loadCalendar, type CalendarDeps, type CalendarResult} from './sources';
import type {CalendarEpisode, CalendarShow} from './types';

const store = openStore('droid-stream-calendar');
const CHANNEL_ID = 'new-episodes';
const SETTINGS_KEY = 'alerts';
const LAST_KEY = 'last';
/** The check runs at most this often by itself. */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
/** Opening the app checks again after this long. */
const OPEN_CHECK_AFTER_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const TVMAZE_GAP_MS = 550;

export interface SavedCalendar extends CalendarResult {
  at: number;
  profileId: string;
}

const readJson = <T>(key: string): T | undefined => {
  try {
    const raw = store.getString(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
};
const writeJson = (key: string, value: unknown) => {
  try {
    store.setString(key, JSON.stringify(value));
  } catch {
    // The calendar loads again next time.
  }
};

const listeners = new Set<() => void>();
export const subscribeCalendar = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const notify = () => listeners.forEach(listener => listener());

export const readAlertSettings = (): AlertSettings => {
  const saved = readJson<Partial<AlertSettings>>(profileKey(SETTINGS_KEY)) || {};
  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULT_ALERT_SETTINGS.enabled,
    time: typeof saved.time === 'string' ? saved.time : DEFAULT_ALERT_SETTINGS.time,
    overrides: saved.overrides && typeof saved.overrides === 'object' ? saved.overrides : {},
  };
};

const writeAlertSettings = (next: AlertSettings) => {
  writeJson(profileKey(SETTINGS_KEY), next);
  notify();
};

export const readSavedCalendar = (): SavedCalendar | undefined => {
  const saved = readJson<SavedCalendar>(profileKey(LAST_KEY));
  return saved && saved.profileId === getActiveProfileId() ? saved : undefined;
};

// ---------------------------------------------------------------- Loading

const savedInfo = (provider: string, link: string): SavedInfo | undefined => {
  try {
    const raw = cacheStorage.getString(`contentInfo:${provider}:${link}`);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
};

export const followedShows = (): CalendarShow[] => {
  const library = watchListStorage.getWatchList().map(item => ({title: item.title, poster: item.poster, link: item.link, provider: item.provider}));
  const continueWatching = useContinueWatchingStore.getState().items.map(item => ({
    title: item.title,
    poster: item.poster,
    infoUrl: item.infoUrl,
    providerValue: item.providerValue,
    type: item.type,
  }));
  return kidsFilter(collectShows(library, continueWatching, savedInfo), isKidsProfileActive());
};

let lastTvmaze = 0;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** JSON from a URL; undefined for 404. TVmaze is asked at most about twice a second (its limit is 20 calls in 10 seconds). */
const fetchJson = async (url: string, retried = false): Promise<any> => {
  if (url.includes('api.tvmaze.com')) {
    const gap = lastTvmaze + TVMAZE_GAP_MS - Date.now();
    lastTvmaze = Math.max(Date.now(), lastTvmaze + TVMAZE_GAP_MS);
    if (gap > 0) await wait(gap);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {headers: {Accept: 'application/json'}, signal: controller.signal});
    if (response.status === 404) return undefined;
    if (response.status === 429 && !retried) {
      await wait(10_000);
      return fetchJson(url, true);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const traktGetter = (): CalendarDeps['traktGet'] => {
  try {
    const {readSyncSettings, traktAuthedGet} = require('../watchSync') as typeof import('../watchSync');
    const trakt = readSyncSettings().trakt;
    return trakt.enabled && trakt.accessToken ? traktAuthedGet : undefined;
  } catch {
    return undefined;
  }
};

const calendarDeps = (now: number): CalendarDeps => ({
  fetchJson: url => fetchJson(url),
  traktGet: traktGetter(),
  tmdbKey: settingsStorage.getTmdbApiKey() || undefined,
  cacheGet: key => readJson(`cache:${key}`),
  cacheSet: (key, value) => writeJson(`cache:${key}`, value),
  now,
});

let refreshing: Promise<SavedCalendar> | undefined;

/** Loads the calendar again, saves it and updates the alerts. */
export const refreshCalendar = (): Promise<SavedCalendar> => {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const now = Date.now();
    const kids = isKidsProfileActive();
    const result = await loadCalendar(followedShows(), calendarDeps(now));
    // Genres come in with the episodes, so a kids profile filters again.
    const shows = kidsFilter(result.shows, kids);
    const allowed = new Set(shows.map(show => show.key));
    const saved: SavedCalendar = {...result, shows, episodes: result.episodes.filter(episode => allowed.has(episode.showKey)), at: now, profileId: getActiveProfileId()};
    writeJson(profileKey(LAST_KEY), saved);
    notify();
    await syncAlerts(saved).catch(error => console.warn('[Calendar] Could not schedule alerts', error));
    return saved;
  })().finally(() => {
    refreshing = undefined;
  });
  return refreshing;
};

// ---------------------------------------------------------------- Alerts

const permitted = (status: AuthorizationStatus) => status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL;

/** Schedules the planned alerts and cancels ours that are no longer wanted (another profile's included). */
export const syncAlerts = async (calendar: Pick<SavedCalendar, 'episodes' | 'shows'> | undefined = readSavedCalendar()): Promise<number> => {
  const settings = readAlertSettings();
  const planned = settings.enabled && calendar ? planAlerts(calendar.episodes, calendar.shows, settings, Date.now()) : [];
  const scheduled = await notifee.getTriggerNotificationIds().catch(() => [] as string[]);
  await Promise.all(staleAlertIds(scheduled, planned).map(id => notifee.cancelTriggerNotification(id).catch(() => undefined)));
  if (!planned.length) return 0;
  if (!permitted((await notifee.getNotificationSettings()).authorizationStatus)) return 0;
  await notifee.createChannel({id: CHANNEL_ID, name: 'New episodes', importance: AndroidImportance.HIGH});
  for (const alert of planned) {
    await notifee.createTriggerNotification(
      {
        id: alert.id,
        title: alert.title,
        body: alert.body,
        data: {navigationTarget: 'calendar'},
        android: {
          channelId: CHANNEL_ID,
          smallIcon: 'ic_notification',
          pressAction: {id: 'default', launchActivity: `${RNApkInstaller.packageName}.MainActivity`},
        },
      },
      {type: TriggerType.TIMESTAMP, timestamp: alert.fireAt, alarmManager: {type: AlarmType.SET_AND_ALLOW_WHILE_IDLE}},
    );
  }
  return planned.length;
};

/**
 * Turns alerts on or off. Turning them on asks for notification permission
 * first; when it is refused, alerts stay off and this returns false.
 */
export const setAlertsEnabled = async (enabled: boolean): Promise<boolean> => {
  if (enabled) {
    let status = (await notifee.getNotificationSettings()).authorizationStatus;
    if (!permitted(status)) status = (await notifee.requestPermission()).authorizationStatus;
    if (!permitted(status)) return false;
  }
  writeAlertSettings({...readAlertSettings(), enabled});
  if (enabled) refreshCalendar().catch(() => undefined);
  else await syncAlerts().catch(() => undefined);
  return true;
};

export const setAlertTime = (time: string): void => {
  writeAlertSettings({...readAlertSettings(), time});
  syncAlerts().catch(() => undefined);
};

/** Turns one show's alerts on or off. */
export const setShowAlert = (showKey: string, on: boolean): void => {
  const settings = readAlertSettings();
  writeAlertSettings({...settings, overrides: {...settings.overrides, [showKey]: on}});
  syncAlerts().catch(() => undefined);
};

// ---------------------------------------------------------------- Triggers

const due = (after: number): boolean => {
  const saved = readSavedCalendar();
  return !saved || Date.now() - saved.at >= after;
};

/** For the background handler: an alert was delivered, so plan the next ones when the calendar is old. */
export const refreshAfterDelivery = async (): Promise<void> => {
  if (readAlertSettings().enabled && due(OPEN_CHECK_AFTER_MS)) await refreshCalendar().catch(() => undefined);
};

let started = false;

/** Refreshes on open (when old) and once a day while JavaScript keeps running. */
export const startCalendarChecks = (): (() => void) => {
  if (started) return () => undefined;
  started = true;
  const check = (after: number) => {
    if (readAlertSettings().enabled && due(after)) refreshCalendar().catch(() => undefined);
  };
  const first = setTimeout(() => check(OPEN_CHECK_AFTER_MS), 15_000);
  const appState = AppState.addEventListener('change', state => {
    if (state === 'active') check(OPEN_CHECK_AFTER_MS);
  });
  const interval = setInterval(() => check(CHECK_EVERY_MS), 60 * 60 * 1000);
  return () => {
    started = false;
    clearTimeout(first);
    clearInterval(interval);
    appState.remove();
  };
};

export type {CalendarEpisode, CalendarShow};
