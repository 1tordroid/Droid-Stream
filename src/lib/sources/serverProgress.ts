/**
 * Watch progress sent back to the viewer's Jellyfin, Emby and Plex servers,
 * so their own apps continue where Droid Stream stopped, and read from them,
 * so Droid Stream continues where another app stopped.
 *
 * While an item from a saved server plays, the server hears when playback
 * starts, every 10 seconds, on pause and resume, and when it stops. At 90%
 * the item is marked played. A stop that cannot be sent (offline, server
 * down) is queued and sent later; the token is read from the encrypted
 * source vault at that time, so the queue holds no sign-in.
 *
 * Jellyfin and Emby: /Sessions/Playing, /Sessions/Playing/Progress and
 * /Sessions/Playing/Stopped with positions in ticks (10,000,000 a second).
 * Plex: /:/timeline with milliseconds, and /:/scrobble to mark played.
 * Written from the servers' public APIs.
 */
import {findEmbyItem, findJellyfinItem, findPlexItem} from '../playback/skipSources';
import {mainStorage} from '../storage/StorageService';
import {deviceHeader, LEGACY_DEVICE_ID} from './mediaServers';
import {plexHeaders} from './plexLink';
import {getInstallId, listSources, type SavedSource} from './vault';

export const TICKS_PER_SECOND = 10_000_000;
/** How often the position is reported while an item plays or is paused. */
export const REPORT_INTERVAL_MS = 10_000;
/** The item is marked played from this much of its length. */
export const PLAYED_PERCENT = 90;
/** A report due within this much of the interval goes out now, so timer drift does not skip a beat. */
const INTERVAL_SLACK_MS = 1000;
const REQUEST_TIMEOUT_MS = 10_000;
/** How long opening an item waits for the server's resume position. */
export const RESUME_LOOKUP_MS = 3000;

const SETTING_KEY = 'server-progress-sync';
const QUEUE_KEY = 'server-progress-queue';
const MAX_QUEUE = 50;
const MAX_ATTEMPTS = 10;
const MINUTE_MS = 60 * 1000;
const MAX_BACKOFF_MS = 6 * 60 * MINUTE_MS;
const MAX_AGE_MS = 30 * 24 * 60 * MINUTE_MS;

/** "Sync progress with my servers", on unless turned off. */
export const isServerProgressSyncEnabled = (): boolean => mainStorage.getBool(SETTING_KEY, true);
export const setServerProgressSyncEnabled = (value: boolean): void => {
  mainStorage.setBool(SETTING_KEY, value);
};

export const secondsToTicks = (seconds: number): number => (Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * TICKS_PER_SECOND) : 0);
export const ticksToSeconds = (ticks: unknown): number => (typeof ticks === 'number' && Number.isFinite(ticks) && ticks > 0 ? ticks / TICKS_PER_SECOND : 0);

export type ServerKind = 'jellyfin' | 'emby' | 'plex';

/** A saved server and the item on it. For Plex, itemId is the ratingKey. */
export interface ServerItem {
  kind: ServerKind;
  source: SavedSource;
  itemId: string;
}

/** The saved server item behind what is playing, from its stream addresses. */
export const findServerItem = (urls: (string | undefined)[], sources: SavedSource[] = listSources()): ServerItem | undefined => {
  const jellyfin = findJellyfinItem(urls, sources);
  if (jellyfin) return {kind: 'jellyfin', source: jellyfin.source, itemId: jellyfin.itemId};
  const emby = findEmbyItem(urls, sources);
  if (emby) return {kind: 'emby', source: emby.source, itemId: emby.itemId};
  const plex = findPlexItem(urls, sources);
  return plex ? {kind: 'plex', source: plex.source, itemId: plex.ratingKey} : undefined;
};

export const serverItemKey = (item: ServerItem): string => `${item.source.id}:${item.itemId}`;

/** The server answered with an error status. */
export class ServerReportError extends Error {
  constructor(readonly status: number) {
    super(`The server answered ${status}`);
    this.name = 'ServerReportError';
  }
}

