/**
 * What the Play Next row on the Android TV home screen should hold, and
 * which native writes bring it there. Pure, so the rules can be tested
 * without a TV.
 */
import {hasAdultWords, isAdultSource} from '../../profiles/kids';
import {isWatched} from '../../player/upNext';
import type {ContinueWatchingItem} from '../../zustand/continueWatchingStore';

/** Programs the app keeps in Play Next. The launcher shows the newest first. */
export const WATCH_NEXT_MAX_ENTRIES = 10;
/** A position-only change of one program is written at most this often. */
export const WATCH_NEXT_PROGRESS_THROTTLE_MS = 2 * 60 * 1000;
/** Every program this app writes has an internal id starting with this. */
export const WATCH_NEXT_KEY_PREFIX = 'ds1.';
export const WATCH_NEXT_LINK_PREFIX = 'droidstream://watchnext';

export type WatchNextKind = 'continue' | 'next';

export interface WatchNextEntry {
  /** Internal provider id of the program: profile plus title. */
  key: string;
  kind: WatchNextKind;
  /** 'movie' or 'episode'. */
  type: 'movie' | 'episode';
  title: string;
  episodeTitle?: string;
  posterUri?: string;
  /** 'landscape' for a backdrop (16:9), 'poster' for a 2:3 poster. */
  posterShape: 'landscape' | 'poster';
  positionMs: number;
  durationMs: number;
  /** When it was last watched; the launcher orders by it. */
  lastEngagementMs: number;
  /** Opens the title in this app. */
  intentUri: string;
}

export interface PublishedEntry {
  /** Everything but the position and engagement time. */
  sig: string;
  /** Position and engagement time. */
  progressSig: string;
  /** When it was last written. */
  at: number;
}

export interface WatchNextState {
  published: Record<string, PublishedEntry>;
  /** Removed by the user from the TV home: key and when. */
  dismissed: Record<string, number>;
}

export interface WatchNextPlan {
  upserts: WatchNextEntry[];
  removes: string[];
  /** State once the writes succeed. */
  next: WatchNextState;
  /** Run again after this long to write positions held back, if any. */
  retryInMs?: number;
}

export const emptyWatchNextState = (): WatchNextState => ({published: {}, dismissed: {}});

/* eslint-disable no-bitwise */
/** FNV-1a, 32 bit, as base 36. Short and stable. */
const hash = (text: string, seed = 0x811c9dc5): string => {
  let value = seed >>> 0;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36);
};
/* eslint-enable no-bitwise */

export const watchNextKey = (profileId: string, itemId: string): string =>
  `${WATCH_NEXT_KEY_PREFIX}${profileId}.${hash(itemId)}${hash(itemId, 0x2c9277b5)}`;

export const isOwnWatchNextKey = (key: string): boolean => key.startsWith(WATCH_NEXT_KEY_PREFIX);

/** The profile a key belongs to. */
export const watchNextKeyProfile = (key: string): string | undefined =>
  isOwnWatchNextKey(key) ? key.slice(WATCH_NEXT_KEY_PREFIX.length).split('.')[0] : undefined;

export const buildWatchNextLink = (profileId: string, item: Pick<ContinueWatchingItem, 'infoUrl' | 'providerValue'>): string =>
  `${WATCH_NEXT_LINK_PREFIX}?p=${encodeURIComponent(profileId)}&link=${encodeURIComponent(item.infoUrl)}&provider=${encodeURIComponent(item.providerValue)}`;

export interface WatchNextLink {
  profileId: string;
  link: string;
  provider: string;
}

/** The title a Play Next link opens, or undefined for any other link. */
export const parseWatchNextLink = (url: string | null | undefined): WatchNextLink | undefined => {
  if (!url || !url.toLowerCase().startsWith(`${WATCH_NEXT_LINK_PREFIX}?`)) return undefined;
  const values: Record<string, string> = {};
  for (const part of url.slice(WATCH_NEXT_LINK_PREFIX.length + 1).split('&')) {
    const split = part.indexOf('=');
    if (split <= 0) continue;
    try {
      values[part.slice(0, split)] = decodeURIComponent(part.slice(split + 1));
    } catch {
      return undefined;
    }
  }
  if (!values.p || !values.link || !values.provider) return undefined;
  return {profileId: values.p, link: values.link, provider: values.provider};
};

const isWebImage = (uri?: string): uri is string => Boolean(uri) && /^https?:\/\//i.test(uri as string);

/** Whether a kids profile may show the title on the TV home. */
export const isKidsAllowedItem = (item: ContinueWatchingItem): boolean =>
  !hasAdultWords(item.title, item.episodeTitle, item.seasonTitle, item.episode?.title) &&
  !isAdultSource({value: item.providerValue, name: item.providerValue});

/**
 * Play Next programs for the Continue watching items of a profile, newest
 * first. In progress: Continue. A show moved on to its next episode and not
 * started yet: Next. Finished titles, titles never started, and titles
 * without a web image (the launcher cannot load app files) are left out.
 */
