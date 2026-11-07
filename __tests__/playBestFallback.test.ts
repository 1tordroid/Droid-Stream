import {
  applyPlayBestFilters,
  buildFallbackList,
  codecOf,
  defaultPlayBestFilters,
  DEFAULT_FALLBACK_TIMEOUTS,
  fallbackReducer,
  initialFallbackState,
  nextSourceMessage,
  passesFilters,
  type FallbackEvent,
  type FallbackState,
} from '../src/lib/streams/fallback';
import {
  demoteFailed,
  FAILURE_TTL_MS,
  forgetFailure,
  pruneFailures,
  recentFailures,
  rememberFailure,
  setFailureStore,
  titleKey,
} from '../src/lib/streams/failedSources';
import type {Candidate} from '../src/lib/streams/finder';

const GB = 1024 ** 3;
const base: Candidate = {id: 'x', kind: 'torrent', title: 'Movie.2024.1080p.WEB.x264', origin: 'o', sizeBytes: 2 * GB, seeders: 50, cachedOn: [], lowQuality: false, languages: [], resolution: '1080p', magnet: 'magnet:?xt=urn:btih:abc', infoHash: 'abc'};
const make = (id: string, patch: Partial<Candidate> = {}): Candidate => ({...base, id, ...patch});
const ids = (list: Candidate[]) => list.map(candidate => candidate.id);

describe('fallback candidate list', () => {
  it('puts debrid-cached first, then direct links, then the rest, keeping the ranking in each group', () => {
    const ranked = [
      make('torrent1'),
      make('direct1', {kind: 'direct', url: 'https://a/1.mp4', magnet: undefined}),
      make('cached1', {cachedOn: ['realdebrid']}),
      make('ready1', {kind: 'direct', url: 'https://rd/1.mkv', debridDirect: true}),
      make('direct2', {kind: 'direct', url: 'https://a/2.mp4', magnet: undefined}),
      make('torrent2'),
      make('cached2', {cachedOn: ['torbox']}),
    ];
    expect(ids(buildFallbackList(ranked))).toEqual(['cached1', 'ready1', 'cached2', 'direct1', 'direct2']);
    expect(ids(buildFallbackList(ranked, {max: 7}))).toEqual(['cached1', 'ready1', 'cached2', 'direct1', 'direct2', 'torrent1', 'torrent2']);
  });

  it('skips torrents nobody seeds and puts recent failures last', () => {
    const ranked = [make('dead', {seeders: 0}), make('a'), make('b', {kind: 'direct', url: 'https://b'}), make('c', {kind: 'direct', url: 'https://c'})];
    expect(ids(buildFallbackList(ranked))).toEqual(['b', 'c', 'a']);
    expect(ids(buildFallbackList(ranked, {failedIds: new Set(['b'])}))).toEqual(['c', 'a', 'b']);
  });
});

describe('Play best filters', () => {
  it('drops sources over the size limit or outside the resolution range', () => {
    const filters = {...defaultPlayBestFilters(), maxSizeGB: 5, minResolution: '720p' as const, maxResolution: '1080p' as const};
    expect(passesFilters(make('ok'), filters)).toBe(true);
    expect(passesFilters(make('big', {sizeBytes: 6 * GB}), filters)).toBe(false);
    expect(passesFilters(make('unknown size', {sizeBytes: 0}), filters)).toBe(true);
    expect(passesFilters(make('4k', {resolution: '2160p'}), filters)).toBe(false);
    expect(passesFilters(make('sd', {resolution: '480p'}), filters)).toBe(false);
    expect(passesFilters(make('no res', {resolution: undefined}), filters)).toBe(true);
  });

  it('keeps everything when the filters would leave nothing', () => {
    const ranked = [make('a', {sizeBytes: 50 * GB}), make('b', {sizeBytes: 60 * GB})];
    expect(ids(applyPlayBestFilters(ranked, {...defaultPlayBestFilters(), maxSizeGB: 2}))).toEqual(['a', 'b']);
  });

  it('moves preferred codecs up and avoided ones down', () => {
    expect(codecOf({title: 'Show.S01E01.1080p.x265-GRP'})).toBe('HEVC');
    expect(codecOf({title: 'Movie 2160p AV1 Opus'})).toBe('AV1');
    const ranked = [make('h264'), make('hevc', {title: 'Movie.1080p.HEVC'}), make('av1', {title: 'Movie.1080p.AV1'})];
    expect(ids(applyPlayBestFilters(ranked, {...defaultPlayBestFilters(), hevc: 'prefer', av1: 'avoid'}))).toEqual(['hevc', 'h264', 'av1']);
    expect(ids(applyPlayBestFilters(ranked, {...defaultPlayBestFilters(), hevc: 'avoid'}))).toEqual(['h264', 'av1', 'hevc']);
    expect(ids(applyPlayBestFilters(ranked))).toEqual(['h264', 'hevc', 'av1']);
  });
});

