/**
 * Intro, recap, credits and preview segments: merging the sources, picking
 * the one at the playback position, and fitting a season's marks to another
 * episode. Nothing here touches storage or the network.
 */
import type {SkipInterval} from '../providers/types';

export type SegmentKind = 'intro' | 'recap' | 'credits' | 'preview';
export const SEGMENT_KINDS: readonly SegmentKind[] = ['intro', 'recap', 'credits', 'preview'];

/** Where a segment came from, highest priority first. */
export type SegmentSource = 'provider' | 'jellyfin' | 'emby' | 'plex' | 'aniskip' | 'introdb' | 'user';

export interface SkipSegment extends SkipInterval {
  title: string;
  kind: SegmentKind;
  source: SegmentSource;
}

export type SkipMode = 'off' | 'button' | 'auto';
export type SkipModes = Record<SegmentKind, SkipMode>;

/** Before 5.6.0 every segment showed a button, so that stays the default. */
export const DEFAULT_SKIP_MODES: SkipModes = {intro: 'button', recap: 'button', credits: 'button', preview: 'button'};

export const SEGMENT_LABELS: Record<SegmentKind, string> = {
  intro: 'Intro',
  recap: 'Recap',
  credits: 'Credits',
  preview: 'Preview',
};

/** A segment open at the end when the runtime is not known yet. */
export const OPEN_END_SECONDS = 6 * 60 * 60;

/** Segments shorter than this are dropped. */
const MIN_LENGTH = 1;

/** The kind a provider title means. Unknown titles count as an intro, as before. */
export const kindFromTitle = (title?: string): SegmentKind => {
  const text = (title || '').toLowerCase();
  if (text.includes('recap')) return 'recap';
  if (text.includes('preview') || text.includes('next time')) return 'preview';
  if (/credit|outro|ending|\bed\b/.test(text)) return 'credits';
  return 'intro';
};

const valid = (item: {from?: unknown; to?: unknown} | null | undefined): item is {from: number; to: number} =>
  Boolean(item) &&
  typeof item!.from === 'number' &&
  typeof item!.to === 'number' &&
  Number.isFinite(item!.from) &&
  Number.isFinite(item!.to) &&
  (item!.from as number) >= 0 &&
  (item!.to as number) > (item!.from as number);

export const makeSegment = (kind: SegmentKind, from: number, to: number, source: SegmentSource): SkipSegment => ({
  title: SEGMENT_LABELS[kind],
  kind,
  from,
  to,
  source,
});

/** Provider intervals as segments, dropping broken entries and duplicates. */
export const fromIntervals = (items: (SkipInterval | null | undefined)[] | undefined, source: SegmentSource): SkipSegment[] => {
  const result: SkipSegment[] = [];
  for (const item of items || []) {
    if (!valid(item)) continue;
    if (result.some(s => Math.abs(s.from - item.from) < 1 && Math.abs(s.to - item.to) < 1)) continue;
    result.push(makeSegment(kindFromTitle(item.title), item.from, item.to, source));
  }
  return result;
};

const overlap = (a: {from: number; to: number}, b: {from: number; to: number}) =>
  Math.min(a.to, b.to) - Math.max(a.from, b.from);

/**
 * One list from several sources, given highest priority first. For each kind
 * the first source that has it wins. A segment that overlaps one already kept
 * from a higher source is dropped. With a known runtime, segments are cut to
 * it and those outside it are dropped.
 */
export const mergeSegments = (groups: SkipSegment[][], durationSeconds = 0): SkipSegment[] => {
  const winners = new Map<SegmentKind, number>();
  groups.forEach((group, index) => {
    for (const segment of group) {
      if (!winners.has(segment.kind)) winners.set(segment.kind, index);
    }
  });
  const kept: SkipSegment[] = [];
  groups.forEach((group, index) => {
    for (const segment of group) {
      if (winners.get(segment.kind) !== index || !valid(segment)) continue;
      let {from, to} = segment;
      if (durationSeconds > 0) {
        if (from >= durationSeconds) continue;
        to = Math.min(to, durationSeconds);
      }
      if (to - from < MIN_LENGTH) continue;
      const fitted = {...segment, from, to};
      if (kept.some(other => overlap(other, fitted) > MIN_LENGTH)) continue;
      kept.push(fitted);
    }
  });
  return kept.sort((a, b) => a.from - b.from);
};

/** Only the kinds whose mode is not Off. */
export const withoutOff = (segments: SkipSegment[], modes: SkipModes): SkipSegment[] =>
  segments.filter(segment => modes[segment.kind] !== 'off');

/** The segment playing at this time, if any. */
export const segmentAt = <T extends SkipInterval>(segments: T[], time: number): T | undefined =>
  segments.find(segment => time >= segment.from && time < segment.to);

/** Same segment across renders: kind and rounded start. */
export const segmentId = (segment: {kind?: string; title?: string; from: number}) =>
  `${segment.kind || segment.title || ''}:${Math.round(segment.from)}`;

