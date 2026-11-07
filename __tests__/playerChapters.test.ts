import {
  chapterIndexAt,
  chapterKind,
  chaptersToSegments,
  isGenericChapterTitle,
  nextChapterStart,
  normalizeChapters,
  parseMediaBrowserChapters,
  parsePlexChapters,
  parseProbeChapters,
  previousChapterStart,
} from '../src/lib/player/chapters';
import {gatherSegments, NO_FETCHED_SEGMENTS} from '../src/lib/playback/skipSources';
import {isProbeableSource} from '../src/lib/player/playerTools';

describe('chapter model', () => {
  it('sorts, drops duplicates and fills ends from the next chapter and the runtime', () => {
    const chapters = normalizeChapters(
      [
        {start: 600, title: 'Act 2'},
        {start: 0, title: ''},
        {start: 0.2, title: 'dup'},
        {start: 1200, title: 'Credits'},
        {start: 5000, title: 'past the end'},
      ],
      1500,
    );
    expect(chapters.map(c => [c.start, c.end, c.title])).toEqual([
      [0, 600, 'Chapter 1'],
      [600, 1200, 'Act 2'],
      [1200, 1500, 'Credits'],
    ]);
  });

  it('gives nothing for a single chapter', () => {
    expect(normalizeChapters([{start: 0, title: 'Only'}], 100)).toEqual([]);
  });

  it('navigates like a CD player', () => {
    const chapters = normalizeChapters([{start: 0, title: 'A'}, {start: 100, title: 'B'}, {start: 200, title: 'C'}], 300);
    expect(chapterIndexAt(chapters, 150)).toBe(1);
    expect(nextChapterStart(chapters, 150)).toBe(200);
    expect(nextChapterStart(chapters, 250)).toBeUndefined();
    // More than 3 s in: back to the start of this chapter.
    expect(previousChapterStart(chapters, 150)).toBe(100);
    // Just started: the one before.
    expect(previousChapterStart(chapters, 101)).toBe(0);
    expect(previousChapterStart(chapters, 1)).toBe(0);
  });

  it('knows generic names and named kinds', () => {
    expect(isGenericChapterTitle('Chapter 03')).toBe(true);
    expect(isGenericChapterTitle('00:05:00.000')).toBe(true);
    expect(isGenericChapterTitle('The Heist')).toBe(false);
    expect(chapterKind('Opening')).toBe('intro');
    expect(chapterKind('OP')).toBe('intro');
    expect(chapterKind('Intro')).toBe('intro');
    expect(chapterKind('Previously on')).toBe('recap');
    expect(chapterKind('Ending')).toBe('credits');
    expect(chapterKind('End Credits')).toBe('credits');
    expect(chapterKind('Preview')).toBe('preview');
    expect(chapterKind('Introduction to physics class')).toBeUndefined();
    expect(chapterKind('The Opening Night')).toBeUndefined();
  });

  it('turns named chapters into skip segments, first of each kind', () => {
    const chapters = normalizeChapters(
      [
        {start: 0, title: 'Prologue'},
        {start: 90, title: 'Opening'},
        {start: 180, title: 'Part A'},
        {start: 1300, title: 'Ending'},
        {start: 1390, title: 'Preview'},
      ],
      1420,
    );
    const segments = chaptersToSegments(chapters, 1420);
    expect(segments.map(s => [s.kind, s.from, s.to, s.source])).toEqual([
      ['intro', 90, 180, 'chapters'],
      ['credits', 1300, 1390, 'chapters'],
      ['preview', 1390, 1420, 'chapters'],
    ]);
  });

  it('ranks chapters after server markers and before AniSkip in the skip sources', () => {
    const chapters = chaptersToSegments(normalizeChapters([{start: 0, title: 'Cold open'}, {start: 60, title: 'Intro'}, {start: 150, title: 'Story'}], 1400), 1400);
    const withServer = gatherSegments({
      provider: [],
      fetched: {...NO_FETCHED_SEGMENTS, jellyfin: [{title: 'Intro', kind: 'intro', from: 50, to: 140, source: 'jellyfin'}], aniskip: []},
      chapters,
      marks: {},
      durationSeconds: 1400,
    });
    expect(withServer.filter(s => s.kind === 'intro').map(s => s.source)).toEqual(['jellyfin']);
    const chaptersOnly = gatherSegments({
      provider: [],
      fetched: {...NO_FETCHED_SEGMENTS, aniskip: [{title: 'Intro', kind: 'intro', from: 70, to: 160, source: 'aniskip'}]},
      chapters,
      marks: {},
      durationSeconds: 1400,
    });
    expect(chaptersOnly.filter(s => s.kind === 'intro').map(s => [s.source, s.from])).toEqual([['chapters', 60]]);
  });
});

describe('chapter sources', () => {
  it('reads Jellyfin and Emby chapters with image addresses, skipping Emby markers', () => {
    const chapters = parseMediaBrowserChapters(
      {
        RunTimeTicks: 30000000000,
        Chapters: [
          {StartPositionTicks: 0, Name: 'Start', ImageTag: 'abc'},
          {StartPositionTicks: 600000000, Name: 'IntroEnd', MarkerType: 'IntroEnd'},
          {StartPositionTicks: 1200000000, Name: 'Middle'},
        ],
      },
      'https://jf.example/',
      'item1',
    );
    expect(chapters.map(c => [c.start, c.end, c.title])).toEqual([
      [0, 120, 'Start'],
      [120, 3000, 'Middle'],
    ]);
    expect(chapters[0].thumbnail).toBe('https://jf.example/Items/item1/Images/Chapter/0?tag=abc&maxWidth=320');
    expect(chapters[1].thumbnail).toBeUndefined();
  });

  it('reads Plex chapters with the token on the image', () => {
    const chapters = parsePlexChapters(
      {
        MediaContainer: {
          Metadata: [
            {
              duration: 1000000,
              Chapter: [
                {tag: 'One', startTimeOffset: 0, endTimeOffset: 400000, thumb: '/library/media/1/chapterImages/1'},
                {tag: 'Two', startTimeOffset: 400000, endTimeOffset: 1000000},
              ],
            },
          ],
        },
      },
      'http://plex:32400',
      'tok',
    );
    expect(chapters.map(c => [c.start, c.end, c.title])).toEqual([
      [0, 400, 'One'],
      [400, 1000, 'Two'],
    ]);
    expect(chapters[0].thumbnail).toBe('http://plex:32400/library/media/1/chapterImages/1?X-Plex-Token=tok');
  });

  it('reads FFprobe chapters', () => {
    expect(parseProbeChapters([{start: 0, end: 10, title: 'a'}, {start: '10.5', end: -1, title: ''}], 20).map(c => [c.start, c.end, c.title])).toEqual([
      [0, 10, 'a'],
      [10.5, 20, 'Chapter 2'],
    ]);
    expect(parseProbeChapters(null)).toEqual([]);
  });

  it('only probes files and plain media addresses', () => {
    expect(isProbeableSource('https://x/video.mkv')).toBe(true);
    expect(isProbeableSource('/storage/emulated/0/a.mp4')).toBe(true);
    expect(isProbeableSource('content://media/1')).toBe(true);
    expect(isProbeableSource('https://x/master.m3u8')).toBe(false);
    expect(isProbeableSource('https://x/play', 'mpd')).toBe(false);
    expect(isProbeableSource('magnet:?xt=urn')).toBe(false);
  });
});