export type ReportKind = 'start' | 'progress' | 'stop';
export type ReportEvent = 'TimeUpdate' | 'Pause' | 'Unpause';

export interface ProgressReport {
  kind: ReportKind;
  positionSeconds: number;
  durationSeconds: number;
  paused: boolean;
  event?: ReportEvent;
  playSessionId: string;
}

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

const rootOf = (server: string) => server.replace(/\/+$/, '');
const mediaBrowserHeaders = (source: SavedSource) => deviceHeader(source.deviceId || LEGACY_DEVICE_ID, source.secret);
const plexRequestHeaders = (source: SavedSource) => ({
  ...plexHeaders(source.deviceId || getInstallId(), source.secret),
  'X-Plex-Platform': 'Android',
  'X-Plex-Device-Name': 'Droid Stream',
});

const MEDIA_BROWSER_PATHS: Record<ReportKind, string> = {
  start: '/Sessions/Playing',
  progress: '/Sessions/Playing/Progress',
  stop: '/Sessions/Playing/Stopped',
};

/** The request that tells the server about one moment of playback. */
export const progressRequest = (item: ServerItem, report: ProgressReport): HttpRequest => {
  const root = rootOf(item.source.server);
  if (item.kind === 'plex') {
    const state = report.kind === 'stop' ? 'stopped' : report.paused ? 'paused' : 'playing';
    const query = new URLSearchParams({
      ratingKey: item.itemId,
      key: `/library/metadata/${item.itemId}`,
      state,
      time: String(Math.max(0, Math.round(report.positionSeconds * 1000))),
      duration: String(Math.max(0, Math.round(report.durationSeconds * 1000))),
    });
    return {url: `${root}/:/timeline?${query}`, method: 'GET', headers: plexRequestHeaders(item.source)};
  }
  const body: Record<string, unknown> = {
    ItemId: item.itemId,
    PositionTicks: secondsToTicks(report.positionSeconds),
    PlaySessionId: report.playSessionId,
  };
  if (report.kind !== 'stop') {
    body.IsPaused = report.paused;
    body.CanSeek = true;
    body.PlayMethod = 'DirectStream';
    if (report.kind === 'progress') body.EventName = report.event || 'TimeUpdate';
  }
  return {url: `${root}${MEDIA_BROWSER_PATHS[report.kind]}`, method: 'POST', headers: mediaBrowserHeaders(item.source), body: JSON.stringify(body)};
};

/**
 * The requests that mark the item played, tried in order until one works.
 * Jellyfin 10.9 moved the address; older Jellyfin and Emby use the user path.
 */
export const playedRequests = (item: ServerItem): HttpRequest[] => {
  const root = rootOf(item.source.server);
  if (item.kind === 'plex') {
    const query = new URLSearchParams({key: item.itemId, identifier: 'com.plexapp.plugins.library'});
    return [{url: `${root}/:/scrobble?${query}`, method: 'GET', headers: plexRequestHeaders(item.source)}];
  }
  const headers = mediaBrowserHeaders(item.source);
  const id = encodeURIComponent(item.itemId);
  const user = encodeURIComponent(item.source.username);
  const legacy: HttpRequest = {url: `${root}/Users/${user}/PlayedItems/${id}`, method: 'POST', headers};
  if (item.kind === 'emby') return [legacy];
  return [{url: `${root}/UserPlayedItems/${id}?userId=${user}`, method: 'POST', headers}, legacy];
};

/** Sends one request; throws ServerReportError for an error status. */
export const sendRequest = async (request: HttpRequest): Promise<void> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, {method: request.method, headers: request.headers, body: request.body, signal: controller.signal});
    if (!response.ok) throw new ServerReportError(response.status);
  } finally {
    clearTimeout(timer);
  }
};

export interface ProgressTransport {
  report: (item: ServerItem, report: ProgressReport) => Promise<void>;
  markPlayed: (item: ServerItem) => Promise<void>;
}