/** True for credits that run to the end of the video, where skipping means "next episode". */
export const isEndSegment = (segment: SkipSegment, durationSeconds: number): boolean => {
  if (segment.kind !== 'credits' && segment.kind !== 'preview') return false;
  if (durationSeconds > 0) return segment.to >= durationSeconds - 5;
  return segment.to - segment.from >= OPEN_END_SECONDS - 1;
};

export const skipLabel = (segment: {kind?: SegmentKind; title?: string}): string => {
  if (segment.kind) return `Skip ${SEGMENT_LABELS[segment.kind].toLowerCase()}`;
  const title = segment.title || 'Intro';
  return title.toLowerCase().startsWith('skip') ? title : `Skip ${title.toLowerCase()}`;
};

/** What to do when playback enters a segment. */
export type SegmentAction = 'none' | 'button' | 'auto';

export const actionFor = (segment: SkipSegment | undefined, modes: SkipModes, alreadyAutoSkipped: boolean): SegmentAction => {
  if (!segment) return 'none';
  const mode = modes[segment.kind];
  if (mode === 'off') return 'none';
  // Seeking back into a segment that was skipped on its own shows the button instead.
  if (mode === 'auto' && !alreadyAutoSkipped) return 'auto';
  return 'button';
};

/** Marks a viewer set for a season, in seconds from the start of the episode. */
export interface SeasonMarks {
  introStart?: number;
  introEnd?: number;
  creditsStart?: number;
  /** Runtime of the episode the credits were marked on. */
  runtime?: number;
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

export const cleanMarks = (value: unknown): SeasonMarks => {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    introStart: num(raw.introStart),
    introEnd: num(raw.introEnd),
    creditsStart: num(raw.creditsStart),
    runtime: num(raw.runtime),
  };
};

export const hasMarks = (marks: SeasonMarks): boolean =>
  marks.introEnd !== undefined || marks.creditsStart !== undefined;

/**
 * A season's marks as segments for one episode. Intros stay at the same time
 * from the start. Credits keep the same distance from the end, so a longer or
 * shorter episode moves them. Marks outside the runtime are dropped.
 */
export const marksToSegments = (marks: SeasonMarks, durationSeconds = 0): SkipSegment[] => {
  const segments: SkipSegment[] = [];
  const known = durationSeconds > 0;
  const {introEnd} = marks;
  const introStart = marks.introStart ?? 0;
  if (introEnd !== undefined && introEnd > introStart && (!known || introEnd <= durationSeconds)) {
    segments.push(makeSegment('intro', introStart, introEnd, 'user'));
  }
  if (marks.creditsStart !== undefined) {
    let start = marks.creditsStart;
    if (known && marks.runtime && marks.runtime > 0 && marks.runtime !== durationSeconds) {
      start = durationSeconds - (marks.runtime - marks.creditsStart);
    }
    const end = known ? durationSeconds : start + OPEN_END_SECONDS;
    const afterIntro = introEnd === undefined || start >= introEnd;
    if (start > 0 && end - start >= MIN_LENGTH && afterIntro) {
      segments.push(makeSegment('credits', start, end, 'user'));
    }
  }
  return segments;
};

/** Marks after setting one of them at this time. */
export const setMark = (
  marks: SeasonMarks,
  which: 'introStart' | 'introEnd' | 'creditsStart',
  time: number,
  durationSeconds: number,
): SeasonMarks => {
  const next: SeasonMarks = {...marks, [which]: Math.max(0, time)};
  if (durationSeconds > 0) next.runtime = durationSeconds;
  if (which === 'introStart' && next.introEnd !== undefined && next.introEnd <= time) next.introEnd = undefined;
  if (which === 'introEnd' && next.introStart !== undefined && next.introStart >= time) next.introStart = undefined;
  return next;
};

/** Jellyfin media segments (10.10 and later). Times are in 100 ns ticks. */
const JELLYFIN_KINDS: Record<string, SegmentKind> = {Intro: 'intro', Recap: 'recap', Outro: 'credits', Preview: 'preview'};

export const parseJellyfinSegments = (data: unknown): SkipSegment[] => {
  const items = (data as {Items?: unknown[]})?.Items;
  if (!Array.isArray(items)) return [];
  const result: SkipSegment[] = [];
  for (const item of items as {Type?: string; StartTicks?: number; EndTicks?: number}[]) {
    const kind = item?.Type ? JELLYFIN_KINDS[item.Type] : undefined;
    if (!kind) continue;
    const from = Number(item.StartTicks) / 1e7;
    const to = Number(item.EndTicks) / 1e7;
    if (valid({from, to})) result.push(makeSegment(kind, from, to, 'jellyfin'));
  }
  return result;
};

/** The Jellyfin item id in a /Videos/{id}/stream address. */
export const jellyfinItemIdOf = (url?: string): string | undefined => {
  const match = url?.match(/\/Videos\/([0-9a-fA-F-]{32,36})\/(?:stream|master\.m3u8|main\.m3u8)/);
  return match?.[1];
};

