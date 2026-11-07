/**
 * Calendar sections by local day: Today, Tomorrow, This week, Later and Past
 * 7 days. Time zones go through [offset] (minutes ahead of UTC at a moment),
 * so tests can pin one and daylight saving changes are handled per episode.
 */
import type {CalendarEpisode} from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const PAST_DAYS = 7;
export const AHEAD_DAYS = 30;

export type TimezoneOffset = (at: number) => number;

/** The device's offset from UTC at [at], in minutes (+330 for India). */
export const deviceOffset: TimezoneOffset = at => -new Date(at).getTimezoneOffset();

/** Days since 1970-01-01 in local time. */
export const localDayIndex = (at: number, offset: TimezoneOffset = deviceOffset): number =>
  Math.floor((at + offset(at) * 60_000) / DAY_MS);

/** The moment local midnight of a local day index starts. */
export const startOfLocalDay = (day: number, offset: TimezoneOffset = deviceOffset): number => {
  const guess = day * DAY_MS;
  // Two passes settle the offset across a daylight saving change.
  let at = guess - offset(guess) * 60_000;
  at = guess - offset(at) * 60_000;
  return at;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (value: number) => String(value).padStart(2, '0');

/** "Monday 9 Nov" for a local day index. */
export const dayLabel = (day: number): string => {
  const date = new Date(day * DAY_MS);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
};

/** "21:00" in local time. */
export const formatAirTime = (at: number, offset: TimezoneOffset = deviceOffset): string => {
  const date = new Date(at + offset(at) * 60_000);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

/** "S02E05" */
export const episodeCode = (season: number, episode: number): string => `S${pad(season)}E${pad(episode)}`;

export type SectionKey = 'today' | 'tomorrow' | 'week' | 'later' | 'past';

export interface CalendarDay {
  day: number;
  label: string;
  items: CalendarEpisode[];
}

export interface CalendarSection {
  key: SectionKey;
  title: string;
  days: CalendarDay[];
}

const TITLES: Record<SectionKey, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  week: 'This week',
  later: 'Later',
  past: 'Past 7 days',
};

export const sectionFor = (day: number, today: number): SectionKey | undefined => {
  const diff = day - today;
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff >= 2 && diff <= 7) return 'week';
  if (diff > 7 && diff <= AHEAD_DAYS) return 'later';
  if (diff < 0 && diff >= -PAST_DAYS) return 'past';
  return undefined;
};

/** Drops repeats of one episode, keeping the first (sources are passed best first). */
export const dedupeEpisodes = (episodes: CalendarEpisode[]): CalendarEpisode[] => {
  const seen = new Set<string>();
  return episodes.filter(episode => {
    if (seen.has(episode.id)) return false;
    seen.add(episode.id);
    return true;
  });
};

/**
 * Groups episodes into sections and days. Upcoming days run soonest first;
 * the past runs newest first.
 */
export const groupCalendar = (episodes: CalendarEpisode[], now: number, offset: TimezoneOffset = deviceOffset): CalendarSection[] => {
  const today = localDayIndex(now, offset);
  const byDay = new Map<number, CalendarEpisode[]>();
  for (const episode of dedupeEpisodes(episodes)) {
    const day = localDayIndex(episode.airsAt, offset);
    if (!sectionFor(day, today)) continue;
    const list = byDay.get(day) || [];
    list.push(episode);
    byDay.set(day, list);
  }
  const order: SectionKey[] = ['today', 'tomorrow', 'week', 'later', 'past'];
  const sections: CalendarSection[] = [];
  for (const key of order) {
    const days = [...byDay.keys()]
      .filter(day => sectionFor(day, today) === key)
      .sort((a, b) => (key === 'past' ? b - a : a - b))
      .map(day => ({
        day,
        label: dayLabel(day),
        items: (byDay.get(day) || []).sort((a, b) => a.airsAt - b.airsAt || a.showTitle.localeCompare(b.showTitle) || a.episode - b.episode),
      }));
    if (days.length) sections.push({key, title: TITLES[key], days});
  }
  return sections;
};