export const httpTransport: ProgressTransport = {
  report: (item, report) => sendRequest(progressRequest(item, report)),
  markPlayed: async item => {
    const [first, ...rest] = playedRequests(item);
    try {
      await sendRequest(first);
    } catch (error) {
      // Only an address the server does not have moves on to the older one.
      const missing = error instanceof ServerReportError && (error.status === 404 || error.status === 405);
      if (!missing || !rest.length) throw error;
      await sendRequest(rest[0]);
    }
  },
};

/** True when sending the same request later may work: offline, timeouts, server trouble, sign-in trouble. */
export const isRetryable = (error: unknown): boolean => {
  if (!(error instanceof ServerReportError)) return true;
  const {status} = error;
  return status >= 500 || status === 401 || status === 403 || status === 408 || status === 429;
};

export const newPlaySessionId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

// ---------------------------------------------------------------- offline queue

export interface QueuedServerStop {
  key: string;
  sourceId: string;
  kind: ServerKind;
  itemId: string;
  positionSeconds: number;
  durationSeconds: number;
  /** Mark the item played too. */
  played: boolean;
  attempts: number;
  /** Not sent again before this time (ms since epoch). */
  nextAt: number;
  queuedAt: number;
}

export const readServerProgressQueue = (): QueuedServerStop[] => {
  const saved = mainStorage.getObject<QueuedServerStop[]>(QUEUE_KEY);
  return Array.isArray(saved) ? saved : [];
};

const writeQueue = (queue: QueuedServerStop[]) => mainStorage.setObject(QUEUE_KEY, queue);

/** Keeps the newest stop per item, at most MAX_QUEUE of them. */
export const enqueueServerStop = (
  item: ServerItem,
  stop: {positionSeconds: number; durationSeconds: number; played: boolean},
  now = Date.now(),
): void => {
  const key = serverItemKey(item);
  const queue = readServerProgressQueue().filter(entry => entry.key !== key);
  queue.push({key, sourceId: item.source.id, kind: item.kind, itemId: item.itemId, ...stop, attempts: 0, nextAt: now, queuedAt: now});
  writeQueue(queue.slice(-MAX_QUEUE));
};

const dropQueued = (key: string) => {
  const queue = readServerProgressQueue();
  const rest = queue.filter(entry => entry.key !== key);
  if (rest.length !== queue.length) writeQueue(rest);
};

const replaceEntry = (entry: QueuedServerStop, next?: QueuedServerStop) =>
  writeQueue(
    readServerProgressQueue().flatMap(item => (item.key === entry.key && item.queuedAt === entry.queuedAt ? (next ? [next] : []) : [item])),
  );

/** Sends a stop, then marks played when asked. */
const deliverStop = async (item: ServerItem, stop: {positionSeconds: number; durationSeconds: number; played: boolean}, transport: ProgressTransport) => {
  await transport.report(item, {kind: 'stop', positionSeconds: stop.positionSeconds, durationSeconds: stop.durationSeconds, paused: true, playSessionId: newPlaySessionId()});
  if (stop.played) await transport.markPlayed(item);
};

let flushing: Promise<number> | undefined;

/**
 * Sends the queued stops that are due, oldest first. A stop whose source was
 * removed is dropped; one whose source is signed out waits for a new sign-in.
 * Returns how many are still queued. Runs one at a time.
 */
export const flushServerProgressQueue = (
  now = Date.now(),
  transport: ProgressTransport = httpTransport,
  sources: () => SavedSource[] = listSources,
): Promise<number> => {
  if (!flushing) {
    flushing = flushNow(now, transport, sources).finally(() => {
      flushing = undefined;
    });
  }
  return flushing;
};

