import * as RNFS from '@dr.pogodin/react-native-fs';
import {cookieHeaderFor, cookieValue, parseNetscapeCookies, type StoredCookie} from './cookies';
import {SocialError, type SocialContext, type SocialRequest, type SocialResponse} from './types';

/** A phone browser, as the sign-in screen uses, so sites answer as they do to the browser. */
export const BROWSER_AGENT =
  'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

const TIMEOUT_MS = 25_000;

/** The cookie file the video downloader's sign-in screen writes (YtdlRuntime.cookieFile). */
export const cookieFilePath = (): string => `${RNFS.DocumentDirectoryPath}/ytdlp/cookies.txt`;

export const readStoredCookies = async (): Promise<StoredCookie[]> => {
  try {
    const path = cookieFilePath();
    if (!(await RNFS.exists(path))) return [];
    return parseNetscapeCookies(await RNFS.readFile(path, 'utf8'));
  } catch {
    return [];
  }
};

const send = async (url: string, request: SocialRequest, cookies: StoredCookie[]): Promise<SocialResponse> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const cookie = cookieHeaderFor(cookies, url);
  try {
    const response = await fetch(url, {
      method: request.method || 'GET',
      headers: {
        'User-Agent': BROWSER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        ...(cookie ? {Cookie: cookie} : {}),
        ...(request.headers || {}),
      },
      body: request.body,
      // Only the cookies from the cookie file are sent, never the app's own.
      credentials: 'omit',
      signal: controller.signal,
    });
    return {status: response.status, url: response.url || url, text: await response.text()};
  } catch (error) {
    if (controller.signal.aborted) throw new SocialError('network', 'The site took too long to answer. Try again.');
    throw new SocialError('network', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
};

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** The real context: the network, and cookies from the video downloader's sign-in. */
export const createSocialContext = async (): Promise<SocialContext> => {
  const cookies = await readStoredCookies();
  return {
    fetch: (url, request = {}) => send(url, request, cookies),
    cookie: (host, name) => cookieValue(cookies, host, name),
    cookieHeader: url => cookieHeaderFor(cookies, url),
    sleep: wait,
  };
};

/** Reads JSON, or explains why the site did not send it. */
export const parseJson = <T = unknown>(response: SocialResponse, what: string): T => {
  if (response.status === 429) throw new SocialError('rateLimit', 'The site is limiting requests. Wait a few minutes and try again.');
  if (response.status === 404) throw new SocialError('notFound', `${what} was not found. It may have been deleted.`);
  if (response.status === 401 || response.status === 403) {
    throw new SocialError('signIn', `${what} needs a sign-in.`);
  }
  try {
    return JSON.parse(response.text) as T;
  } catch {
    if (response.status >= 400) throw new SocialError('network', `${what} could not be read (error ${response.status}).`);
    throw new SocialError('signIn', `${what} could not be read. The site may want a sign-in.`);
  }
};

/** Undoes HTML escapes in attribute values. */
export const decodeHtml = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

/** Content of a meta tag such as og:image. */
export const metaContent = (html: string, property: string): string | undefined => {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`,
    'i',
  );
  const match = html.match(pattern);
  const value = match?.[1] ?? match?.[2];
  return value ? decodeHtml(value) : undefined;
};

/** JSON from <script type="application/json"> blocks, skipping the ones that do not parse. */
export const jsonScripts = (html: string): unknown[] => {
  const found: unknown[] = [];
  for (const match of html.matchAll(/<script[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      found.push(JSON.parse(match[1]));
    } catch {
      // not JSON
    }
  }
  return found;
};

/** Visits every object inside a JSON value, depth first. Stops early when the visitor returns true. */
export const walkJson = (value: unknown, visit: (node: Record<string, unknown>) => boolean | void, limit = 200_000): void => {
  const stack: unknown[] = [value];
  let steps = 0;
  while (stack.length && steps < limit) {
    steps += 1;
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index -= 1) stack.push(node[index]);
      continue;
    }
    const record = node as Record<string, unknown>;
    if (visit(record) === true) return;
    const values = Object.values(record);
    for (let index = values.length - 1; index >= 0; index -= 1) stack.push(values[index]);
  }
};

/** Extension from a file link, such as "jpg" for ".../photo.jpg?x=1". */
export const extensionOf = (url: string, fallback: string): string => {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    if (ext === 'jpeg') return 'jpg';
    if (ext && ['jpg', 'png', 'webp', 'gif', 'mp4', 'm4a', 'mov', 'heic', 'avif'].includes(ext)) return ext;
  } catch {
    // fall through
  }
  const format = url.match(/[?&]format=([a-z0-9]+)/i)?.[1]?.toLowerCase();
  return format && ['jpg', 'png', 'webp', 'gif'].includes(format) ? format : fallback;
};

export const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : undefined;

export const asNumber = (value: unknown): number | undefined => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
};

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
