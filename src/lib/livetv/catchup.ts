/**
 * Catch-up (replay of past programmes) from M3U attributes:
 *   catchup="default|append|shift|flussonic|xc" (or catchup-type),
 *   catchup-source="template", catchup-days="N" (also timeshift / tvg-rec).
 *
 * Template placeholders, all times in UTC:
 *   {utc} {start} ${start}           programme start, Unix seconds
 *   {utcend} {end} ${end}            programme end, Unix seconds
 *   {lutc} {now} {timestamp} ${now} ${timestamp}   now, Unix seconds
 *   {duration} ${duration}           length in seconds; {duration:60} in minutes
 *   {offset} ${offset}               seconds since the start; {offset:60} in minutes
 *   {Y} {m} {d} {H} {M} {S}          start date and time parts
 *   {utc:Y-m-d H:M:S}, {start:...}, {end:...}, {lutc:...}  formatted times
 *   {catchup-id}                     the programme's XMLTV catchup-id
 */
import {DAY, type GuideProgramme} from './guide';

export type CatchupMode = 'default' | 'append' | 'shift' | 'flussonic' | 'xc' | 'jio';

export interface CatchupInfo {
  mode: CatchupMode;
  source?: string;
  days: number;
}

type CatchupChannel = {url: string; attrs?: Record<string, string>};

export const MAX_CATCHUP_DAYS = 14;
const DEFAULT_DAYS = 1;

const MODES: Record<string, CatchupMode> = {
  default: 'default',
  append: 'append',
  shift: 'shift',
  timeshift: 'shift',
  flussonic: 'flussonic',
  'flussonic-hls': 'flussonic',
  'flussonic-ts': 'flussonic',
  fs: 'flussonic',
  xc: 'xc',
  jio: 'jio',
};

const PLACEHOLDER = /\$?\{(utc|start|utcend|end|lutc|now|timestamp|duration|offset|catchup-id|[YmdHMS])(?::([^}]*))?\}/g;
const hasPlaceholder = (text: string) => new RegExp(PLACEHOLDER.source).test(text);

const XC_URL = /^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(\.[a-z0-9]+)?(\?.*)?$/i;
const FLUSSONIC_HLS = /^(https?:\/\/[^/]+\/.+)\/([^/]+)\.m3u8(\?.*)?$/i;
const FLUSSONIC_TS = /^(https?:\/\/[^/]+\/.+)\/mpegts(\?.*)?$/i;

/** How a channel can replay past programmes, or undefined when it cannot. */
export const catchupInfo = (channel: CatchupChannel): CatchupInfo | undefined => {
  const attrs = channel.attrs || {};
  const daysAttr = attrs['catchup-days'] || attrs.timeshift || attrs['tvg-rec'];
  const days = Math.min(MAX_CATCHUP_DAYS, Math.max(0, Math.floor(Number(daysAttr))));
  const source = attrs['catchup-source'] || undefined;
  const raw = (attrs.catchup || attrs['catchup-type'] || '').trim().toLowerCase();
  let mode: CatchupMode | undefined = MODES[raw];
  if (!mode) {
    if (raw && raw !== 'true' && raw !== '1') return undefined;
    if (source) mode = 'default';
    else if (daysAttr || raw) mode = 'shift';
    else return undefined;
  }
  if (daysAttr !== undefined && daysAttr !== '' && !days) return undefined;
  const info: CatchupInfo = {mode, days: days || DEFAULT_DAYS, ...(source ? {source} : {})};
  if (mode === 'jio') return info;
  if (mode === 'default' && !source && !hasPlaceholder(channel.url)) return undefined;
  if (mode === 'append' && !source) return undefined;
  if (source && (mode === 'xc' || mode === 'flussonic')) return info;
  if (mode === 'xc' && !XC_URL.test(channel.url)) return undefined;
  if (mode === 'flussonic' && !FLUSSONIC_HLS.test(channel.url) && !FLUSSONIC_TS.test(channel.url)) return undefined;
  return info;
};

/** The M3U attributes catch-up reads. Saved with Favourites and Recent so replay keeps working there. */
const CATCHUP_ATTRS = ['catchup', 'catchup-type', 'catchup-source', 'catchup-days', 'timeshift', 'tvg-rec'];

/** Only the catch-up attributes of a channel, or undefined when it has none. */
export const catchupAttrsOf = (attrs?: Record<string, string>): Record<string, string> | undefined => {
  if (!attrs) return undefined;
  const kept: Record<string, string> = {};
  for (const key of CATCHUP_ATTRS) if (attrs[key] !== undefined && attrs[key] !== '') kept[key] = attrs[key];
  return Object.keys(kept).length ? kept : undefined;
};

