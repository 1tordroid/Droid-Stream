import {
  emptyWatchNextState,
  mergeProviderPrograms,
  planWatchNextSync,
  withDismissed,
  type WatchNextEntry,
  type WatchNextState,
} from './plan';

export interface WatchNextBackend {
  list: () => Promise<{key: string; browsable: boolean}[]>;
  apply: (upserts: WatchNextEntry[], removes: string[]) => Promise<{failed: string[]}>;
  takeDismissed: () => Promise<{key: string; at: number}[]>;
}

export interface WatchNextSyncerOptions {
  backend: WatchNextBackend;
  /** The programs wanted now; [] when the setting is off. */
  readEntries: () => WatchNextEntry[];
  loadState: () => WatchNextState | undefined;
  saveState: (state: WatchNextState) => void;
  now?: () => number;
  /** Changes within this window are written together. */
  batchMs?: number;
  throttleMs?: number;
}

export interface WatchNextSyncer {
  /** Reads what the TV home holds and writes the row for the active profile. */
  start: () => Promise<void>;
  /** Something changed: write within batchMs. [force] skips the position throttle. */
  schedule: (force?: boolean) => void;
  /** The user removed programs from the TV home. */
  dismissed: () => Promise<void>;
  /** Runs now, for tests and for leaving the player. */
  runNow: (force?: boolean) => Promise<void>;
  stop: () => void;
}

/** Drops failed writes from the state, so they are tried again next time. */
const withFailures = (next: WatchNextState, failed: string[], removes: string[]): WatchNextState => {
  if (!failed.length) return next;
  const published = {...next.published};
  for (const key of failed) {
    if (removes.includes(key)) published[key] = {sig: '', progressSig: '', at: 0};
    else delete published[key];
  }
  return {...next, published};
};

export const createWatchNextSyncer = ({
  backend,
  readEntries,
  loadState,
  saveState,
  now = Date.now,
  batchMs = 3000,
  throttleMs,
}: WatchNextSyncerOptions): WatchNextSyncer => {
  let state: WatchNextState = loadState() ?? emptyWatchNextState();
  let started = false;
  let stopped = false;
  let running: Promise<void> | undefined;
  let again: {force: boolean} | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerAt = 0;
  let timerForce = false;

  const commit = (next: WatchNextState) => {
    state = next;
    try {
      saveState(state);
    } catch {}
  };

  const runOnce = async (force: boolean): Promise<void> => {
    let entries: WatchNextEntry[];
    try {
      entries = readEntries();
    } catch {
      return;
    }
    const plan = planWatchNextSync(entries, state, now(), {force, ...(throttleMs !== undefined ? {throttleMs} : {})});
    if (plan.upserts.length || plan.removes.length) {
      let failed: string[];
      try {
        failed = (await backend.apply(plan.upserts, plan.removes)).failed || [];
      } catch {
        failed = [...plan.upserts.map(entry => entry.key), ...plan.removes];
      }
      commit(withFailures(plan.next, failed, plan.removes));
    } else if (plan.next !== state) {
      commit(plan.next);
    }
    if (plan.retryInMs !== undefined) arm(plan.retryInMs + 50, false);
  };

  const run = (force: boolean): Promise<void> => {
    if (stopped || !started) return Promise.resolve();
    if (running) {
      again = {force: Boolean(again?.force) || force};
      return running;
    }
    running = runOnce(force).finally(() => {
      running = undefined;
      const queued = again;
      again = undefined;
      if (queued && !stopped) run(queued.force).catch(() => undefined);
    });
    return running;
  };

  function arm(delayMs: number, force: boolean) {
    if (stopped) return;
    const at = now() + delayMs;
    timerForce = timerForce || force;
    // An earlier write already waiting covers this change too.
    if (timer && timerAt <= at) return;
    if (timer) clearTimeout(timer);
    timerAt = at;
    timer = setTimeout(() => {
      timer = undefined;
      const queuedForce = timerForce;
      timerForce = false;
      run(queuedForce).catch(() => undefined);
    }, delayMs);
  }

  const takeDismissed = async () => {
    try {
      const removed = await backend.takeDismissed();
      if (removed.length) commit(withDismissed(state, removed));
    } catch {}
  };

  return {
    start: async () => {
      if (started || stopped) return;
      await takeDismissed();
      try {
        commit(mergeProviderPrograms(state, await backend.list(), now()));
      } catch {}
      started = true;
      await run(true);
    },
    schedule: (force = false) => arm(force ? 0 : batchMs, force),
    dismissed: async () => {
      await takeDismissed();
      await run(true);
    },
    runNow: (force = false) => run(force),
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
};
