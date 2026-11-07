/**
 * Play best fallback: the short, ordered list of sources Play best may use,
 * the optional Play best filters, and the state machine that decides when the
 * playing source counts as dead so the player moves on to the next one.
 *
 * Everything here is pure so it can be tested without a player.
 */
import {parseRelease} from '../releaseName';
import type {Candidate} from './finder';

export type Resolution = '480p' | '720p' | '1080p' | '2160p';
export type CodecChoice = 'any' | 'prefer' | 'avoid';

export interface PlayBestFilters {
  /** Largest file Play best picks, in GB. 0 means no limit. */
  maxSizeGB: number;
  /** Lowest resolution Play best picks, or '' for any. */
  minResolution: Resolution | '';
  /** Highest resolution Play best picks, or '' for any. */
  maxResolution: Resolution | '';
  hevc: CodecChoice;
  av1: CodecChoice;
}

export const defaultPlayBestFilters = (): PlayBestFilters => ({
  maxSizeGB: 0,
  minResolution: '',
  maxResolution: '',
  hevc: 'any',
  av1: 'any',
});

export interface FallbackTimeouts {
  /** No first frame (player load) from a link within this time: try the next one. */
  firstFrameMs: number;
  /** Loaded but stuck buffering this long before playback gets going: try the next one. */
  startStallMs: number;
  /** Torrents streamed on the phone need peers first, so they get longer to start. */
  torrentFirstFrameMs: number;
  /** Playback that moved this far counts as started; timeouts stop applying. */
  playingAfterMs: number;
}

export const DEFAULT_FALLBACK_TIMEOUTS: FallbackTimeouts = {
  firstFrameMs: 15_000,
  startStallMs: 20_000,
  torrentFirstFrameMs: 60_000,
  playingAfterMs: 5_000,
};

export const MAX_FALLBACK_SOURCES = 5;

const RES_ORDER: Resolution[] = ['480p', '720p', '1080p', '2160p'];

/** HEVC, AV1 or another codec name read from the release name, if any. */
export const codecOf = (candidate: Pick<Candidate, 'title'>): string | undefined => parseRelease(candidate.title || '').codec;

/** Whether a candidate passes the hard Play best filters (size and resolution). */
export const passesFilters = (candidate: Candidate, filters: PlayBestFilters): boolean => {
  if (filters.maxSizeGB > 0 && candidate.sizeBytes > 0 && candidate.sizeBytes > filters.maxSizeGB * 1024 ** 3) return false;
  const res = RES_ORDER.indexOf(candidate.resolution as Resolution);
  // Unknown resolution is kept: many direct links do not say.
  if (res >= 0) {
    if (filters.minResolution && res < RES_ORDER.indexOf(filters.minResolution)) return false;
    if (filters.maxResolution && res > RES_ORDER.indexOf(filters.maxResolution)) return false;
  }
  return true;
};

/** -1 for a preferred codec, 1 for an avoided one, 0 otherwise. Lower sorts first. */
const codecRank = (candidate: Candidate, filters: PlayBestFilters): number => {
  const codec = codecOf(candidate);
  const choice = codec === 'HEVC' ? filters.hevc : codec === 'AV1' ? filters.av1 : 'any';
  return choice === 'prefer' ? -1 : choice === 'avoid' ? 1 : 0;
};

/**
 * Applies the Play best filters to an already ranked list. Size and resolution
 * limits drop sources (unless that leaves none, then the list is kept as is);
 * codec choices move preferred codecs up and avoided ones down, otherwise
 * keeping the ranking.
 */
export const applyPlayBestFilters = (ranked: Candidate[], filters: PlayBestFilters = defaultPlayBestFilters()): Candidate[] => {
  const kept = ranked.filter(candidate => passesFilters(candidate, filters));
  const list = kept.length ? kept : ranked;
  return list
    .map((candidate, index) => ({candidate, index, codec: codecRank(candidate, filters)}))
    .sort((a, b) => a.codec - b.codec || a.index - b.index)
    .map(entry => entry.candidate);
};

/** 0 for a debrid-cached or debrid-resolved source, 1 for another direct link, 2 for the rest. */
export const fallbackGroup = (candidate: Candidate): 0 | 1 | 2 => {
  if (candidate.debridDirect || candidate.cachedOn.length) return 0;
  if (candidate.kind === 'direct' && candidate.url) return 1;
  return 2;
};

/** A torrent nobody seeds and no debrid holds cannot start. */
const playable = (candidate: Candidate): boolean =>
  fallbackGroup(candidate) < 2 || Boolean(candidate.magnet || candidate.torrentUrl) && (candidate.seeders > 0 || Boolean(candidate.torrentUrl));

/**
 * The ordered sources Play best tries: debrid-cached first, then direct links,
 * then the rest, each group keeping the ranking it came in. Recently failed
 * sources go last, and the list is cut to `max`.
 */
