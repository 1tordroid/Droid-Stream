import {describe, expect, it} from '@jest/globals';
import {dayLabel, formatAirTime, groupCalendar, localDayIndex, startOfLocalDay, type TimezoneOffset} from '../src/lib/calendar/group';
import type {CalendarEpisode} from '../src/lib/calendar/types';

const india: TimezoneOffset = () => 330;
const newYork: TimezoneOffset = () => -300;
// Daylight saving that starts at 2026-03-08 07:00 UTC (-5 → -4 hours).
const usWithDst: TimezoneOffset = at => (at >= Date.UTC(2026, 2, 8, 7) ? -240 : -300);

const episode = (id: string, airsAt: number, extra: Partial<CalendarEpisode> = {}): CalendarEpisode => ({
  id,
  showKey: id.split(':')[0],
  showTitle: id.split(':')[0],
  season: 1,
  episode: Number(id.split(':')[2] || 1),
  airsAt,
  timeKnown: true,
  source: 'tvmaze',
  open: {kind: 'info', link: 'l', provider: 'p'},
  ...extra,
});

describe('calendar days and time zones', () => {
  it('puts an episode on the local day', () => {
    // 2026-11-09 20:00 UTC is 10 Nov 01:30 in India and 9 Nov 15:00 in New York.
    const at = Date.UTC(2026, 10, 9, 20, 0);
    expect(dayLabel(localDayIndex(at, india))).toBe('Tuesday 10 Nov');
    expect(dayLabel(localDayIndex(at, newYork))).toBe('Monday 9 Nov');
    expect(formatAirTime(at, india)).toBe('01:30');
    expect(formatAirTime(at, newYork)).toBe('15:00');
  });

  it('finds local midnight, also across daylight saving', () => {
    const day = localDayIndex(Date.UTC(2026, 10, 9, 12), india);
    expect(startOfLocalDay(day, india)).toBe(Date.UTC(2026, 10, 8, 18, 30));
    const dstDay = localDayIndex(Date.UTC(2026, 2, 9, 12), usWithDst);
    expect(startOfLocalDay(dstDay, usWithDst)).toBe(Date.UTC(2026, 2, 9, 4));
  });
});

describe('calendar grouping', () => {
  // Now: Monday 9 Nov 2026, 10:00 in India.
  const now = Date.UTC(2026, 10, 9, 4, 30);
  const at = (days: number, hour: number, minute = 0) => Date.UTC(2026, 10, 9 + days, hour, minute) - 330 * 60_000;

  it('makes Today, Tomorrow, This week, Later and Past 7 days', () => {
    const sections = groupCalendar(
      [
        episode('a:1:1', at(0, 21)),
        episode('b:1:1', at(1, 6)),
        episode('c:1:1', at(3, 20)),
        episode('d:1:1', at(12, 20)),
        episode('e:1:1', at(-2, 20)),
        episode('f:1:1', at(-6, 20)),
        episode('old:1:1', at(-9, 20)),
        episode('far:1:1', at(45, 20)),
      ],
      now,
      india,
    );
    expect(sections.map(section => section.title)).toEqual(['Today', 'Tomorrow', 'This week', 'Later', 'Past 7 days']);
    expect(sections[0].days[0].items.map(item => item.showKey)).toEqual(['a']);
    expect(sections[2].days[0].label).toBe('Thursday 12 Nov');
    // The past runs newest first.
    expect(sections[4].days.map(day => day.items[0].showKey)).toEqual(['e', 'f']);
  });

  it('sorts a day by time and drops repeated episodes', () => {
    const sections = groupCalendar(
      [episode('late:1:1', at(0, 22)), episode('early:1:1', at(0, 8)), episode('early:1:1', at(0, 9))],
      now,
      india,
    );
    expect(sections[0].days[0].items.map(item => item.showKey)).toEqual(['early', 'late']);
    expect(sections[0].days[0].items[0].airsAt).toBe(at(0, 8));
  });

  it('uses local midnight for the day boundary', () => {
    // 23:59 today and 00:01 tomorrow, India time.
    const sections = groupCalendar([episode('x:1:1', at(0, 23, 59)), episode('y:1:1', at(1, 0, 1))], now, india);
    expect(sections.map(section => section.key)).toEqual(['today', 'tomorrow']);
  });
});
