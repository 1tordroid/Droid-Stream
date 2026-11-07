/**
 * Scrobbling to Trakt and Simkl: tells the service what is playing (start),
 * paused (pause) and when playback ends (stop). Both record a watch for a
 * stop at 80% or more and keep the position as playback progress below that.
 * Each service has its own switch (Scrobble while watching), queue and
 * rate-limit wait.
 *
 * A stop that fails for a passing reason (offline, server error, rate limit)
 * is queued in storage and sent later. Start and pause only describe the
 * moment, so they are not queued.
 */
import type {WatchMeta} from '../watchMeta';
import {
  claimTraktWatched,
  readSyncSettings,
  simklAuthedPost,
  syncedKey,
  traktAuthedPost,
  traktMarkWatched,
  WatchSyncHttpError,
  watchSyncStorage,
  WatchSyncSignedOutError,
  type SyncSettings,
} from './index';

const storage = watchSyncStorage;

export type ScrobbleAction = 'start' | 'pause' | 'stop';
export type ScrobbleOutcome = 'sent' | 'queued' | 'dropped' | 'skipped';
export type ScrobbleServiceId = 'trakt' | 'simkl';

/** Trakt and Simkl mark the title watched for a stop at this progress or more. */
export const WATCHED_PERCENT = 80;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const MAX_BACKOFF_MS = 6 * HOUR_MS;
const MAX_QUEUE = 50;
const MAX_ATTEMPTS = 10;
const MAX_AGE_MS = 30 * 24 * HOUR_MS;

export interface QueuedScrobble {
  key: string;
  body: Record<string, unknown>;
  attempts: number;
  /** Not sent again before this time (ms since epoch). */
  nextAt: number;
  queuedAt: number;
}

/** On while the service is connected and syncing, unless scrobbling was turned off. */
const serviceScrobbleEnabled = (id: ScrobbleServiceId, settings: SyncSettings = readSyncSettings()): boolean => {
  const account = settings[id];
  return Boolean(account.enabled && account.accessToken && account.scrobble !== false);
};

/** Trakt scrobbling is on. */
export const scrobbleEnabled = (settings: SyncSettings = readSyncSettings()): boolean => serviceScrobbleEnabled('trakt', settings);

/** Simkl scrobbling is on. */
export const simklScrobbleEnabled = (settings: SyncSettings = readSyncSettings()): boolean => serviceScrobbleEnabled('simkl', settings);

const clampProgress = (progress: number) => Math.round(Math.min(100, Math.max(0, Number.isFinite(progress) ? progress : 0)) * 100) / 100;

const idsOf = (meta: WatchMeta): Record<string, string | number> => {
  const ids: Record<string, string | number> = {};
  if (meta.imdbId) ids.imdb = meta.imdbId;
  const tmdb = Number(meta.tmdbId);
  if (Number.isInteger(tmdb) && tmdb > 0) ids.tmdb = tmdb;
  return ids;
};

/** The Trakt scrobble request body, or undefined when an episode lacks its season and number. */
export const scrobbleBody = (meta: WatchMeta, progress: number): Record<string, unknown> | undefined => {
  if (!meta.title) return undefined;
  const item = {title: meta.title, ...(meta.year ? {year: meta.year} : {}), ids: idsOf(meta)};
  const value = clampProgress(progress);
  if (meta.type === 'series') {
    if (meta.season === undefined || meta.episode === undefined) return undefined;
    return {show: item, episode: {season: meta.season, number: meta.episode}, progress: value};
  }
  return {movie: item, progress: value};
};

/**
 * The Simkl scrobble request body. Anime goes under "anime" with its
 * MyAnimeList id when known; Simkl maps the season and episode itself.
 */
