/**
 * Chapters of what is playing: read from the file (Matroska and MP4 chapters,
 * through FFprobe) or from the viewer's Jellyfin, Emby or Plex server. The
 * model here touches no storage and no network.
 */
import {makeSegment, type SegmentKind, type SkipSegment} from '../playback/skipSegmentModel';

export interface Chapter {
  /** Seconds from the start. */
  start: number;
  /** Seconds; the next chapter's start or the runtime when the source gave none. */
  end?: number;
  title: string;
  /** Image of the chapter, when the server has one. */
  thumbnail?: string;
}

export type ChapterSource = 'file' | 'jellyfin' | 'emby' | 'plex';

/** Names muxers give chapters by default ("Chapter 1", "Chapter 01", "00:05:00.000"). */
const GENERIC_TITLE = /^\s*(chapter|chapitre|kapitel|cap[ií]tulo|capitolo|hoofdstuk)?\s*\d+\s*$|^\s*\d{1,2}:\d{2}(:\d{2})?([.,]\d+)?\s*$/i;

export const isGenericChapterTitle = (title: string): boolean => !title.trim() || GENERIC_TITLE.test(title);

/**
 * Sorted chapters with known ends. Duplicates (within half a second) and
 * entries past the runtime are dropped. Fewer than two chapters give [], since
 * one chapter covering the whole video says nothing.
 */
export const normalizeChapters = (items: (Partial<Chapter> | null | undefined)[], durationSeconds = 0): Chapter[] => {
  const sorted = items
    .filter((item): item is Partial<Chapter> => Boolean(item) && Number.isFinite(Number(item!.start)) && Number(item!.start) >= 0)
    .map(item => ({
      start: Number(item.start),
      end: Number.isFinite(Number(item.end)) && Number(item.end) > Number(item.start) ? Number(item.end) : undefined,
      title: String(item.title || '').trim(),
      thumbnail: item.thumbnail || undefined,
    }))
    .filter(item => durationSeconds <= 0 || item.start < durationSeconds - 0.5)
    .sort((a, b) => a.start - b.start);
  const unique: Chapter[] = [];
  for (const item of sorted) {
    if (unique.length && item.start - unique[unique.length - 1].start < 0.5) continue;
    unique.push(item);
  }
  if (unique.length < 2) return [];
  return unique.map((item, index) => {
    const next = unique[index + 1]?.start;
    const end = next !== undefined ? Math.min(item.end ?? next, next) : item.end ?? (durationSeconds > 0 ? durationSeconds : undefined);
    return {
      ...item,
      end,
      title: item.title || `Chapter ${index + 1}`,
    };
  });
};

/** Index of the chapter playing at [time], or -1 before the first one. */
export const chapterIndexAt = (chapters: Chapter[], time: number): number => {
  let found = -1;
  for (let index = 0; index < chapters.length; index++) {
    if (chapters[index].start <= time + 0.25) found = index;
    else break;
  }
  return found;
};

/** Where "next chapter" goes, or undefined at the last one. */
export const nextChapterStart = (chapters: Chapter[], time: number): number | undefined =>
  chapters.find(chapter => chapter.start > time + 1)?.start;

/**
 * Where "previous chapter" goes: the start of this chapter, or of the one
 * before when this one started less than 3 seconds ago (like a CD player).
 */
export const previousChapterStart = (chapters: Chapter[], time: number): number | undefined => {
  const index = chapterIndexAt(chapters, time);
  if (index < 0) return undefined;
  if (time - chapters[index].start > 3 || index === 0) return chapters[index].start;
  return chapters[index - 1].start;
};

const KIND_PATTERNS: [SegmentKind, RegExp][] = [
  ['recap', /^\s*(recap|previously( on)?.*|zusammenfassung|r[ée]sum[ée])\s*$/i],
  ['intro', /^\s*(intro|introduction|opening( credits| theme| song)?|op|title sequence|main titles?)\s*\d*\s*$/i],
  ['credits', /^\s*(credits|end credits|ending( credits| theme| song)?|outro|ed|closing( credits)?|abspann|g[ée]n[ée]rique( de fin)?)\s*\d*\s*$/i],
  ['preview', /^\s*(preview|next episode( preview)?|next time.*|trailer|yokoku)\s*$/i],
];