/** The Emby item id in a /Videos/{id}/stream address. Emby ids are usually numbers. */
export const embyItemIdOf = (url?: string): string | undefined => {
  const match = url?.match(/\/Videos\/([0-9A-Za-z-]{1,64})\/(?:stream|master\.m3u8|main\.m3u8)/);
  return match?.[1];
};

type EmbyChapter = {StartPositionTicks?: number; Name?: string; MarkerType?: string};

const INTRO_CHAPTER = /^\s*(intro|opening|op)\s*$/i;
const CREDITS_CHAPTER = /^\s*(credits|end credits|ending|outro|ed)\s*$/i;

/**
 * Emby item details read with Fields=Chapters. Emby's intro detection saves
 * IntroStart, IntroEnd and CreditsStart markers among the chapters; times are
 * in 100 ns ticks. Without markers, chapters named Intro or Credits are used,
 * each running to the next chapter. Credits run to the end of the video.
 */
export const parseEmbyChapters = (data: unknown): SkipSegment[] => {
  const body = (data || {}) as {Chapters?: unknown; RunTimeTicks?: number};
  if (!Array.isArray(body.Chapters)) return [];
  const runtime = Number(body.RunTimeTicks) > 0 ? Number(body.RunTimeTicks) / 1e7 : 0;
  const chapters = (body.Chapters as EmbyChapter[])
    .filter(item => item && Number.isFinite(Number(item.StartPositionTicks)))
    .map(item => ({start: Number(item.StartPositionTicks) / 1e7, name: item.Name || '', type: item.MarkerType || 'Chapter'}))
    .sort((a, b) => a.start - b.start);
  const endOf = (start: number) => (runtime > start ? runtime : start + OPEN_END_SECONDS);
  const result: SkipSegment[] = [];
  const introStart = chapters.find(item => item.type === 'IntroStart');
  const introEnd = chapters.find(item => item.type === 'IntroEnd');
  const creditsStart = chapters.find(item => item.type === 'CreditsStart');
  if (introEnd) {
    const from = introStart && introStart.start < introEnd.start ? introStart.start : 0;
    if (valid({from, to: introEnd.start})) result.push(makeSegment('intro', from, introEnd.start, 'emby'));
  }
  if (creditsStart && creditsStart.start > 0) result.push(makeSegment('credits', creditsStart.start, endOf(creditsStart.start), 'emby'));
  if (result.length) return result;
  // No markers: fall back to chapters named for what they hold.
  const plain = chapters.filter(item => item.type === 'Chapter');
  plain.forEach((chapter, index) => {
    const kind = INTRO_CHAPTER.test(chapter.name) ? 'intro' : CREDITS_CHAPTER.test(chapter.name) ? 'credits' : undefined;
    if (!kind || result.some(segment => segment.kind === kind)) return;
    const next = plain[index + 1]?.start;
    const to = next !== undefined ? next : kind === 'credits' ? endOf(chapter.start) : undefined;
    if (to !== undefined && valid({from: chapter.start, to})) result.push(makeSegment(kind, chapter.start, to, 'emby'));
  });
  return result;
};

/**
 * Plex item details read with includeMarkers=1. Markers of type intro and
 * credits carry their start and end in milliseconds.
 */
export const parsePlexMarkers = (data: unknown): SkipSegment[] => {
  const item = (data as {MediaContainer?: {Metadata?: {Marker?: unknown}[]}})?.MediaContainer?.Metadata?.[0];
  const markers = item?.Marker;
  if (!Array.isArray(markers)) return [];
  const result: SkipSegment[] = [];
  for (const marker of markers as {type?: string; startTimeOffset?: number; endTimeOffset?: number}[]) {
    const kind = marker?.type === 'intro' ? 'intro' : marker?.type === 'credits' ? 'credits' : undefined;
    if (!kind) continue;
    const from = Number(marker.startTimeOffset) / 1000;
    const to = Number(marker.endTimeOffset) / 1000;
    if (valid({from, to}) && !result.some(segment => segment.kind === kind)) result.push(makeSegment(kind, from, to, 'plex'));
  }
  return result;
};

/** IntroDB answer: intro, recap and outro in seconds. Post-credit scenes are left to play. */
export const parseIntroDbSegments = (data: unknown): SkipSegment[] => {
  const body = (data || {}) as Record<string, {start_sec?: number; end_sec?: number} | null | undefined>;
  const pairs: [string, SegmentKind][] = [
    ['intro', 'intro'],
    ['recap', 'recap'],
    ['outro', 'credits'],
  ];
  const result: SkipSegment[] = [];
  for (const [field, kind] of pairs) {
    const entry = body[field];
    const from = Number(entry?.start_sec);
    const to = Number(entry?.end_sec);
    if (entry && valid({from, to})) result.push(makeSegment(kind, from, to, 'introdb'));
  }
  return result;
};