const flushNow = async (now: number, transport: ProgressTransport, sources: () => SavedSource[]): Promise<number> => {
  const fresh = readServerProgressQueue().filter(entry => now - entry.queuedAt < MAX_AGE_MS);
  writeQueue(fresh);
  if (!fresh.length || !isServerProgressSyncEnabled()) return fresh.length;
  const saved = sources();
  for (const entry of fresh) {
    if (entry.nextAt > now) continue;
    // A newer stop for the same item may have replaced this one meanwhile.
    const current = readServerProgressQueue().find(item => item.key === entry.key);
    if (!current || current.queuedAt !== entry.queuedAt) continue;
    const source = saved.find(item => item.id === entry.sourceId);
    if (!source || source.kind !== entry.kind) {
      replaceEntry(entry);
      continue;
    }
    if (source.authState === 'signedOut' || !source.secret) continue;
    try {
      await deliverStop({kind: entry.kind, source, itemId: entry.itemId}, entry, transport);
      replaceEntry(entry);
    } catch (error) {
      const attempts = entry.attempts + 1;
      if (!isRetryable(error) || attempts >= MAX_ATTEMPTS) replaceEntry(entry);
      else replaceEntry(entry, {...entry, attempts, nextAt: now + Math.min(MAX_BACKOFF_MS, MINUTE_MS * 2 ** attempts)});
    }
  }
  return readServerProgressQueue().length;
};

// ---------------------------------------------------------------- session

type SessionState = 'idle' | 'playing' | 'paused' | 'stopped';
export type StopOutcome = 'sent' | 'queued' | 'dropped' | 'skipped';

/**
 * One item playing from one server. Feed it the position with update(); it
 * reports start once playback runs, then every 10 seconds, on pause and on
 * resume, marks the item played at 90%, and stop() ends it. Requests go out
 * one after another, in order.
 */
export class ServerProgressSession {
  private state: SessionState = 'idle';
  private position = 0;
  private duration = 0;
  private lastSentAt = 0;
  private playedSent = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly item: ServerItem,
    private readonly transport: ProgressTransport = httpTransport,
    readonly playSessionId: string = newPlaySessionId(),
  ) {}

  get current(): {state: SessionState; position: number; duration: number; playedSent: boolean} {
    return {state: this.state, position: this.position, duration: this.duration, playedSent: this.playedSent};
  }

  private get percent(): number {
    return this.duration > 0 ? (this.position / this.duration) * 100 : 0;
  }

  update(position: number, duration: number, playing: boolean, now = Date.now()): void {
    if (this.state === 'stopped' || !(duration > 0) || !Number.isFinite(position)) return;
    this.position = Math.min(duration, Math.max(0, position));
    this.duration = duration;
    if (this.state === 'idle') {
      if (!playing) return;
      this.state = 'playing';
      this.report('start', false, now);
    } else if (playing && this.state === 'paused') {
      this.state = 'playing';
      this.report('progress', false, now, 'Unpause');
    } else if (!playing && this.state === 'playing') {
      this.state = 'paused';
      this.report('progress', true, now, 'Pause');
    } else if (now - this.lastSentAt >= REPORT_INTERVAL_MS - INTERVAL_SLACK_MS) {
      this.report('progress', this.state === 'paused', now, 'TimeUpdate');
    }
    if (!this.playedSent && this.percent >= PLAYED_PERCENT) {
      this.playedSent = true;
      this.queue(() => this.transport.markPlayed(this.item)).catch(() => {
        // Tried again with the stop.
        this.playedSent = false;
      });
    }
  }

  /**
   * Ends the session with a stop at the last position. Nothing is sent when
   * playback never started. A stop that fails for a passing reason is queued.
   */
  stop(now = Date.now()): Promise<StopOutcome> {
    if (this.state === 'stopped') return this.chain.then(() => 'skipped' as const);
    const started = this.state !== 'idle';
    this.state = 'stopped';
    if (!started) return this.chain.then(() => 'skipped' as const);
    const position = this.position;
    const duration = this.duration;
    return this.chain
      .catch(() => undefined)
      .then(async () => {
        const played = this.percent >= PLAYED_PERCENT && !this.playedSent;
        const stop = {positionSeconds: position, durationSeconds: duration, played};
        try {
          await deliverStop(this.item, stop, this.transport);
          dropQueued(serverItemKey(this.item));
          return 'sent' as const;
        } catch (error) {
          if (!isRetryable(error)) return 'dropped' as const;
          enqueueServerStop(this.item, stop, now);
          return 'queued' as const;
        }
      });
  }

  private report(kind: ReportKind, paused: boolean, now: number, event?: ReportEvent) {
    this.lastSentAt = now;
    const report: ProgressReport = {
      kind,
      positionSeconds: this.position,
      durationSeconds: this.duration,
      paused,
      event,
      playSessionId: this.playSessionId,
    };
    this.queue(() => this.transport.report(this.item, report)).catch(() => undefined);
  }

  private queue(task: () => Promise<void>): Promise<void> {
    const next = this.chain.catch(() => undefined).then(task);
    this.chain = next.catch(() => undefined);
    return next;
  }
}

