import {describe, expect, it} from '@jest/globals';
import {alertTimeFor, alertsOnFor, planAlerts, staleAlertIds, type AlertSettings} from '../src/lib/calendar/alerts';
import type {TimezoneOffset} from '../src/lib/calendar/group';
import type {CalendarEpisode} from '../src/lib/calendar/types';

const india: TimezoneOffset = () => 330;
// Local India time on 9 Nov 2026 plus [days].
const local = (days: number, hour: number, minute = 0) => Date.UTC(2026, 10, 9 + days, hour, minute) - 330 * 60_000;
const now = local(0, 10);

const episode = (showKey: string, number: number, airsAt: number, extra: Partial<CalendarEpisode> = {}): CalendarEpisode => ({
  id: `${showKey}:2:${number}`,
  showKey,
  showTitle: showKey === 'tt1' ? 'The Show' : 'Other',
  season: 2,
  episode: number,
  title: `Chapter ${number}`,
  airsAt,
  timeKnown: true,
  source: 'tvmaze',
  open: {kind: 'info', link: 'l', provider: 'p'},
  ...extra,
});

const on: AlertSettings = {enabled: true, time: 'air', overrides: {}};
const shows = [
  {key: 'tt1', inWatchList: true},
  {key: 'tt2', inWatchList: false},
];

describe('alert times', () => {
  it('alerts at air time', () => {
    expect(alertTimeFor({airsAt: local(1, 21), timeKnown: true}, 'air', india)).toBe(local(1, 21));
  });

  it('alerts at a chosen time on or after the air time', () => {
    expect(alertTimeFor({airsAt: local(1, 6), timeKnown: true}, '09:00', india)).toBe(local(1, 9));
    // Out at 21:00: the 09:00 alert comes the next morning.
    expect(alertTimeFor({airsAt: local(1, 21), timeKnown: true}, '09:00', india)).toBe(local(2, 9));
  });

  it('alerts a date-only episode at 09:00 that day', () => {
    expect(alertTimeFor({airsAt: local(1, 0), timeKnown: false}, 'air', india)).toBe(local(1, 9));
    expect(alertTimeFor({airsAt: local(1, 0), timeKnown: false}, '20:00', india)).toBe(local(1, 20));
  });
});

describe('alert planning', () => {
  it('plans nothing while alerts are off', () => {
    expect(planAlerts([episode('tt1', 5, local(1, 21))], shows, {...on, enabled: false}, now, india)).toEqual([]);
  });

  it('alerts for watch list shows by default and not for the others', () => {
    const plan = planAlerts([episode('tt1', 5, local(1, 21)), episode('tt2', 1, local(1, 21))], shows, on, now, india);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({title: 'New episode: The Show S02E05', body: 'Out now: Chapter 5', fireAt: local(1, 21), showKey: 'tt1'});
  });

  it('respects a muted show and a show turned on', () => {
    const settings = {...on, overrides: {tt1: false, tt2: true}};
    const plan = planAlerts([episode('tt1', 5, local(1, 21)), episode('tt2', 1, local(1, 21))], shows, settings, now, india);
    expect(plan.map(alert => alert.showKey)).toEqual(['tt2']);
    expect(alertsOnFor(shows[0], settings)).toBe(false);
  });

  it('skips the past and episodes more than 14 days ahead', () => {
    const plan = planAlerts([episode('tt1', 1, local(-1, 21)), episode('tt1', 2, local(0, 9)), episode('tt1', 3, local(20, 21))], shows, on, now, india);
    expect(plan).toEqual([]);
  });

  it('makes one alert for a season out at once', () => {
    const at = local(2, 13, 30);
    const plan = planAlerts([1, 2, 3].map(number => episode('tt1', number, at)), shows, on, now, india);
    expect(plan).toHaveLength(1);
    expect(plan[0].title).toBe('New episodes: The Show S02E01–E03');
    expect(plan[0].body).toBe('3 episodes are out');
  });

  it('keeps ids stable and cancels only its own stale alerts', () => {
    const first = planAlerts([episode('tt1', 5, local(1, 21))], shows, on, now, india);
    const again = planAlerts([episode('tt1', 5, local(1, 21))], shows, on, now + 60_000, india);
    expect(first[0].id).toBe(again[0].id);
    expect(staleAlertIds(['newep-old-1-1', first[0].id, 'livetv-abc-1'], first)).toEqual(['newep-old-1-1']);
  });
});