export const buildFallbackList = (
  ranked: Candidate[],
  options: {filters?: PlayBestFilters; failedIds?: ReadonlySet<string>; max?: number} = {},
): Candidate[] => {
  const failed = options.failedIds || new Set<string>();
  const filtered = applyPlayBestFilters(ranked, options.filters).filter(playable);
  return filtered
    .map((candidate, index) => ({candidate, index, failed: failed.has(candidate.id) ? 1 : 0, group: fallbackGroup(candidate)}))
    .sort((a, b) => a.failed - b.failed || a.group - b.group || a.index - b.index)
    .slice(0, options.max ?? MAX_FALLBACK_SOURCES)
    .map(entry => entry.candidate);
};

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type FallbackPhase =
  /** Source handed to the player, waiting for it to load. */
  | 'starting'
  /** Loaded (first frame), waiting for playback to move. */
  | 'loaded'
  /** Played long enough: only a real error moves on now. */
  | 'playing'
  /** The next source is being prepared. */
  | 'switching'
  /** Every source failed. */
  | 'exhausted'
  /** The user picked another source, or there is no list: hands off. */
  | 'off';

export interface FallbackState {
  phase: FallbackPhase;
  index: number;
  total: number;
  /** When the current phase began. */
  since: number;
  /** Last polled playback position, seconds. */
  lastPosition: number | null;
  /** When the position last moved forward. */
  lastMovedAt: number;
  /** How much playback has moved since loading, ms. */
  playedMs: number;
  /** Whether the current source is a torrent streamed on the phone. */
  torrent: boolean;
}

export type FallbackEvent =
  | {type: 'start'; now: number; index: number; torrent?: boolean}
  | {type: 'load'; now: number}
  | {type: 'tick'; now: number; position: number; paused?: boolean}
  | {type: 'error'; now: number}
  | {type: 'resolveFailed'; now: number}
  | {type: 'userPicked'; now: number};

/** What the caller must do after an event. 'next' means: record a failure and switch to index + 1. */
export type FallbackAction = 'none' | 'next' | 'exhausted';

export type FallbackReason = 'error' | 'no-first-frame' | 'stalled' | 'unavailable';

export interface FallbackResult {
  state: FallbackState;
  action: FallbackAction;
  reason?: FallbackReason;
}

export const initialFallbackState = (total: number, index = 0, now = 0, torrent = false): FallbackState => ({
  phase: total > 0 ? 'starting' : 'off',
  index,
  total,
  since: now,
  lastPosition: null,
  lastMovedAt: now,
  playedMs: 0,
  torrent,
});

const fail = (state: FallbackState, now: number, reason: FallbackReason): FallbackResult =>
  state.index + 1 < state.total
    ? {state: {...state, phase: 'switching', since: now}, action: 'next', reason}
    : {state: {...state, phase: 'exhausted', since: now}, action: 'exhausted', reason};

/** A normal playback step between two one-second polls; larger jumps are seeks. */
const MAX_NATURAL_STEP_S = 4;

export const fallbackReducer = (
  state: FallbackState,
  event: FallbackEvent,
  timeouts: FallbackTimeouts = DEFAULT_FALLBACK_TIMEOUTS,
): FallbackResult => {
  const none = (next: FallbackState = state): FallbackResult => ({state: next, action: 'none'});
  if (event.type === 'userPicked') return none({...state, phase: 'off', since: event.now});
  if (state.phase === 'off' || state.phase === 'exhausted') return none();

  switch (event.type) {
    case 'start':
      return none({
        ...state,
        phase: 'starting',
        index: event.index,
        since: event.now,
        lastPosition: null,
        lastMovedAt: event.now,
        playedMs: 0,
        torrent: Boolean(event.torrent),
      });
    case 'resolveFailed':
      return state.phase === 'switching' ? fail(state, event.now, 'unavailable') : none();
    case 'load':
      return state.phase === 'starting'
        ? none({...state, phase: 'loaded', since: event.now, lastMovedAt: event.now, lastPosition: null, playedMs: 0})
        : none();
    case 'error':
      // An error from the old source while the next one is prepared is stale.
      return state.phase === 'switching' ? none() : fail(state, event.now, 'error');
    case 'tick': {
      if (state.phase === 'starting') {
        const limit = state.torrent ? timeouts.torrentFirstFrameMs : timeouts.firstFrameMs;
        return event.now - state.since >= limit ? fail(state, event.now, 'no-first-frame') : none();
      }
      if (state.phase !== 'loaded') return none();
      const step = state.lastPosition === null ? 0 : event.position - state.lastPosition;
      const moved = step > 0 && step <= MAX_NATURAL_STEP_S;
      const playedMs = state.playedMs + (moved ? step * 1000 : 0);
      const next: FallbackState = {
        ...state,
        lastPosition: event.position,
        playedMs,
        // A paused player is not stalling; neither is one that was just seeked.
        lastMovedAt: moved || event.paused || (step !== 0 && !moved) ? event.now : state.lastMovedAt,
      };
      if (playedMs >= timeouts.playingAfterMs) return none({...next, phase: 'playing', since: event.now});
      if (event.now - next.lastMovedAt >= timeouts.startStallMs) return fail(next, event.now, 'stalled');
      return none(next);
    }
  }
  return none();
};

export const nextSourceMessage = (index: number, total: number): string => `Trying next source (${index + 1}/${total})`;