export const chapterKind = (title: string): SegmentKind | undefined =>
  KIND_PATTERNS.find(([, pattern]) => pattern.test(title))?.[0];

/**
 * Chapters named Intro, Opening, Recap, Credits, Ending or Preview as skip
 * segments. Only the first of each kind is used. Credits without a known end
 * run to the runtime.
 */
export const chaptersToSegments = (chapters: Chapter[], durationSeconds = 0): SkipSegment[] => {
  const result: SkipSegment[] = [];
  chapters.forEach(chapter => {
    const kind = chapterKind(chapter.title);
    if (!kind || result.some(segment => segment.kind === kind)) return;
    const end = chapter.end ?? (durationSeconds > 0 ? durationSeconds : undefined);
    if (end === undefined || end - chapter.start < 1) return;
    result.push(makeSegment(kind, chapter.start, end, 'chapters'));
  });
  return result;
};

// Server answers

type MediaBrowserChapter = {StartPositionTicks?: number; Name?: string; ImageTag?: string; MarkerType?: string};

/**
 * Jellyfin and Emby item details read with Fields=Chapters. Times are 100 ns
 * ticks. Emby's IntroStart/IntroEnd/CreditsStart markers are not chapters.
 */
export const parseMediaBrowserChapters = (data: unknown, root: string, itemId: string): Chapter[] => {
  const body = (data || {}) as {Chapters?: unknown; RunTimeTicks?: number};
  if (!Array.isArray(body.Chapters)) return [];
  const runtime = Number(body.RunTimeTicks) > 0 ? Number(body.RunTimeTicks) / 1e7 : 0;
  const base = root.replace(/\/+$/, '');
  const chapters = (body.Chapters as MediaBrowserChapter[]).map((item, index) => {
    if (!item || (item.MarkerType && item.MarkerType !== 'Chapter')) return null;
    const start = Number(item.StartPositionTicks) / 1e7;
    const thumbnail = item.ImageTag
      ? `${base}/Items/${encodeURIComponent(itemId)}/Images/Chapter/${index}?tag=${encodeURIComponent(item.ImageTag)}&maxWidth=320`
      : undefined;
    return {start, title: item.Name || '', thumbnail};
  });
  return normalizeChapters(chapters, runtime);
};

type PlexChapter = {tag?: string; startTimeOffset?: number; endTimeOffset?: number; thumb?: string};

/** Plex item details read with includeChapters=1. Offsets are milliseconds. */
export const parsePlexChapters = (data: unknown, root: string, token: string): Chapter[] => {
  const item = (data as {MediaContainer?: {Metadata?: {Chapter?: unknown; duration?: number}[]}})?.MediaContainer?.Metadata?.[0];
  if (!item || !Array.isArray(item.Chapter)) return [];
  const base = root.replace(/\/+$/, '');
  const duration = Number(item.duration) > 0 ? Number(item.duration) / 1000 : 0;
  const chapters = (item.Chapter as PlexChapter[]).map(chapter => ({
    start: Number(chapter?.startTimeOffset) / 1000,
    end: Number(chapter?.endTimeOffset) / 1000,
    title: chapter?.tag || '',
    thumbnail: chapter?.thumb
      ? `${chapter.thumb.startsWith('http') ? chapter.thumb : base + chapter.thumb}${chapter.thumb.includes('?') ? '&' : '?'}X-Plex-Token=${encodeURIComponent(token)}`
      : undefined,
  }));
  return normalizeChapters(chapters, duration);
};

/** FFprobe's chapters (start_time and end_time are seconds as strings). */
export const parseProbeChapters = (items: unknown, durationSeconds = 0): Chapter[] => {
  if (!Array.isArray(items)) return [];
  return normalizeChapters(
    items.map(item => {
      const entry = (item || {}) as {start?: number | string; end?: number | string; title?: string};
      return {start: Number(entry.start), end: Number(entry.end), title: entry.title || ''};
    }),
    durationSeconds,
  );
};