// ---------------------------------------------------------------- resume

export interface ServerResume {
  positionSeconds: number;
  durationSeconds: number;
  played: boolean;
}

const getJson = async (url: string, headers: Record<string, string>, timeoutMs: number): Promise<any> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {headers: {Accept: 'application/json', ...headers}, signal: controller.signal});
    if (!response.ok) throw new ServerReportError(response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const fromMediaBrowser = (data: any): ServerResume => ({
  positionSeconds: ticksToSeconds(data?.UserData?.PlaybackPositionTicks),
  durationSeconds: ticksToSeconds(data?.RunTimeTicks),
  played: data?.UserData?.Played === true,
});

/** Where the server says the user stopped this item. */
export const fetchServerResume = async (item: ServerItem, timeoutMs = RESUME_LOOKUP_MS): Promise<ServerResume> => {
  const root = rootOf(item.source.server);
  const id = encodeURIComponent(item.itemId);
  if (item.kind === 'plex') {
    const data = await getJson(`${root}/library/metadata/${id}`, plexRequestHeaders(item.source), timeoutMs);
    const meta = data?.MediaContainer?.Metadata?.[0];
    const offset = Number(meta?.viewOffset);
    const duration = Number(meta?.duration);
    return {
      positionSeconds: Number.isFinite(offset) && offset > 0 ? offset / 1000 : 0,
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration / 1000 : 0,
      played: Number(meta?.viewCount) > 0 && !(offset > 0),
    };
  }
  const headers = mediaBrowserHeaders(item.source);
  const user = encodeURIComponent(item.source.username);
  const legacy = `${root}/Users/${user}/Items/${id}`;
  if (item.kind === 'emby') return fromMediaBrowser(await getJson(legacy, headers, timeoutMs));
  try {
    return fromMediaBrowser(await getJson(`${root}/Items/${id}?userId=${user}`, headers, timeoutMs));
  } catch (error) {
    if (!(error instanceof ServerReportError && error.status === 404)) throw error;
    return fromMediaBrowser(await getJson(legacy, headers, timeoutMs));
  }
};

/**
 * Before an item from a saved server opens: when this device has no
 * progress for it, takes the server's resume position as this device's, so
 * the player continues there. Never throws; a slow or offline server just
 * opens the item from the start.
 */
export const seedServerResume = async (source: SavedSource, streamUrl: string, link: string, timeoutMs = RESUME_LOOKUP_MS): Promise<boolean> => {
  try {
    if (!isServerProgressSyncEnabled()) return false;
    const item = findServerItem([streamUrl], [source]);
    if (!item) return false;
    // Loaded on first use, so modules that only list or play sources do not open the progress store.
    const {watchProgressStorage} = require('../storage/WatchProgressStorage') as typeof import('../storage/WatchProgressStorage');
    const local = watchProgressStorage.getProgress(link);
    if (local && local.position > 0) return false;
    const resume = await fetchServerResume(item, timeoutMs);
    if (resume.played || resume.positionSeconds <= 5 || !(resume.durationSeconds > 0)) return false;
    if ((resume.positionSeconds / resume.durationSeconds) * 100 >= PLAYED_PERCENT) return false;
    watchProgressStorage.setProgress(link, resume.positionSeconds, resume.durationSeconds);
    return true;
  } catch {
    return false;
  }
};
