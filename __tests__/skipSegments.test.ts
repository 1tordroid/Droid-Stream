import {
  actionFor,
  DEFAULT_SKIP_MODES,
  fromIntervals,
  isEndSegment,
  jellyfinItemIdOf,
  kindFromTitle,
  makeSegment,
  marksToSegments,
  mergeSegments,
  OPEN_END_SECONDS,
  parseIntroDbSegments,
  parseJellyfinSegments,
  segmentAt,
  setMark,
  skipLabel,
  withoutOff,
} from '../src/lib/playback/skipSegmentModel';
import {
  findJellyfinItem,
  gatherSegments,
  getSkipModes,
  NO_FETCHED_SEGMENTS,
  readCachedSegments,
  readSeasonMarks,
  setSkipMode,
  writeCachedSegments,
  writeSeasonMarks,
} from '../src/lib/playback/skipSources';
import type {SavedSource} from '../src/lib/sources/vault';

describe('kindFromTitle', () => {
  it('reads provider titles', () => {
    expect(kindFromTitle('Intro')).toBe('intro');
    expect(kindFromTitle('Opening')).toBe('intro');
    expect(kindFromTitle(undefined)).toBe('intro');
    expect(kindFromTitle('Recap')).toBe('recap');
    expect(kindFromTitle('Credits')).toBe('credits');
    expect(kindFromTitle('Outro')).toBe('credits');
    expect(kindFromTitle('Ending')).toBe('credits');
    expect(kindFromTitle('Preview')).toBe('preview');
  });
});

describe('fromIntervals', () => {
  it('drops broken entries and duplicates', () => {
    const segments = fromIntervals(
      [
        {title: 'Intro', from: 10, to: 90},
        {title: 'Intro', from: 10.4, to: 90.2},
        {title: 'Bad', from: 50, to: 20},
        {title: 'Bad', from: -1, to: 20},
        null,
        {title: 'Credits', from: 1300, to: 1400},
      ],
      'provider',
    );
    expect(segments.map(s => [s.kind, s.from, s.to])).toEqual([
      ['intro', 10, 90],
      ['credits', 1300, 1400],
    ]);
  });
});