export const simklScrobbleBody = (meta: WatchMeta, progress: number): Record<string, unknown> | undefined => {
  if (!meta.title) return undefined;
  const ids = idsOf(meta);
  if (meta.anime && meta.malId) ids.mal = meta.malId;
  const item = {title: meta.title, ...(meta.year ? {year: meta.year} : {}), ids};
  const value = clampProgress(progress);
  if (meta.type === 'series') {
    if (meta.season === undefined || meta.episode === undefined) return undefined;
    return {[meta.anime ? 'anime' : 'show']: item, episode: {season: meta.season, number: meta.episode}, progress: value};
  }
  return {movie: item, progress: value};
};

type Failure = 'retry' | 'drop' | 'limited' | 'done';

/** How a failed scrobble is handled. 409 means the service already has it. */
const classify = (error: unknown): Failure => {
  if (error instanceof WatchSyncSignedOutError) return 'drop';
  if (!(error instanceof WatchSyncHttpError)) return 'retry';
  if (error.status === 409) return 'done';
  if (error.status === 420 || error.status === 429) return 'limited';
  if (error.status >= 500) return 'retry';
  // 400, 401 after a failed renewal, 403, 404 (title unknown), 422: sending again will not help.
  return 'drop';
};

interface ScrobbleTarget {
  id: ScrobbleServiceId;
  /** Storage key prefix for the queue and the rate-limit wait. */
  prefix: string;
  enabled: () => boolean;
  body: (meta: WatchMeta, progress: number) => Record<string, unknown> | undefined;
  post: (path: string, body: unknown) => Promise<unknown>;
}

/** The queue, rate-limit wait and sending for one service. */
export class Scrobbler {
  private flushing: Promise<number> | undefined;

  constructor(private readonly target: ScrobbleTarget) {}

  get id(): ScrobbleServiceId {
    return this.target.id;
  }

  enabled(): boolean {
    return this.target.enabled();
  }

  body(meta: WatchMeta, progress: number): Record<string, unknown> | undefined {
    return this.target.body(meta, progress);
  }

