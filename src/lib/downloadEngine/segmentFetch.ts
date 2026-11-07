/**
 * Fetches media segments (DASH, live HLS) into files through the app's OkHttp
 * client, so DNS over HTTPS, WARP and ByeDPI apply. A finished file only
 * appears under its final name, so a stopped download never reuses half a file.
 */
import * as RNFS from '@dr.pogodin/react-native-fs';
import {canFetchSegments, httpNative} from './native';

export class SegmentHttpError extends Error {
  constructor(readonly status: number) {
    super(`Segment download failed with HTTP status ${status}`);
    this.name = 'SegmentHttpError';
  }
}

export class SegmentStoppedError extends Error {
  constructor() {
    super('Download stopped');
    this.name = 'SegmentStoppedError';
  }
}

export const fileSize = async (path: string): Promise<number> => {
  try {
    return Number((await RNFS.stat(path)).size) || 0;
  } catch {
    return 0;
  }
};

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export const withUserAgent = (headers?: Record<string, string>): Record<string, string> =>
  Object.keys(headers || {}).some(key => key.toLowerCase() === 'user-agent')
    ? {...headers}
    : {'User-Agent': DEFAULT_USER_AGENT, ...(headers || {})};

/** Inclusive "start-end" as a byte count. */
const rangeLength = (range: string): number => {
  const [start, end] = range.split('-').map(Number);
  return end - start + 1;
};

/** Downloads one segment to [path]. A byte range must come back at exactly its length. */
export const fetchSegment = async (
  tag: string,
  url: string,
  path: string,
  headers: Record<string, string>,
  range?: string,
): Promise<number> => {
  if (!canFetchSegments()) throw new Error('This app version cannot download segments. Update the app.');
  const partial = `${path}.part`;
  const requestHeaders = withUserAgent(headers);
  if (range) requestHeaders.Range = `bytes=${range}`;
  const {statusCode} = await httpNative!.fetchToFile(tag, url, partial, requestHeaders);
  if (statusCode < 200 || statusCode >= 300) throw new SegmentHttpError(statusCode);
  const size = await fileSize(partial);
  if (size <= 0) {
    await RNFS.unlink(partial).catch(() => undefined);
    throw new Error('A downloaded segment is empty');
  }
  if (range && (statusCode !== 206 || size !== rangeLength(range))) {
    await RNFS.unlink(partial).catch(() => undefined);
    throw new Error('The server ignored the byte range of a segment');
  }
  if (await RNFS.exists(path)) await RNFS.unlink(path).catch(() => undefined);
  await RNFS.moveFile(partial, path);
  return size;
};

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 1000;
const MAX_RETRY_MS = 16_000;

export const isRateLimit = (error: unknown): boolean =>
  error instanceof SegmentHttpError && (error.status === 429 || error.status === 503);

export const isPermanentHttpError = (error: unknown): boolean =>
  error instanceof SegmentHttpError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;

/**
 * fetchSegment with retries and backoff. [sleep] must wake early when the
 * download stops; [stopped] throws when it has.
 */
export const fetchSegmentWithRetry = async (
  options: {
    tag: string;
    url: string;
    path: string;
    headers: Record<string, string>;
    range?: string;
    attempts?: number;
    checkRunning: () => void;
    sleep: (ms: number) => Promise<void>;
    onRateLimit?: () => void;
  },
): Promise<number> => {
  const attempts = options.attempts ?? MAX_ATTEMPTS;
  for (let attempt = 1; ; attempt++) {
    options.checkRunning();
    try {
      return await fetchSegment(options.tag, options.url, options.path, options.headers, options.range);
    } catch (error) {
      options.checkRunning();
      if (isPermanentHttpError(error) || attempt >= attempts) throw error;
      if (isRateLimit(error)) options.onRateLimit?.();
      await options.sleep(Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), MAX_RETRY_MS));
    }
  }
};

/** Sleeps that a stop can cut short, per download. */
export const createWaker = () => {
  const waits = new Map<string, Set<() => void>>();
  return {
    sleep: (id: string, ms: number) =>
      new Promise<void>(resolve => {
        const set = waits.get(id) || new Set<() => void>();
        waits.set(id, set);
        const finish = () => {
          clearTimeout(timer);
          set.delete(finish);
          resolve();
        };
        const timer = setTimeout(finish, ms);
        set.add(finish);
      }),
    wake: (id: string) => {
      for (const finish of [...(waits.get(id) || [])]) finish();
    },
    clear: (id: string) => waits.delete(id),
  };
};

export const writeJson = async (path: string, value: unknown): Promise<void> => {
  await RNFS.writeFile(`${path}.tmp`, JSON.stringify(value), 'utf8');
  if (await RNFS.exists(path)) await RNFS.unlink(path).catch(() => undefined);
  await RNFS.moveFile(`${path}.tmp`, path);
};

export const readJson = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await RNFS.readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

export const resetDirectory = async (directory: string): Promise<void> => {
  if (await RNFS.exists(directory)) await RNFS.unlink(directory);
  await RNFS.mkdir(directory);
};

export const ensureDirectory = async (directory: string): Promise<void> => {
  if (!(await RNFS.exists(directory))) await RNFS.mkdir(directory);
};

/** Moves a finished file into place, copying when a move across storage fails. */
export const moveIntoPlace = async (source: string, target: string): Promise<void> => {
  if (await RNFS.exists(target)) await RNFS.unlink(target).catch(() => undefined);
  try {
    await RNFS.moveFile(source, target);
  } catch {
    await RNFS.unlink(target).catch(() => undefined);
    await RNFS.copyFile(source, target);
    await RNFS.unlink(source).catch(() => undefined);
  }
};