/** Whether a programme can be replayed now: it has ended and is inside the catch-up days. */
export const canReplay = (info: CatchupInfo | undefined, programme: {start: number; stop: number}, now = Date.now()): boolean =>
  !!info && programme.stop <= now && programme.start >= now - info.days * DAY;

const pad = (n: number) => String(n).padStart(2, '0');

const formatTime = (ms: number, format: string) => {
  const d = new Date(ms);
  const parts: Record<string, string> = {
    Y: String(d.getUTCFullYear()),
    m: pad(d.getUTCMonth() + 1),
    d: pad(d.getUTCDate()),
    H: pad(d.getUTCHours()),
    M: pad(d.getUTCMinutes()),
    S: pad(d.getUTCSeconds()),
  };
  return format.replace(/[YmdHMS]/g, letter => parts[letter]);
};

export interface CatchupTimes {
  start: number;
  stop: number;
  now: number;
  catchupId?: string;
}

/** Fills a catch-up template. */
export const fillCatchupTemplate = (template: string, {start, stop, now, catchupId}: CatchupTimes): string => {
  const seconds = (ms: number) => String(Math.floor(ms / 1000));
  return template.replace(PLACEHOLDER, (whole, name: string, arg: string | undefined) => {
    switch (name) {
      case 'utc':
      case 'start':
        return arg ? formatTime(start, arg) : seconds(start);
      case 'utcend':
      case 'end':
        return arg ? formatTime(stop, arg) : seconds(stop);
      case 'lutc':
      case 'now':
      case 'timestamp':
        return arg ? formatTime(now, arg) : seconds(now);
      case 'duration':
      case 'offset': {
        const value = Math.max(0, Math.floor(((name === 'duration' ? stop : now) - start) / 1000));
        const divisor = Number(arg) > 0 ? Number(arg) : 1;
        return String(Math.floor(value / divisor));
      }
      case 'catchup-id':
        return catchupId ? encodeURIComponent(catchupId) : '';
      default:
        return arg === undefined ? formatTime(start, name) : whole;
    }
  });
};

const joinQuery = (url: string, extra: string) => {
  if (!extra) return url;
  if (extra.startsWith('?') || extra.startsWith('&')) {
    return url + (url.includes('?') ? `&${extra.slice(1)}` : `?${extra.slice(1)}`);
  }
  return url + extra;
};

/** The replay address for a past programme, or undefined when the channel cannot replay it. */
export const buildCatchupUrl = (
  channel: CatchupChannel,
  programme: Pick<GuideProgramme, 'start' | 'stop' | 'catchupId'>,
  now = Date.now(),
  info = catchupInfo(channel),
): string | undefined => {
  if (!info || info.mode === 'jio' || !canReplay(info, programme, now)) return undefined;
  const times: CatchupTimes = {start: programme.start, stop: programme.stop, now, catchupId: programme.catchupId};
  const fill = (template: string) => fillCatchupTemplate(template, times);
  const url = channel.url;
  switch (info.mode) {
    case 'default':
      return fill(info.source || url);
    case 'append':
      return joinQuery(url, fill(info.source || ''));
    case 'shift':
      return joinQuery(url, fill('?utc={utc}&lutc={lutc}'));
    case 'flussonic': {
      if (info.source) return fill(info.source);
      const hls = FLUSSONIC_HLS.exec(url);
      if (hls) {
        const [, base, name, query = ''] = hls;
        // index.m3u8 -> index-<start>-<duration>.m3u8 (also video, mono, playlist).
        return `${base}/${name}-${fill('{utc}-{duration}')}.m3u8${query}`;
      }
      const ts = FLUSSONIC_TS.exec(url);
      if (ts) return `${ts[1]}/timeshift_abs-${fill('{utc}')}.ts${ts[2] || ''}`;
      return undefined;
    }
    case 'xc': {
      if (info.source) return fill(info.source);
      const xc = XC_URL.exec(url);
      if (!xc) return undefined;
      const [, host, user, pass, id, ext = '.ts', query = ''] = xc;
      const extension = /\.m3u8$/i.test(ext) ? '.m3u8' : '.ts';
      return `${host}/timeshift/${user}/${pass}/${fill('{duration:60}')}/${fill('{Y}-{m}-{d}:{H}-{M}')}/${id}${extension}${query}`;
    }
  }
  return undefined;
};
