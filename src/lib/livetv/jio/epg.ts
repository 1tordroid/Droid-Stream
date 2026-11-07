/**
 * JioTV programme guide, adapted from jiotv_go's EPG and catch-up handlers
 * (https://github.com/jiotv-go/jiotv_go, CC BY 4.0, jiotv-go project): one
 * request per channel and day, offset 0 for today, -1 for yesterday and so on.
 * The guide is public; no sign-in data is sent.
 */
import {cleanProgrammes, type GuideProgramme} from '../guide';
import {readLiveJson, writeLiveJson} from '../store';
import {UA_OKHTTP} from './api';

export const jioEpgDayUrl = (channelId: string, offset: number) =>
  `https://jiotvapi.cdn.jio.com/apis/v1.3/getepg/get?offset=${offset}&channel_id=${encodeURIComponent(channelId)}&langId=6`;

/** Epochs below this are seconds, not ms (jiotv_go's epochThreshold). */
const EPOCH_MS_THRESHOLD = 100_000_000_000;
const DAY_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_DESC = 240;

interface RawEpg {
  showname?: string;
  description?: string;
  startEpoch?: number | string;
  endEpoch?: number | string;
  srno?: number | string;
}

const epochMs = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return n < EPOCH_MS_THRESHOLD ? n * 1000 : n;
};

/** Programmes from one getepg answer. */
export const parseJioEpg = (body: unknown): GuideProgramme[] => {
  const list = (body as {epg?: RawEpg[]})?.epg;
  if (!Array.isArray(list)) return [];
  const out: GuideProgramme[] = [];
  for (const item of list) {
    const start = epochMs(item?.startEpoch);
    const stop = epochMs(item?.endEpoch);
    const title = String(item?.showname || '').trim();
    if (!title || !Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) continue;
    const programme: GuideProgramme = {start, stop, title};
    const desc = String(item.description || '').trim();
    if (desc) programme.desc = desc.length > MAX_DESC ? `${desc.slice(0, MAX_DESC - 1).trimEnd()}…` : desc;
    if (item.srno !== undefined && item.srno !== null && item.srno !== '') {
      programme.srno = typeof item.srno === 'number' ? item.srno.toFixed(0) : String(item.srno);
    }
    out.push(programme);
  }
  return out;
};

interface CachedDay {
  fetchedAt: number;
  programmes: GuideProgramme[];
}

/** Guide days per channel, by India-time day number, in one stored entry per channel. */
type ChannelDays = Record<string, CachedDay>;
const memory = new Map<string, ChannelDays>();
const KEEP_DAYS = 8;

const istDay = (now = Date.now()) => Math.floor((now + 5.5 * 60 * 60 * 1000) / 86_400_000);
/** Guide day offset (0 today, -1 yesterday) of a time, in India time like the API. */
export const jioDayOffset = (time: number, now = Date.now()) => istDay(time) - istDay(now);
const storeKey = (channelId: string) => `jioepg:${channelId}`;

const channelDays = (channelId: string): ChannelDays => {
  let days = memory.get(channelId);
  if (!days) {
    days = readLiveJson<ChannelDays>(storeKey(channelId)) || {};
    memory.set(channelId, days);
  }
  return days;
};

const fetchDay = async (channelId: string, offset: number, fetcher: typeof fetch): Promise<GuideProgramme[]> => {
  const now = Date.now();
  // Offsets move at midnight India time, the guide's own day.
  const today = istDay(now);
  const day = String(today + offset);
  const days = channelDays(channelId);
  const cached = days[day];
  // Past days do not change; today and later are refreshed every few hours.
  if (cached && (offset < 0 || now - cached.fetchedAt < DAY_MAX_AGE_MS)) return cached.programmes;
  try {
    const response = await fetcher(jioEpgDayUrl(channelId, offset), {headers: {'User-Agent': UA_OKHTTP, Accept: 'application/json'}});
    if (!response.ok) return cached?.programmes || [];
    const programmes = parseJioEpg(await response.json());
    days[day] = {fetchedAt: now, programmes};
    for (const key of Object.keys(days)) if (Number(key) < today - KEEP_DAYS) delete days[key];
    writeLiveJson(storeKey(channelId), days);
    return programmes;
  } catch {
    return cached?.programmes || [];
  }
};

// A few requests at a time: the guide asks for every row that comes on screen.
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting: (() => void)[] = [];
const limited = async <T>(task: () => Promise<T>): Promise<T> => {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>(resolve => waiting.push(resolve));
  inFlight++;
  try {
    return await task();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
};

/** Programmes for one JioTV channel over the given day offsets, sorted. */
export const loadJioProgrammes = async (
  channelId: string,
  offsets: number[] = [-1, 0, 1],
  fetcher: typeof fetch = fetch,
): Promise<GuideProgramme[]> => {
  const days = await Promise.all(offsets.map(offset => limited(() => fetchDay(channelId, offset, fetcher))));
  return cleanProgrammes(days.flat());
};