describe('failure memory', () => {
  const want = {title: 'Movie', imdbId: 'tt1'};
  beforeEach(() => {
    const values = new Map<string, string>();
    setFailureStore({getString: key => values.get(key), setString: (key, value) => values.set(key, value)});
  });
  afterAll(() => setFailureStore(undefined));

  it('remembers failures per title and episode until they expire', () => {
    rememberFailure(want, 'a', 1000);
    rememberFailure({...want, season: 1, episode: 2}, 'b', 1000);
    expect([...recentFailures(want, 2000)]).toEqual(['a']);
    expect([...recentFailures({...want, season: 1, episode: 2}, 2000)]).toEqual(['b']);
    expect(recentFailures(want, 1000 + FAILURE_TTL_MS).size).toBe(0);
  });

  it('forgets a source that played after all', () => {
    rememberFailure(want, 'a', 1000);
    rememberFailure(want, 'b', 1000);
    forgetFailure(want, 'a', 1500);
    expect([...recentFailures(want, 2000)]).toEqual(['b']);
  });

  it('prunes expired entries and keys titles without an IMDb id by name', () => {
    expect(pruneFailures({t1: {a: 0, b: 10}, t2: {c: 0}}, FAILURE_TTL_MS + 5)).toEqual({t1: {b: 10}});
    expect(titleKey({title: 'Some Movie'})).toBe('some movie::');
  });

  it('ranks failed sources last without changing the rest', () => {
    const list = [{id: 'a'}, {id: 'b'}, {id: 'c'}, {id: 'd'}];
    expect(demoteFailed(list, new Set(['a', 'c'])).map(item => item.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(demoteFailed(list, new Set())).toBe(list);
  });
});

describe('fallback state machine', () => {
  const T = DEFAULT_FALLBACK_TIMEOUTS;
  const run = (state: FallbackState, ...events: FallbackEvent[]) => {
    let current = state;
    let last = {state, action: 'none' as const} as ReturnType<typeof fallbackReducer>;
    for (const event of events) {
      last = fallbackReducer(current, event, T);
      current = last.state;
    }
    return last;
  };

  it('moves on when a source errors before playing', () => {
    const result = run(initialFallbackState(3, 0, 0), {type: 'error', now: 100});
    expect(result).toMatchObject({action: 'next', reason: 'error', state: {phase: 'switching', index: 0}});
  });

  it('moves on when no first frame arrives in time; torrents get longer', () => {
    expect(run(initialFallbackState(3, 0, 0), {type: 'tick', now: T.firstFrameMs - 1, position: 0}).action).toBe('none');
    expect(run(initialFallbackState(3, 0, 0), {type: 'tick', now: T.firstFrameMs, position: 0})).toMatchObject({action: 'next', reason: 'no-first-frame'});
    expect(run(initialFallbackState(3, 0, 0, true), {type: 'tick', now: T.firstFrameMs, position: 0}).action).toBe('none');
    expect(run(initialFallbackState(3, 0, 0, true), {type: 'tick', now: T.torrentFirstFrameMs, position: 0}).action).toBe('next');
  });

  it('moves on when a loaded source stays stuck buffering at the start', () => {
    const loaded = run(initialFallbackState(2, 0, 0), {type: 'load', now: 1000}).state;
    expect(loaded.phase).toBe('loaded');
    expect(run(loaded, {type: 'tick', now: 2000, position: 30}, {type: 'tick', now: 1000 + T.startStallMs - 1, position: 30}).action).toBe('none');
    expect(run(loaded, {type: 'tick', now: 2000, position: 30}, {type: 'tick', now: 1000 + T.startStallMs, position: 30})).toMatchObject({action: 'next', reason: 'stalled'});
  });

  it('does not count a paused player as stalled', () => {
    const loaded = run(initialFallbackState(2, 0, 0), {type: 'load', now: 0}).state;
    const result = run(loaded, {type: 'tick', now: 15_000, position: 10, paused: true}, {type: 'tick', now: 30_000, position: 10, paused: true});
    expect(result.action).toBe('none');
  });

  it('stops watching timeouts once playback has moved, but still moves on after an error', () => {
    let state = run(initialFallbackState(2, 0, 0), {type: 'load', now: 0}).state;
    for (let second = 1; second <= 6; second++) state = run(state, {type: 'tick', now: second * 1000, position: 100 + second}).state;
    expect(state.phase).toBe('playing');
    expect(run(state, {type: 'tick', now: 600_000, position: 106}).action).toBe('none');
    expect(run(state, {type: 'error', now: 700_000}).action).toBe('next');
  });

  it('ignores a seek jump as playback progress', () => {
    const loaded = run(initialFallbackState(2, 0, 0), {type: 'load', now: 0}).state;
    const result = run(loaded, {type: 'tick', now: 1000, position: 0}, {type: 'tick', now: 2000, position: 600});
    expect(result.state.playedMs).toBe(0);
    expect(result.state.phase).toBe('loaded');
  });

  it('ignores stale errors while switching and reports when the list is used up', () => {
    const switching = run(initialFallbackState(2, 0, 0), {type: 'error', now: 0}).state;
    expect(run(switching, {type: 'error', now: 10}).action).toBe('none');
    const second = run(switching, {type: 'start', now: 20, index: 1}).state;
    expect(second).toMatchObject({phase: 'starting', index: 1});
    expect(run(second, {type: 'error', now: 30})).toMatchObject({action: 'exhausted', state: {phase: 'exhausted'}});
  });

  it('counts a source that cannot be resolved as failed', () => {
    const switching = {...run(initialFallbackState(3, 0, 0), {type: 'error', now: 0}).state, index: 1};
    expect(run(switching, {type: 'resolveFailed', now: 5})).toMatchObject({action: 'next', reason: 'unavailable'});
  });

  it('hands control back when the user picks a source', () => {
    const off = run(initialFallbackState(3, 0, 0), {type: 'userPicked', now: 0}).state;
    expect(off.phase).toBe('off');
    expect(run(off, {type: 'error', now: 1}).action).toBe('none');
    expect(initialFallbackState(0).phase).toBe('off');
  });

  it('words the toast with the position in the list', () => {
    expect(nextSourceMessage(1, 5)).toBe('Trying next source (2/5)');
  });
});
