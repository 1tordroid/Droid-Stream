/**
 * Trakt scrobbling: tells Trakt what is playing (start), paused (pause) and
 * when playback ends (stop). Trakt records a watch for a stop at 80% or more
 * and keeps the position as playback progress below that.
 *
 * A stop that fails for a passing reason (offline, server error, rate limit)
 * is queued in storage and sent later. Start and pause only describe the
 * moment, so they are not queued.
 */
import type {WatchMeta} from '../watchMeta';
import {
  claimTraktWatched,
  readSyncSettings,
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

/** Trakt marks the title watched for a stop at this progress or more. */
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

/** On while Trakt is connected and syncing, unless scrobbling was turned off. */
export const scrobbleEnabled = (settings: SyncSettings = readSyncSettings()): boolean => {
  const trakt = settings.trakt;
  return Boolean(trakt.enabled && trakt.accessToken && trakt.scrobble !== false);
};

/** The scrobble request body, or undefined when an episode lacks its season and number. */
export const scrobbleBody = (meta: WatchMeta, progress: number): Record<string, unknown> | undefined => {
  if (!meta.title) return undefined;
  const ids: Record<string, string | number> = {};
  if (meta.imdbId) ids.imdb = meta.imdbId;
  const tmdb = Number(meta.tmdbId);
  if (Number.isInteger(tmdb) && tmdb > 0) ids.tmdb = tmdb;
  const item = {title: meta.title, ...(meta.year ? {year: meta.year} : {}), ids};
  const value = Math.round(Math.min(100, Math.max(0, Number.isFinite(progress) ? progress : 0)) * 100) / 100;
  if (meta.type === 'series') {
    if (meta.season === undefined || meta.episode === undefined) return undefined;
    return {show: item, episode: {season: meta.season, number: meta.episode}, progress: value};
  }
  return {movie: item, progress: value};
};

// ---------------------------------------------------------------- queue and rate limit
export const readScrobbleQueue = (): QueuedScrobble[] => {
  try {
    const saved = JSON.parse(storage.getString('scrobble:queue') || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
};

const writeQueue = (queue: QueuedScrobble[]) => {
  storage.setString('scrobble:queue', JSON.stringify(queue));
};

/** Keeps the newest stop per title, at most MAX_QUEUE of them. */
export const enqueueScrobble = (key: string, body: Record<string, unknown>, now = Date.now()): void => {
  const queue = readScrobbleQueue().filter(entry => entry.key !== key);
  queue.push({key, body, attempts: 0, nextAt: now, queuedAt: now});
  writeQueue(queue.slice(-MAX_QUEUE));
};

const dropQueued = (key: string) => {
  const queue = readScrobbleQueue();
  const rest = queue.filter(entry => entry.key !== key);
  if (rest.length !== queue.length) writeQueue(rest);
};

const blockedUntil = (): number => Number(storage.getString('scrobble:blockedUntil') || 0) || 0;

/** Trakt asked to slow down (429) or refused for the account limit (420): wait before any scrobble. */
const backOff = (error: WatchSyncHttpError, now: number) => {
  const hits = (Number(storage.getString('scrobble:rateHits') || 0) || 0) + 1;
  storage.setString('scrobble:rateHits', String(hits));
  const floor = error.status === 420 ? HOUR_MS : MINUTE_MS;
  const delay = error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : Math.min(MAX_BACKOFF_MS, floor * 2 ** (hits - 1));
  storage.setString('scrobble:blockedUntil', String(now + Math.max(delay, 1000)));
};

const clearBackOff = () => {
  if (storage.getString('scrobble:rateHits')) storage.setString('scrobble:rateHits', '0');
};

export const scrobbleBlockedUntil = blockedUntil;

type Failure = 'retry' | 'drop' | 'limited' | 'done';

/** How a failed scrobble is handled. 409 means Trakt already has it. */
const classify = (error: unknown): Failure => {
  if (error instanceof WatchSyncSignedOutError) return 'drop';
  if (!(error instanceof WatchSyncHttpError)) return 'retry';
  if (error.status === 409) return 'done';
  if (error.status === 420 || error.status === 429) return 'limited';
  if (error.status >= 500) return 'retry';
  // 400, 401 after a failed renewal, 403, 404 (title unknown), 422: sending again will not help.
  return 'drop';
};

/**
 * Sends one scrobble. A stop that fails for a passing reason is queued;
 * anything else that fails is dropped.
 */
export const sendScrobble = async (action: ScrobbleAction, meta: WatchMeta, progress: number, now = Date.now()): Promise<ScrobbleOutcome> => {
  if (!scrobbleEnabled()) return 'skipped';
  const body = scrobbleBody(meta, progress);
  if (!body) return 'skipped';
  const key = syncedKey(meta);
  if (blockedUntil() > now) {
    if (action !== 'stop') return 'skipped';
    enqueueScrobble(key, body, now);
    return 'queued';
  }
  try {
    await traktAuthedPost(`/scrobble/${action}`, body);
  } catch (error) {
    const failure = classify(error);
    if (failure === 'limited') backOff(error as WatchSyncHttpError, now);
    if (failure === 'done') {
      dropQueued(key);
      return 'sent';
    }
    if (action === 'stop' && (failure === 'retry' || failure === 'limited')) {
      enqueueScrobble(key, body, now);
      return 'queued';
    }
    return 'dropped';
  }
  clearBackOff();
  // What was just sent is newer than a stop still waiting for this title.
  dropQueued(key);
  return 'sent';
};

let flushing: Promise<number> | undefined;

/**
 * Sends the queued stops that are due, oldest first. Stops at the first rate
 * limit. Returns how many are still queued. Runs one at a time.
 */
export const flushScrobbleQueue = (now = Date.now()): Promise<number> => {
  if (!flushing) {
    flushing = flushNow(now).finally(() => {
      flushing = undefined;
    });
  }
  return flushing;
};

const flushNow = async (now: number): Promise<number> => {
  const fresh = readScrobbleQueue().filter(entry => now - entry.queuedAt < MAX_AGE_MS);
  writeQueue(fresh);
  if (!fresh.length || !scrobbleEnabled()) return fresh.length;
  for (const entry of fresh) {
    if (blockedUntil() > now) break;
    if (entry.nextAt > now) continue;
    // A newer stop for the same title may have replaced this one meanwhile.
    const current = readScrobbleQueue().find(item => item.key === entry.key);
    if (!current || current.queuedAt !== entry.queuedAt) continue;
    try {
      await traktAuthedPost('/scrobble/stop', entry.body);
      clearBackOff();
      removeEntry(entry);
    } catch (error) {
      const failure = classify(error);
      if (failure === 'done' || failure === 'drop') {
        removeEntry(entry);
        continue;
      }
      if (failure === 'limited') {
        backOff(error as WatchSyncHttpError, now);
        break;
      }
      const attempts = entry.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) removeEntry(entry);
      else updateEntry({...entry, attempts, nextAt: now + Math.min(MAX_BACKOFF_MS, MINUTE_MS * 2 ** attempts)});
    }
  }
  return readScrobbleQueue().length;
};

const removeEntry = (entry: QueuedScrobble) =>
  writeQueue(readScrobbleQueue().filter(item => !(item.key === entry.key && item.queuedAt === entry.queuedAt)));

const updateEntry = (entry: QueuedScrobble) =>
  writeQueue(readScrobbleQueue().map(item => (item.key === entry.key && item.queuedAt === entry.queuedAt ? entry : item)));

// ---------------------------------------------------------------- session
type SessionState = 'idle' | 'playing' | 'paused' | 'stopped';

/**
 * One title being played. Feed it the position with update(); it sends start
 * when playback runs and pause when it stops running, and stop() ends it.
 * Requests go out in order.
 */
export class ScrobbleSession {
  private state: SessionState = 'idle';
  private progress = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private release?: () => void;

  constructor(readonly meta: WatchMeta) {
    // While this session reports the title, its stop records the watch, not the history POST.
    if (scrobbleEnabled() && scrobbleBody(meta, 0)) this.release = claimTraktWatched(meta, () => this.finish());
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
    const next = this.chain.then(() => sendScrobble(action, this.meta, progress)).catch(() => 'dropped' as const);
    this.chain = next;
    return next;
  }
}