describe('mergeSegments', () => {
  it('takes each kind from the first source that has it', () => {
    const provider = [makeSegment('intro', 5, 60, 'provider')];
    const jellyfin = [makeSegment('intro', 0, 50, 'jellyfin'), makeSegment('credits', 1300, 1400, 'jellyfin')];
    const aniskip = [makeSegment('credits', 1310, 1390, 'aniskip'), makeSegment('recap', 60, 120, 'aniskip')];
    const merged = mergeSegments([provider, jellyfin, aniskip]);
    expect(merged.map(s => [s.kind, s.source])).toEqual([
      ['intro', 'provider'],
      ['recap', 'aniskip'],
      ['credits', 'jellyfin'],
    ]);
  });

  it('drops a lower source that overlaps a kept segment', () => {
    const merged = mergeSegments([[makeSegment('intro', 0, 90, 'provider')], [makeSegment('recap', 30, 100, 'introdb')]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe('intro');
  });

  it('cuts to the runtime and drops what lies past it', () => {
    const merged = mergeSegments(
      [[makeSegment('intro', 0, 60, 'provider'), makeSegment('credits', 1300, 9999, 'provider'), makeSegment('preview', 1500, 1600, 'provider')]],
      1400,
    );
    expect(merged.map(s => [s.kind, s.to])).toEqual([
      ['intro', 60],
      ['credits', 1400],
    ]);
  });

  it('keeps the order by start time', () => {
    const merged = mergeSegments([[makeSegment('credits', 1300, 1400, 'provider')], [makeSegment('intro', 0, 60, 'user')]]);
    expect(merged.map(s => s.kind)).toEqual(['intro', 'credits']);
  });
});

describe('selection', () => {
  const segments = [makeSegment('intro', 10, 70, 'provider'), makeSegment('credits', 1300, 1400, 'provider')];

  it('finds the segment at a time', () => {
    expect(segmentAt(segments, 9)).toBeUndefined();
    expect(segmentAt(segments, 10)?.kind).toBe('intro');
    expect(segmentAt(segments, 69.9)?.kind).toBe('intro');
    expect(segmentAt(segments, 70)).toBeUndefined();
    expect(segmentAt(segments, 1350)?.kind).toBe('credits');
  });

  it('leaves out kinds set to Off', () => {
    expect(withoutOff(segments, {...DEFAULT_SKIP_MODES, credits: 'off'}).map(s => s.kind)).toEqual(['intro']);
  });

  it('auto skips once, then shows the button', () => {
    const modes = {...DEFAULT_SKIP_MODES, intro: 'auto' as const};
    expect(actionFor(segments[0], modes, false)).toBe('auto');
    expect(actionFor(segments[0], modes, true)).toBe('button');
    expect(actionFor(segments[1], modes, false)).toBe('button');
    expect(actionFor(undefined, modes, false)).toBe('none');
    expect(actionFor(segments[0], {...modes, intro: 'off'}, false)).toBe('none');
  });

  it('knows credits that run to the end', () => {
    expect(isEndSegment(segments[1], 1400)).toBe(true);
    expect(isEndSegment(segments[1], 1500)).toBe(false);
    expect(isEndSegment(segments[0], 70)).toBe(false);
    expect(isEndSegment(makeSegment('credits', 1300, 1300 + OPEN_END_SECONDS, 'user'), 0)).toBe(true);
  });

  it('labels the button', () => {
    expect(skipLabel(segments[0])).toBe('Skip intro');
    expect(skipLabel(segments[1])).toBe('Skip credits');
    expect(skipLabel({title: 'Skip opening'})).toBe('Skip opening');
  });
});

describe('season marks', () => {
  it('keeps the intro at the same time and credits at the same distance from the end', () => {
    const marks = {introStart: 30, introEnd: 100, creditsStart: 1300, runtime: 1400};
    const segments = marksToSegments(marks, 1460);
    expect(segments.map(s => [s.kind, s.from, s.to])).toEqual([
      ['intro', 30, 100],
      ['credits', 1360, 1460],
    ]);
  });

  it('uses the marks as they are when the runtime matches or is unknown', () => {
    expect(marksToSegments({introEnd: 90, creditsStart: 1300, runtime: 1400}, 1400).map(s => [s.from, s.to])).toEqual([
      [0, 90],
      [1300, 1400],
    ]);
    const open = marksToSegments({creditsStart: 1300, runtime: 1400}, 0);
    expect(open[0].from).toBe(1300);
    expect(open[0].to).toBe(1300 + OPEN_END_SECONDS);
  });

  it('drops marks that fall outside the runtime', () => {
    expect(marksToSegments({introEnd: 400}, 300)).toEqual([]);
    // A short episode puts the credits before the start.
    expect(marksToSegments({creditsStart: 100, runtime: 2400}, 600)).toEqual([]);
    // Credits that would land inside the intro are dropped, the intro stays.
    expect(marksToSegments({introEnd: 200, creditsStart: 2250, runtime: 2400}, 300).map(s => s.kind)).toEqual(['intro']);
  });

  it('sets marks in order', () => {
    let marks = setMark({}, 'introStart', 20, 1400);
    marks = setMark(marks, 'introEnd', 95, 1400);
    expect(marks).toEqual({introStart: 20, introEnd: 95, runtime: 1400});
    // An end before the start clears the start.
    expect(setMark(marks, 'introEnd', 10, 1400).introStart).toBeUndefined();
    // A start after the end clears the end.
    expect(setMark(marks, 'introStart', 120, 1400).introEnd).toBeUndefined();
    expect(setMark(marks, 'creditsStart', 1320, 0).runtime).toBe(1400);
  });

  it('are stored per show and season', () => {
    writeSeasonMarks('Show', 1, {introEnd: 80, runtime: 1400});
    expect(readSeasonMarks('show', 1).introEnd).toBe(80);
    expect(readSeasonMarks('Show', 2).introEnd).toBeUndefined();
  });
});

describe('parsers', () => {
  it('reads Jellyfin media segments', () => {
    const segments = parseJellyfinSegments({
      Items: [
        {Type: 'Intro', StartTicks: 0, EndTicks: 900000000},
        {Type: 'Outro', StartTicks: 13000000000, EndTicks: 14000000000},
        {Type: 'Commercial', StartTicks: 1, EndTicks: 2},
        {Type: 'Recap', StartTicks: 50, EndTicks: 10},
      ],
    });
    expect(segments.map(s => [s.kind, s.from, s.to, s.source])).toEqual([
      ['intro', 0, 90, 'jellyfin'],
      ['credits', 1300, 1400, 'jellyfin'],
    ]);
    expect(parseJellyfinSegments({})).toEqual([]);
  });

  it('reads IntroDB answers and leaves post-credit scenes alone', () => {
    const segments = parseIntroDbSegments({
      intro: {start_sec: 2.5, end_sec: 58},
      recap: null,
      outro: {start_sec: 3631.5, end_sec: 3699.5},
      post_credits: {start_sec: 3700, end_sec: 3720},
    });
    expect(segments.map(s => [s.kind, s.from, s.to])).toEqual([
      ['intro', 2.5, 58],
      ['credits', 3631.5, 3699.5],
    ]);
  });

  it('finds the Jellyfin item behind a stream', () => {
    const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    expect(jellyfinItemIdOf(`https://media.example.com/Videos/${id}/stream?static=true&ApiKey=x`)).toBe(id);
    expect(jellyfinItemIdOf('https://example.com/video.mkv')).toBeUndefined();
    const source = {id: 's1', kind: 'jellyfin', name: 'Home', server: 'https://media.example.com/', username: 'u', secret: 't'} as SavedSource;
    const other = {...source, id: 's2', server: 'https://other.example.com'} as SavedSource;
    expect(findJellyfinItem([`https://media.example.com/Videos/${id}/stream`], [other, source])).toEqual({source, itemId: id});
    expect(findJellyfinItem([`https://media.example.com/Videos/${id}/stream`], [{...source, kind: 'emby'} as SavedSource])).toBeUndefined();
  });
});

describe('sources', () => {
  it('puts the provider first and marks last', () => {
    const merged = gatherSegments({
      provider: [{title: 'Intro', from: 0, to: 60}],
      fetched: {...NO_FETCHED_SEGMENTS, introdb: [makeSegment('intro', 5, 70, 'introdb'), makeSegment('credits', 1300, 1390, 'introdb')]},
      marks: {introEnd: 80, creditsStart: 1250, runtime: 1400},
      durationSeconds: 1400,
    });
    expect(merged.map(s => [s.kind, s.source])).toEqual([
      ['intro', 'provider'],
      ['credits', 'introdb'],
    ]);
  });

  it('falls back to the marks', () => {
    const merged = gatherSegments({provider: [], fetched: NO_FETCHED_SEGMENTS, marks: {introEnd: 80}, durationSeconds: 1400});
    expect(merged.map(s => [s.kind, s.source, s.to])).toEqual([['intro', 'user', 80]]);
  });

  it('caches fetched times until they expire', () => {
    const found = [makeSegment('intro', 0, 60, 'jellyfin')];
    writeCachedSegments('a', found, 1000);
    expect(readCachedSegments('a', 2000)).toEqual(found);
    expect(readCachedSegments('a', 1000 + 8 * 24 * 60 * 60 * 1000)).toBeUndefined();
    writeCachedSegments('b', [], 1000);
    expect(readCachedSegments('b', 1000 + 2 * 60 * 60 * 1000)).toEqual([]);
    expect(readCachedSegments('b', 1000 + 25 * 60 * 60 * 1000)).toBeUndefined();
  });

  it('stores the skip mode per kind', () => {
    expect(getSkipModes()).toEqual(DEFAULT_SKIP_MODES);
    setSkipMode('intro', 'auto');
    setSkipMode('preview', 'off');
    expect(getSkipModes()).toEqual({...DEFAULT_SKIP_MODES, intro: 'auto', preview: 'off'});
  });
});
