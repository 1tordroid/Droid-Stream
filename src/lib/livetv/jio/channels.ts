/**
 * JioTV channel list and per-channel playback, adapted from jiotv_go's
 * television package and DRM handlers (CC BY 4.0, jiotv-go project).
 *
 * Plain channels play as HLS with the headers and __hdnea__ cookie the JioTV
 * app sends. Widevine channels play as DASH through react-native-video's
 * standard drm source (licence server and headers as JioTV issues them);
 * nothing here removes or works around the protection.
 */
import type {Drm} from 'react-native-video';
import type {LiveChannel} from '../m3u';
import {
  APP_KEY,
  APP_NAME,
  JioHttpError,
  UA_OKHTTP,
  UA_PLAYER,
  URLS,
  USER_GROUP,
  VERSION_CODE,
  absoluteUrl,
  accountHeaders,
  beginTime,
  licenseSrno,
  readMessage,
  srnoDate,
  type JioCredentials,
} from './api';
import {jioCache, jioDeviceId, withJioSession} from './session';

export const JIO_SOURCE_ID = 'jio';
/** Grid / favourites placeholder; the real, short-lived address is fetched at play time. */
export const jioChannelUrl = (id: string) => `jiotv:${id}`;
export const jioChannelId = (url: string): string | undefined => /^jiotv:(\w+)$/.exec(url)?.[1];

export const JIO_CHANNELS_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** jiotv_go lists catch-up up to seven days back. */
export const JIO_CATCHUP_DAYS = 7;

const CATEGORIES: Record<number, string> = {
  5: 'Entertainment', 6: 'Movies', 7: 'Kids', 8: 'Sports', 9: 'Lifestyle', 10: 'Infotainment', 12: 'News',
  13: 'Music', 15: 'Devotional', 16: 'Business', 17: 'Educational', 18: 'Shopping', 19: 'JioDarshan',
};
const LANGUAGES: Record<number, string> = {
  1: 'Hindi', 2: 'Marathi', 3: 'Punjabi', 4: 'Urdu', 5: 'Bengali', 6: 'English', 7: 'Malayalam', 8: 'Tamil',
  9: 'Gujarati', 10: 'Odia', 11: 'Telugu', 12: 'Bhojpuri', 13: 'Kannada', 14: 'Assamese', 15: 'Nepali', 16: 'French',
};

interface RawChannel {
  channel_id?: number | string;
  channel_name?: string;
  logoUrl?: string;
  channelCategoryId?: number;
  channelLanguageId?: number;
  isHD?: boolean;
  business_type?: string;
  isCatchupAvailable?: boolean;
}

/** A JioTV channel in the shape the Live TV grid uses. */
export const toLiveChannel = (raw: RawChannel): LiveChannel | undefined => {
  const id = raw.channel_id !== undefined ? String(raw.channel_id) : '';
  if (!/^\w+$/.test(id) || !raw.channel_name) return undefined;
  const language = LANGUAGES[raw.channelLanguageId ?? -1];
  const logo = raw.logoUrl ? (/^https?:/i.test(raw.logoUrl) ? raw.logoUrl : URLS.logo + raw.logoUrl) : undefined;
  return {
    id,
    name: raw.channel_name,
    url: jioChannelUrl(id),
    logo,
    group: CATEGORIES[raw.channelCategoryId ?? -1] || 'Other',
    // Search matches tvgName too, so "tamil" finds Tamil channels.
    tvgName: language,
    attrs: {
      ...(language ? {language} : {}),
      ...(raw.isHD ? {hd: 'true'} : {}),
      // jiotv_go: business_type "premium" needs a separate subscription.
      ...(String(raw.business_type || '').trim().toLowerCase() === 'premium' ? {premium: 'true'} : {}),
      // jiotv_go: channels without isCatchupAvailable refuse every catch-up request.
      ...(raw.isCatchupAvailable ? {catchup: 'jio', 'catchup-days': String(JIO_CATCHUP_DAYS)} : {}),
    },
  };
};

const listHeaders = (creds?: JioCredentials): Record<string, string> => ({
  'User-Agent': UA_OKHTTP,
  Accept: 'application/json',
  devicetype: 'phone',
  os: 'android',
  appkey: APP_KEY,
  lbcookie: '1',
  usertype: 'JIO',
  ...(creds
    ? {
        versionCode: VERSION_CODE,
        usergroup: USER_GROUP,
        languageId: '6',
        isott: 'false',
        accessToken: creds.accessToken,
        ssotoken: creds.ssoToken,
        crmid: creds.crm,
        subscriberId: creds.crm,
        userId: creds.crm,
        uniqueId: creds.uniqueId,
      }
    : {}),
});

const fetchList = async (url: string, headers: Record<string, string>): Promise<RawChannel[]> => {
  let response: Response;
  try {
    response = await fetch(url, {headers});
  } catch {
    throw new Error('Could not reach JioTV. Check your connection and try again.');
  }
  if (!response.ok) throw new JioHttpError(response.status, await readMessage(response));
  const body = (await response.json()) as {result?: RawChannel[]};
  return Array.isArray(body?.result) ? body.result : [];
};

