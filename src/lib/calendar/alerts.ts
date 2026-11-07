/**
 * New-episode alerts: planned from the calendar, then scheduled as Notifee
 * trigger notifications, so they arrive with the app closed. Off until the
 * person turns them on; then shows in the watch list alert unless muted, and
 * other shows (Continue watching, Trakt) only when turned on one by one.
 */
import {DAY_MS, episodeCode, localDayIndex, startOfLocalDay, type TimezoneOffset, deviceOffset} from './group';
import type {CalendarEpisode, CalendarShow} from './types';

/** "air" fires at air time; "HH:MM" at that local time on or after the air time. */
export type AlertTime = 'air' | string;

export interface AlertSettings {
  enabled: boolean;
  time: AlertTime;
  /** Per show: true to alert, false to mute. Missing: alert for watch list shows. */
  overrides: Record<string, boolean>;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {enabled: false, time: 'air', overrides: {}};
export const ALERT_TIME_CHOICES: AlertTime[] = ['air', '09:00', '12:00', '18:00', '20:00'];
/** A day-only air date alerts at this time when "At air time" is chosen. */
export const DATE_ONLY_TIME = '09:00';
export const ALERT_ID_PREFIX = 'newep-';
/** Alerts are scheduled this far ahead; the app plans again when it opens. */
export const ALERT_AHEAD_MS = 14 * DAY_MS;
export const MAX_ALERTS = 60;

export const alertTimeLabel = (time: AlertTime): string => (time === 'air' ? 'At air time' : time);

export const alertsOnFor = (show: Pick<CalendarShow, 'key' | 'inWatchList'>, settings: AlertSettings): boolean =>
  settings.overrides[show.key] ?? show.inWatchList;

const minutesOf = (time: string): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  return match ? Math.min(23, Number(match[1])) * 60 + Math.min(59, Number(match[2])) : 9 * 60;
};

/** When the alert for an episode goes off. */
export const alertTimeFor = (episode: Pick<CalendarEpisode, 'airsAt' | 'timeKnown'>, time: AlertTime, offset: TimezoneOffset = deviceOffset): number => {
  if (time === 'air' && episode.timeKnown) return episode.airsAt;
  const day = localDayIndex(episode.airsAt, offset);
  const minutes = minutesOf(time === 'air' ? DATE_ONLY_TIME : time);
  const atDay = (index: number) => startOfLocalDay(index, offset) + minutes * 60_000;
  const sameDay = atDay(day);
  // The chosen time comes after the episode is out: the next day when it airs later.
  return episode.timeKnown && sameDay < episode.airsAt ? atDay(day + 1) : sameDay;
};

export interface PlannedAlert {
  id: string;
  fireAt: number;
  title: string;
  body: string;
  showKey: string;
}

const hash = (text: string): string => {
  let value = 5381;
  for (let index = 0; index < text.length; index++) value = (value * 33 + text.charCodeAt(index)) % 4294967296;
  return value.toString(36);
};

/** "S02E05", "S02E01–E03" for a run in one season, else "3 episodes". */
const codesText = (episodes: CalendarEpisode[]): string => {
  if (episodes.length === 1) return episodeCode(episodes[0].season, episodes[0].episode);
  const seasons = new Set(episodes.map(episode => episode.season));
  if (seasons.size === 1) {
    const numbers = episodes.map(episode => episode.episode).sort((a, b) => a - b);
    return `${episodeCode(episodes[0].season, numbers[0])}–E${String(numbers[numbers.length - 1]).padStart(2, '0')}`;
  }
  return `${episodes.length} episodes`;
};

/**
 * Alerts to schedule: future episodes of shows with alerts on, within
 * [ALERT_AHEAD_MS]. Episodes of one show at the same moment (a whole season
 * at once) make one alert.
 */
export const planAlerts = (
  episodes: CalendarEpisode[],
  shows: Pick<CalendarShow, 'key' | 'inWatchList'>[],
  settings: AlertSettings,
  now: number,
  offset: TimezoneOffset = deviceOffset,
): PlannedAlert[] => {
  if (!settings.enabled) return [];
  const showByKey = new Map(shows.map(show => [show.key, show]));
  const groups = new Map<string, {fireAt: number; items: CalendarEpisode[]}>();
  for (const episode of episodes) {
    const show = showByKey.get(episode.showKey);
    if (!show || !alertsOnFor(show, settings)) continue;
    const fireAt = alertTimeFor(episode, settings.time, offset);
    if (fireAt <= now || fireAt > now + ALERT_AHEAD_MS) continue;
    const key = `${episode.showKey}@${fireAt}`;
    const group = groups.get(key) || {fireAt, items: []};
    if (!group.items.some(item => item.id === episode.id)) group.items.push(episode);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.fireAt - b.fireAt)
    .slice(0, MAX_ALERTS)
    .map(({fireAt, items}) => {
      const first = items[0];
      const several = items.length > 1;
      const named = !several && first.title ? `: ${first.title}` : '';
      return {
        id: `${ALERT_ID_PREFIX}${hash(first.showKey)}-${first.season}-${first.episode}`,
        fireAt,
        showKey: first.showKey,
        title: `${several ? 'New episodes' : 'New episode'}: ${first.showTitle} ${codesText(items)}`,
        body: several ? `${items.length} episodes are out` : `Out now${named}`,
      };
    });
};

/** Which scheduled alerts to cancel: ours that are no longer planned. */
export const staleAlertIds = (scheduled: string[], planned: Pick<PlannedAlert, 'id'>[]): string[] => {
  const keep = new Set(planned.map(alert => alert.id));
  return scheduled.filter(id => id.startsWith(ALERT_ID_PREFIX) && !keep.has(id));
};