export const buildWatchNextEntries = (
  items: ContinueWatchingItem[],
  {profileId, kids, max = WATCH_NEXT_MAX_ENTRIES}: {profileId: string; kids: boolean; max?: number},
): WatchNextEntry[] => {
  const seen = new Set<string>();
  const entries: WatchNextEntry[] = [];
  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const item of sorted) {
    if (entries.length >= max) break;
    if (!item?.id || !item.infoUrl || !item.providerValue || !item.title) continue;
    if (kids && !isKidsAllowedItem(item)) continue;
    const movie = item.type === 'movie';
    const started = item.position > 0 && item.duration > 0;
    let kind: WatchNextKind;
    if (started) {
      // Watched: a movie is done; a show that did not move on has no next episode here.
      if (isWatched(item.position, item.duration)) continue;
      kind = 'continue';
    } else if (!movie && item.updatedAt > 0 && item.episode) {
      kind = 'next';
    } else {
      continue;
    }
    const backdrop = isWebImage(item.background) ? item.background : undefined;
    const poster = isWebImage(item.poster) ? item.poster : undefined;
    if (!backdrop && !poster) continue;
    const key = watchNextKey(profileId, item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    const episodeTitle = movie ? undefined : item.episodeTitle || item.episode?.title || item.seasonTitle;
    entries.push({
      key,
      kind,
      type: movie ? 'movie' : 'episode',
      title: item.title,
      ...(episodeTitle && episodeTitle !== item.title ? {episodeTitle} : {}),
      posterUri: backdrop || poster,
      posterShape: backdrop ? 'landscape' : 'poster',
      positionMs: kind === 'continue' ? Math.round(item.position * 1000) : 0,
      durationMs: kind === 'continue' ? Math.round(item.duration * 1000) : 0,
      lastEngagementMs: item.updatedAt,
      intentUri: buildWatchNextLink(profileId, item),
    });
  }
  return entries;
};

const signature = (entry: WatchNextEntry): string =>
  JSON.stringify([entry.kind, entry.type, entry.title, entry.episodeTitle || '', entry.posterUri || '', entry.posterShape, entry.intentUri]);

const progressSignature = (entry: WatchNextEntry): string =>
  `${Math.floor(entry.positionMs / 1000)}/${Math.floor(entry.durationMs / 1000)}/${entry.lastEngagementMs}`;

/**
 * The writes that turn what was published into [entries].
 *
 * - New programs are added and changed ones (title, episode, image, kind)
 *   updated at once; programs no longer wanted are removed.
 * - A position-only change waits until the program was last written
 *   [throttleMs] ago, unless [force] (leaving the player, the app going to
 *   the background). retryInMs says when to run again for it.
 * - A program the user removed from the TV home stays away until the title
 *   is watched again after that.
 */
export const planWatchNextSync = (
  entries: WatchNextEntry[],
  state: WatchNextState,
  now: number,
  {throttleMs = WATCH_NEXT_PROGRESS_THROTTLE_MS, force = false}: {throttleMs?: number; force?: boolean} = {},
): WatchNextPlan => {
  const published: Record<string, PublishedEntry> = {};
  const dismissed: Record<string, number> = {};
  const upserts: WatchNextEntry[] = [];
  const wanted = new Set<string>();
  let retryInMs: number | undefined;

  for (const entry of entries) {
    const dismissedAt = state.dismissed[entry.key];
    if (dismissedAt !== undefined && entry.lastEngagementMs <= dismissedAt) {
      dismissed[entry.key] = dismissedAt;
      continue;
    }
    wanted.add(entry.key);
    const sig = signature(entry);
    const progressSig = progressSignature(entry);
    const previous = state.published[entry.key];
    if (!previous || previous.sig !== sig) {
      upserts.push(entry);
      published[entry.key] = {sig, progressSig, at: now};
      continue;
    }
    if (previous.progressSig === progressSig) {
      published[entry.key] = previous;
      continue;
    }
    const wait = previous.at + throttleMs - now;
    if (force || wait <= 0) {
      upserts.push(entry);
      published[entry.key] = {sig, progressSig, at: now};
    } else {
      published[entry.key] = previous;
      retryInMs = retryInMs === undefined ? wait : Math.min(retryInMs, wait);
    }
  }

  const removes = Object.keys(state.published).filter(key => !wanted.has(key));
  return {upserts, removes, next: {published, dismissed}, ...(retryInMs !== undefined ? {retryInMs} : {})};
};

/**
 * Brings the saved state in line with what the TV provider holds: programs
 * the launcher has but the state does not know are removed by the next plan,
 * programs the user turned off count as dismissed, and programs gone from the
 * provider are written again.
 */
export const mergeProviderPrograms = (
  state: WatchNextState,
  programs: {key: string; browsable: boolean}[],
  now: number,
): WatchNextState => {
  const present = new Map(programs.filter(program => isOwnWatchNextKey(program.key)).map(program => [program.key, program]));
  const published: Record<string, PublishedEntry> = {};
  const dismissed = {...state.dismissed};
  for (const [key, program] of present) {
    if (!program.browsable && dismissed[key] === undefined) dismissed[key] = now;
    // Unknown or dismissed programs: an empty signature makes the next plan update or remove them.
    published[key] = program.browsable && state.published[key] ? state.published[key] : {sig: '', progressSig: '', at: 0};
  }
  return {published, dismissed};
};

/** Adds the programs the user removed from the TV home. */
export const withDismissed = (state: WatchNextState, removed: {key: string; at: number}[]): WatchNextState => {
  if (!removed.length) return state;
  const dismissed = {...state.dismissed};
  const published = {...state.published};
  for (const {key, at} of removed) {
    if (!isOwnWatchNextKey(key)) continue;
    dismissed[key] = Math.max(dismissed[key] ?? 0, at);
    // The receiver already deleted the program.
    delete published[key];
  }
  return {published, dismissed};
};