interface CachedList {
  fetchedAt: number;
  channels: LiveChannel[];
}

const readCache = (): CachedList | undefined => {
  try {
    const raw = jioCache.read();
    return raw ? (JSON.parse(raw) as CachedList) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The account's channel list merged with the public one (each lists channels
 * the other misses), cached for 12 hours in the encrypted Jio store.
 */
export const loadJioChannels = async ({force = false}: {force?: boolean} = {}): Promise<LiveChannel[]> => {
  const cached = readCache();
  if (cached && !force && Date.now() - cached.fetchedAt < JIO_CHANNELS_MAX_AGE_MS) return cached.channels;
  try {
    const account = await withJioSession(creds => fetchList(URLS.accountChannels, listHeaders(creds))).catch(error => {
      if (error?.name === 'JioAuthError') throw error;
      return [] as RawChannel[];
    });
    const publicList = await fetchList(URLS.channels, listHeaders()).catch(error => {
      if (!account.length) throw error;
      return [] as RawChannel[];
    });
    const seen = new Set<string>();
    const channels: LiveChannel[] = [];
    for (const raw of [...account, ...publicList]) {
      const channel = toLiveChannel(raw);
      if (!channel || seen.has(channel.id)) continue;
      seen.add(channel.id);
      channels.push(channel);
    }
    if (!channels.length) throw new Error('JioTV sent no channels. Try again later.');
    jioCache.write(JSON.stringify({fetchedAt: Date.now(), channels}));
    return channels;
  } catch (error) {
    if (cached && (error as Error)?.name !== 'JioAuthError') return cached.channels;
    throw error;
  }
};

// ---- Playback ----

export type JioQuality = 'auto' | 'high' | 'medium' | 'low';

interface Bitrates {
  auto?: string;
  high?: string;
  medium?: string;
  low?: string;
}
interface PlaybackAnswer {
  code?: number;
  message?: string;
  result?: string;
  bitrates?: Bitrates;
  mpd?: Bitrates & {result?: string; key?: string; bitrates?: Bitrates};
  keyUrl?: string;
  isDRM?: boolean;
}

export interface JioStream {
  url: string;
  type: 'm3u8' | 'mpd';
  headers: Record<string, string>;
  drm?: Drm;
}

const pick = (bitrates: Bitrates | undefined, quality: JioQuality): string =>
  (bitrates && (bitrates[quality] || bitrates.high || bitrates.auto || bitrates.medium || bitrates.low)) || '';

const hdneaOf = (url: string): string => {
  const match = /[?&](?:__hdnea__|hdnea)=([^&]+)/.exec(url);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

const withHdnea = (url: string, hdnea: string) =>
  !hdnea || /[?&](?:__hdnea__|hdnea)=/.test(url) ? url : `${url}${url.includes('?') ? '&' : '?'}hdnea=${hdnea}`;

/** Cookie pairs from a (possibly comma-joined) Set-Cookie header. */
export const cookiePairs = (setCookie: string | null): string[] =>
  (setCookie || '')
    .split(/,\s*(?=[A-Za-z0-9_-]+=)/)
    .map(part => part.split(';')[0].trim())
    .filter(pair => /^[^=\s]+=/.test(pair));

const friendlyPlaybackError = (status: number, message: string): string => {
  if (/eligible|subscri|plan/i.test(message)) return 'This channel needs a separate JioTV subscription on your Jio account.';
  if (/region|location|country|geo/i.test(message)) return 'JioTV plays only in India, on a Jio connection or a Jio account.';
  if (status === 429) return 'JioTV is limiting requests. Wait a moment, then try again.';
  return 'JioTV did not return a stream for this channel. Try again, or pick another channel.';
};

/** A past programme to replay: Unix ms times and the guide's srno. */
export interface JioCatchup {
  start: number;
  stop: number;
  srno: string;
}

const form = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

/** Playback request body: live ("Seek") or, as jiotv_go's GetCatchupURL sends it, catch-up. */
export const playbackBody = (channelId: string, catchup?: JioCatchup, now = new Date()): string =>
  catchup
    ? form({
        stream_type: 'Catchup',
        channel_id: channelId,
        programId: catchup.srno,
        showtime: '000000',
        srno: catchup.srno,
        begin: beginTime(new Date(catchup.start)),
        end: beginTime(new Date(catchup.stop)),
      })
    : `channel_id=${encodeURIComponent(channelId)}&stream_type=Seek&begin=${beginTime(now)}&srno=${srnoDate(now)}`;

const requestPlayback = async (channelId: string, creds: JioCredentials, catchup?: JioCatchup): Promise<PlaybackAnswer> => {
  const body = playbackBody(channelId, catchup);
  let response: Response;
  try {
    response = await fetch(URLS.playback, {
      method: 'POST',
      headers: {
        ...accountHeaders(creds, jioDeviceId()),
        'Content-Type': 'application/x-www-form-urlencoded',
        channel_id: channelId,
        accessToken: creds.accessToken,
        ...(catchup ? {srno: catchup.srno} : {}),
      },
      body,
    });
  } catch {
    throw new Error('Could not reach JioTV. Check your connection and try again.');
  }
  if (!response.ok) {
    const message = await readMessage(response);
    if (response.status === 401 || response.status === 419) throw new JioHttpError(response.status, message);
    throw new JioHttpError(response.status, message, friendlyPlaybackError(response.status, message));
  }
  return (await response.json()) as PlaybackAnswer;
};

/** Cookies the CDN sets on the manifest, which jiotv_go forwards to the licence server. */
const manifestCookies = async (url: string, hdnea: string): Promise<string> => {
  const fallback = hdnea ? `__hdnea__=${hdnea}` : '';
  try {
    const response = await fetch(url, {method: 'HEAD', headers: {'User-Agent': UA_PLAYER, ...(fallback ? {Cookie: fallback} : {})}});
    const pairs = cookiePairs(response.headers.get('set-cookie'));
    if (fallback && !pairs.some(pair => pair.startsWith('__hdnea__='))) pairs.push(fallback);
    return pairs.join('; ') || fallback;
  } catch {
    return fallback;
  }
};

/** Builds the playable stream from a playback answer. */
export const buildJioStream = async (channelId: string, answer: PlaybackAnswer, creds: JioCredentials, quality: JioQuality = 'auto'): Promise<JioStream> => {
  const mpdBitrates: Bitrates = {
    auto: answer.mpd?.bitrates?.auto || answer.mpd?.auto,
    high: answer.mpd?.bitrates?.high || answer.mpd?.high,
    medium: answer.mpd?.bitrates?.medium || answer.mpd?.medium,
    low: answer.mpd?.bitrates?.low || answer.mpd?.low,
  };
  const hls = pick(answer.bitrates, quality) || (/\.m3u8/i.test(answer.result || '') ? answer.result! : '') || (/\.m3u8/i.test(answer.mpd?.result || '') ? answer.mpd!.result! : '');
  const mpd = pick(mpdBitrates, quality) || (answer.mpd?.result && !/\.m3u8/i.test(answer.mpd.result) ? answer.mpd.result : '');
  const license = (answer.keyUrl || answer.mpd?.key || '').trim();
  const any = [hls, mpd, answer.result || ''].find(url => /^https?:\/\//i.test(url));
  const base = any ? /^(https?:\/\/[^/]+)/i.exec(any)?.[1] : undefined;
  const hdnea = [answer.bitrates?.auto, answer.result, hls, mpd, answer.mpd?.result].map(url => hdneaOf(url || '')).find(Boolean) || '';
  const deviceId = jioDeviceId();

  // Widevine: DASH manifest plus a licence URL.
  if (mpd && license) {
    const url = absoluteUrl(mpd, base);
    const cookie = await manifestCookies(url, hdnea);
    return {
      url,
      type: 'mpd',
      headers: {'User-Agent': UA_PLAYER, ...(hdnea ? {Cookie: `__hdnea__=${hdnea}`} : {})},
      drm: {
        type: 'widevine' as Drm['type'],
        licenseServer: absoluteUrl(withHdnea(license, hdnea), base),
        headers: {
          accesstoken: creds.accessToken,
          os: 'android',
          appName: APP_NAME,
          subscriberId: creds.crm,
          'User-Agent': UA_PLAYER,
          ssotoken: creds.ssoToken,
          'x-platform': 'android',
          srno: licenseSrno(),
          crmid: creds.crm,
          channelid: channelId,
          uniqueId: creds.uniqueId,
          versionCode: VERSION_CODE,
          usergroup: USER_GROUP,
          devicetype: 'phone',
          osVersion: '13',
          deviceId,
          'Content-Type': 'application/octet-stream',
          ...(cookie ? {Cookie: cookie} : {}),
        },
      },
    };
  }

  if (!hls) throw new JioHttpError(404, answer.message || '', friendlyPlaybackError(404, answer.message || ''));
  // HLS: manifest, segments and AES keys all go through the player with the
  // headers jiotv_go sends for each (render, key and TS handlers).
  return {
    url: withHdnea(absoluteUrl(hls, base), hdnea),
    type: 'm3u8',
    headers: {
      ...accountHeaders(creds, deviceId),
      channel_id: channelId,
      channelId,
      srno: '230203144000',
      ssotoken: creds.ssoToken,
      'User-Agent': UA_PLAYER,
      ...(hdnea ? {Cookie: `__hdnea__=${hdnea}`} : {}),
    },
  };
};

/** A fresh, playable stream for one channel (addresses expire, so fetch it at play time). */
export const getJioStream = (channelId: string, quality: JioQuality = 'auto'): Promise<JioStream> =>
  withJioSession(async creds => buildJioStream(channelId, await requestPlayback(channelId, creds), creds, quality));

/** A replay stream for a past programme on a channel with catch-up. */
export const getJioCatchupStream = (channelId: string, catchup: JioCatchup, quality: JioQuality = 'auto'): Promise<JioStream> =>
  withJioSession(async creds => buildJioStream(channelId, await requestPlayback(channelId, creds, catchup), creds, quality));