  readQueue(): QueuedScrobble[] {
    try {
      const saved = JSON.parse(storage.getString(`${this.target.prefix}queue`) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  private writeQueue(queue: QueuedScrobble[]) {
    storage.setString(`${this.target.prefix}queue`, JSON.stringify(queue));
  }

  /** Keeps the newest stop per title, at most MAX_QUEUE of them. */
  enqueue(key: string, body: Record<string, unknown>, now = Date.now()): void {
    const queue = this.readQueue().filter(entry => entry.key !== key);
    queue.push({key, body, attempts: 0, nextAt: now, queuedAt: now});
    this.writeQueue(queue.slice(-MAX_QUEUE));
  }

  private dropQueued(key: string) {
    const queue = this.readQueue();
    const rest = queue.filter(entry => entry.key !== key);
    if (rest.length !== queue.length) this.writeQueue(rest);
  }

  blockedUntil(): number {
    return Number(storage.getString(`${this.target.prefix}blockedUntil`) || 0) || 0;
  }

  /** The service asked to slow down (429) or refused for the account limit (420): wait before any scrobble. */
  private backOff(error: WatchSyncHttpError, now: number) {
    const hitsKey = `${this.target.prefix}rateHits`;
    const hits = (Number(storage.getString(hitsKey) || 0) || 0) + 1;
    storage.setString(hitsKey, String(hits));
    const floor = error.status === 420 ? HOUR_MS : MINUTE_MS;
    const delay = error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : Math.min(MAX_BACKOFF_MS, floor * 2 ** (hits - 1));
    storage.setString(`${this.target.prefix}blockedUntil`, String(now + Math.max(delay, 1000)));
  }

  private clearBackOff() {
    const hitsKey = `${this.target.prefix}rateHits`;
    if (storage.getString(hitsKey)) storage.setString(hitsKey, '0');
  }

  /**
   * Sends one scrobble. A stop that fails for a passing reason is queued;
   * anything else that fails is dropped.
   */
  async send(action: ScrobbleAction, meta: WatchMeta, progress: number, now = Date.now()): Promise<ScrobbleOutcome> {
    if (!this.enabled()) return 'skipped';
    const body = this.body(meta, progress);
    if (!body) return 'skipped';
    const key = syncedKey(meta);
    if (this.blockedUntil() > now) {
      if (action !== 'stop') return 'skipped';
      this.enqueue(key, body, now);
      return 'queued';
    }
    try {
      await this.target.post(`/scrobble/${action}`, body);
    } catch (error) {
      const failure = classify(error);
      if (failure === 'limited') this.backOff(error as WatchSyncHttpError, now);
      if (failure === 'done') {
        this.dropQueued(key);
        return 'sent';
      }
      if (action === 'stop' && (failure === 'retry' || failure === 'limited')) {
        this.enqueue(key, body, now);
        return 'queued';
      }
      return 'dropped';
    }
    this.clearBackOff();
    // What was just sent is newer than a stop still waiting for this title.
    this.dropQueued(key);
    return 'sent';
  }

  /**
   * Sends the queued stops that are due, oldest first. Stops at the first rate
   * limit. Returns how many are still queued. Runs one at a time.
   */
  flush(now = Date.now()): Promise<number> {
    if (!this.flushing) {
      this.flushing = this.flushNow(now).finally(() => {
        this.flushing = undefined;
      });
    }
    return this.flushing;
  }

  private async flushNow(now: number): Promise<number> {
    const fresh = this.readQueue().filter(entry => now - entry.queuedAt < MAX_AGE_MS);
    this.writeQueue(fresh);
    if (!fresh.length || !this.enabled()) return fresh.length;
    for (const entry of fresh) {
      if (this.blockedUntil() > now) break;
      if (entry.nextAt > now) continue;
      // A newer stop for the same title may have replaced this one meanwhile.
      const current = this.readQueue().find(item => item.key === entry.key);
      if (!current || current.queuedAt !== entry.queuedAt) continue;
      try {
        await this.target.post('/scrobble/stop', entry.body);
        this.clearBackOff();
        this.removeEntry(entry);
      } catch (error) {
        const failure = classify(error);
        if (failure === 'done' || failure === 'drop') {
          this.removeEntry(entry);
          continue;
        }
        if (failure === 'limited') {
          this.backOff(error as WatchSyncHttpError, now);
          break;
        }
        const attempts = entry.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) this.removeEntry(entry);
        else this.updateEntry({...entry, attempts, nextAt: now + Math.min(MAX_BACKOFF_MS, MINUTE_MS * 2 ** attempts)});
      }
    }
    return this.readQueue().length;
  }

  private removeEntry(entry: QueuedScrobble) {
    this.writeQueue(this.readQueue().filter(item => !(item.key === entry.key && item.queuedAt === entry.queuedAt)));
  }

  private updateEntry(entry: QueuedScrobble) {
    this.writeQueue(this.readQueue().map(item => (item.key === entry.key && item.queuedAt === entry.queuedAt ? entry : item)));
  }
}

/** Trakt keeps the storage keys it had before Simkl was added. */
export const traktScrobbler = new Scrobbler({
  id: 'trakt',
  prefix: 'scrobble:',
  enabled: () => scrobbleEnabled(),
  body: scrobbleBody,
  post: traktAuthedPost,
});

export const simklScrobbler = new Scrobbler({
  id: 'simkl',
  prefix: 'simkl-scrobble:',
  enabled: () => simklScrobbleEnabled(),
  body: simklScrobbleBody,
  post: simklAuthedPost,
});

export const SCROBBLERS: readonly Scrobbler[] = [traktScrobbler, simklScrobbler];

// The Trakt functions under their earlier names.
export const readScrobbleQueue = (): QueuedScrobble[] => traktScrobbler.readQueue();
export const enqueueScrobble = (key: string, body: Record<string, unknown>, now = Date.now()): void => traktScrobbler.enqueue(key, body, now);
export const scrobbleBlockedUntil = (): number => traktScrobbler.blockedUntil();
export const sendScrobble = (action: ScrobbleAction, meta: WatchMeta, progress: number, now = Date.now()): Promise<ScrobbleOutcome> =>
  traktScrobbler.send(action, meta, progress, now);
export const flushScrobbleQueue = (now = Date.now()): Promise<number> => traktScrobbler.flush(now);

// The Simkl functions.
export const readSimklScrobbleQueue = (): QueuedScrobble[] => simklScrobbler.readQueue();
export const sendSimklScrobble = (action: ScrobbleAction, meta: WatchMeta, progress: number, now = Date.now()): Promise<ScrobbleOutcome> =>
  simklScrobbler.send(action, meta, progress, now);
export const flushSimklScrobbleQueue = (now = Date.now()): Promise<number> => simklScrobbler.flush(now);

/** Sends the stops queued for every service. Returns how many are still queued. */
export const flushAllScrobbleQueues = async (now = Date.now()): Promise<number> => {
  const left = await Promise.all(SCROBBLERS.map(scrobbler => scrobbler.flush(now).catch(() => scrobbler.readQueue().length)));
  return left.reduce((sum, count) => sum + count, 0);
};

// ---------------------------------------------------------------- session
type SessionState = 'idle' | 'playing' | 'paused' | 'stopped';

/**
 * One title being played on one service (Trakt unless given). Feed it the
 * position with update(); it sends start when playback runs and pause when it
 * stops running, and stop() ends it. Requests go out in order.
 */
export class ScrobbleSession {
  private state: SessionState = 'idle';
  private progress = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private release?: () => void;

  constructor(readonly meta: WatchMeta, private readonly scrobbler: Scrobbler = traktScrobbler) {
    // While this session reports the title to Trakt, its stop records the watch, not the history POST.
    // Simkl answers a stop after the history entry with 409, so it needs no claim.
    if (scrobbler.id === 'trakt' && scrobbler.enabled() && scrobbler.body(meta, 0)) {
      this.release = claimTraktWatched(meta, () => this.finish());
    }
  }

  get current(): {state: SessionState; progress: number} {
    return {state: this.state, progress: this.progress};
  }

  update(position: number, duration: number, playing: boolean): void {
    if (this.state === 'stopped' || !(duration > 0) || !Number.isFinite(position)) return;
    this.progress = Math.min(100, Math.max(0, (position / duration) * 100));
    if (playing && this.state !== 'playing') {
      this.state = 'playing';
      this.send('start');
    } else if (!playing && this.state === 'playing') {
      this.state = 'paused';
      this.send('pause');
    }
  }

  /** Ends the session. Nothing is sent when playback never started and is short of a watch. */
  stop(): Promise<ScrobbleOutcome> {
    if (this.state === 'stopped') return this.chain.then(() => 'skipped' as const);
    const started = this.state !== 'idle';
    this.state = 'stopped';
    this.release?.();
    this.release = undefined;
    if (!started && this.progress < WATCHED_PERCENT) return this.chain.then(() => 'skipped' as const);
    return this.send('stop');
  }

  /**
   * The player counts the title as watched: stop now so Trakt records it
   * even if the app is closed before the player is. Falls back to the
   * history POST when the scrobble cannot record it.
   */
  private async finish(): Promise<void> {
    this.progress = Math.max(this.progress, 85);
    const outcome = await this.stop();
    if (outcome === 'skipped' || outcome === 'dropped') await traktMarkWatched(this.meta);
  }

  private send(action: ScrobbleAction): Promise<ScrobbleOutcome> {
    const progress = this.progress;
    const next = this.chain.then(() => this.scrobbler.send(action, this.meta, progress)).catch(() => 'dropped' as const);
    this.chain = next;
    return next;
  }
}
