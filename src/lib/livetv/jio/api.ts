/**
 * JioTV endpoints, request headers and small helpers. The sign-in, token
 * renewal, channel list and playback requests are adapted from jiotv_go
 * (https://github.com/jiotv-go/jiotv_go, CC BY 4.0) by the jiotv-go project.
 * Droid Stream is not affiliated with Jio.
 *
 * Nothing here logs: phone numbers, codes and tokens never reach the console.
 */

export const JIO_API = 'https://jiotvapi.media.jio.com';
export const URLS = {
  sendOtp: `${JIO_API}/userservice/apis/v1/loginotp/send`,
  // jiotv_go stays on v1: v2 answers with a token that still has to be exchanged.
  verifyOtp: `${JIO_API}/userservice/apis/v1/loginotp/verify`,
  refreshAccess: 'https://auth.media.jio.com/tokenservice/apis/v1/refreshtoken?langId=6',
  refreshSso: 'https://tv.media.jio.com/apis/v2.0/loginotp/refresh?langId=6',
  logout: 'https://auth.media.jio.com/tokenservice/apis/v1/logout?langId=6',
  channels: 'https://jiotvapi.cdn.jio.com/apis/v3.1/getMobileChannelList/get/?langId=6&os=android&devicetype=phone&usertype=JIO&version=315&langId=6',
  accountChannels: 'https://jiotv.data.cdn.jio.com/apis/v3.1/getMobileChannelList/get/?os=android&devicetype=phone&usertype=tvYR7NSNn7rymo3F',
  playback: `${JIO_API}/playback/apis/v1.1/geturl?langId=6`,
  logo: 'https://jiotv.catchup.cdn.jio.com/dare_images/images/',
  cdn: 'https://jiotvapi.cdn.jio.com',
};

export const UA_OKHTTP = 'okhttp/4.12.0';
/** The player user agent; some Jio CDNs refuse okhttp for media. */
export const UA_PLAYER = 'plaYtv/7.1.8 (Linux;Android 8.1.0) ExoPlayerLib/2.11.7';
/** BuildConfig.VERSION_CODE of the JioTV app jiotv_go mirrors (v7.1.8). */
export const VERSION_CODE = '422';
export const APP_KEY = 'NzNiMDhlYzQyNjJm';
export const USER_GROUP = 'tvYR7NSNn7rymo3F';
export const APP_NAME = 'RJIL_JioTV';

/** What the app keeps for a Jio sign-in, the fields jiotv_go stores. */
export interface JioCredentials {
  /** The signed-in number as +91XXXXXXXXXX, shown on the Live TV screen. */
  number: string;
  ssoToken: string;
  /** subscriberId from the sign-in answer. */
  crm: string;
  uniqueId: string;
  accessToken: string;
  refreshToken: string;
  /** Unix ms of the last access / SSO token renewal (fallback expiry when a token is no JWT). */
  accessRefreshedAt: number;
  ssoRefreshedAt: number;
}

export class JioHttpError extends Error {
  constructor(readonly status: number, readonly serverMessage = '', message?: string) {
    super(message || `JioTV answered ${status}.`);
    this.name = 'JioHttpError';
  }
}

/** The sign-in is gone (refresh rejected, or never signed in). */
export class JioAuthError extends Error {
  constructor(message = 'Sign in with your Jio number to watch JioTV channels.') {
    super(message);
    this.name = 'JioAuthError';
  }
}

/** Base64 of an ASCII string (the phone number). Hermes provides btoa and atob. */
export const base64Ascii = (text: string): string => btoa(text);

const base64UrlDecode = (part: string): string => {
  const clean = part.replace(/-/g, '+').replace(/_/g, '/');
  return atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
};

/** A JWT's exp in ms, or undefined when the token is not a readable JWT. */
export const jwtExpiry = (token: string): number | undefined => {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const exp = Number(JSON.parse(base64UrlDecode(parts[1])).exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
};

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
/** UTC YYYYMMDDTHHMMSS, the playback request's "begin". */
export const beginTime = (now = new Date()) =>
  `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
/** UTC YYYYMMDD, the playback request's "srno". */
export const srnoDate = (now = new Date()) => `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
/** Local YYMMDDHHMMmmm, the srno the license request sends. */
export const licenseSrno = (now = new Date()) =>
  `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getMilliseconds(), 3)}`;

/** Headers the JioTV app sends with account requests (jiotv_go television.New). */
export const accountHeaders = (creds: JioCredentials, deviceId: string): Record<string, string> => ({
  appkey: APP_KEY,
  crmid: creds.crm,
  userId: creds.crm,
  subscriberId: creds.crm,
  uniqueId: creds.uniqueId,
  deviceId,
  devicetype: 'phone',
  isott: 'false',
  languageId: '6',
  lbcookie: '1',
  os: 'android',
  osVersion: '13',
  usergroup: USER_GROUP,
  versionCode: VERSION_CODE,
  'User-Agent': UA_OKHTTP,
});

/** The server's own message from an error body, trimmed; never a token. */
export const readMessage = async (response: Response): Promise<string> => {
  try {
    const text = await response.text();
    try {
      const body = JSON.parse(text);
      const message = body?.message || body?.errors?.[0]?.message || body?.error?.message || body?.error;
      return typeof message === 'string' ? message.slice(0, 200) : '';
    } catch {
      return text.length < 200 && !/[{<]/.test(text) ? text.trim() : '';
    }
  } catch {
    return '';
  }
};

/** Absolute URL for a stream path the playback API returned relative. */
export const absoluteUrl = (url: string, base?: string): string => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  const first = url.split('/')[0];
  if (first.includes('.') && !url.startsWith('/')) return `https://${url}`;
  return `${base || URLS.cdn}${url.startsWith('/') ? '' : '/'}${url}`;
};
