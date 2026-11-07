// Trakt progress: /sync/playback read into rows, kept per profile, shown in
// "Continue on Trakt", and used as the start position when this device has
// no progress of its own.
import type renderer from 'react-test-renderer';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('../src/components/ui/Text', () => require('react-native').Text);
jest.mock('../src/components/MediaPosterCard', () => (props: any) => {
  const ReactActual = require('react');
  const {Pressable, Text} = require('react-native');
  return ReactActual.createElement(
    Pressable,
    {accessibilityLabel: props.title, onPress: props.onPress, onLongPress: props.onLongPress},
    ReactActual.createElement(Text, null, `${props.title}|${props.subtitle}|${props.cornerTag}|${props.progress}|${props.poster}`),
  );
});

const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, headers: {get: () => null}, json: async () => body, text: async () => JSON.stringify(body)});

const HOUR = 3600_000;
const PLAYBACK = [
  {progress: 42.5, paused_at: '2026-11-06T20:00:00.000Z', id: 11, type: 'movie', movie: {title: 'Heat', year: 1995, ids: {trakt: 1, imdb: 'tt0113277', tmdb: 949}}},
  {
    progress: 30,
    paused_at: '2026-11-07T08:00:00.000Z',
    id: 12,
    type: 'episode',
    episode: {season: 1, number: 3, title: 'In Perpetuity', ids: {trakt: 5}},
    show: {title: 'Severance', year: 2022, ids: {trakt: 2, imdb: 'tt11280740', tmdb: 95396}},
  },
  // An older episode of the same show: only the newest shows.
  {progress: 50, paused_at: '2026-11-01T08:00:00.000Z', id: 13, type: 'episode', episode: {season: 1, number: 2}, show: {title: 'Severance', ids: {imdb: 'tt11280740'}}},
  // Near the end or the start: left out.
  {progress: 99, paused_at: '2026-11-05T08:00:00.000Z', id: 14, type: 'movie', movie: {title: 'Done', ids: {}}},
  {progress: 0.2, paused_at: '2026-11-05T08:00:00.000Z', id: 15, type: 'movie', movie: {title: 'Barely', ids: {}}},
  {progress: 20, id: 16, type: 'episode', episode: {season: 1}, show: {title: 'Broken'}},
];

describe('Trakt progress', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  const load = (connected = true) => {
    const scope = require('../src/lib/profiles/scope');
    scope.saveActiveProfileId('default');
    scope.resetActiveProfileCacheForTests();
    const sync = require('../src/lib/watchSync');
    const progress = require('../src/lib/watchSync/traktProgress');
    sync.watchSyncBaseStorage.clearStore();
    if (connected) {
      sync.updateAccount('trakt', {clientId: 'cid', accessToken: 'a1', refreshToken: 'r1', issuedAt: Date.now(), expiresAt: Date.now() + 20 * HOUR});
    }
    return {scope, sync, progress};
  };

  it('reads Trakt playback into rows, newest first and one per show', () => {
    const {progress} = load();
    const rows = progress.parseTraktPlayback(PLAYBACK);
    expect(rows.map((row: any) => [row.id, row.type, row.title, row.season, row.episode, row.progress])).toEqual([
      ['12', 'series', 'Severance', 1, 3, 30],
      ['11', 'movie', 'Heat', undefined, undefined, 42.5],
    ]);
    expect(rows[0]).toMatchObject({imdbId: 'tt11280740', tmdbId: '95396', episodeTitle: 'In Perpetuity', year: 2022});
    expect(progress.parseTraktPlayback({error: 'x'})).toEqual([]);
  });

  it('asks Trakt at most every few minutes and keeps the last answer when offline', async () => {
    const {progress} = load();
    fetchMock.mockImplementation(() => json(200, PLAYBACK));
    const now = Date.now();
    await expect(progress.refreshTraktPlayback({now})).resolves.toHaveLength(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.trakt.tv/sync/playback?limit=50');
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({Authorization: 'Bearer a1', 'trakt-api-key': 'cid'});
    await progress.refreshTraktPlayback({now: now + 60_000});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('offline')));
    await expect(progress.refreshTraktPlayback({now: now + 20 * 60_000})).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows nothing and asks nothing without a Trakt sign-in', async () => {
    const {progress} = load(false);
    await expect(progress.refreshTraktPlayback({force: true})).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(progress.readTraktPlayback()).toEqual([]);
  });

  it('keeps each profile its own progress', async () => {
    const {scope, sync, progress} = load();
    fetchMock.mockImplementation(() => json(200, PLAYBACK));
    await progress.refreshTraktPlayback({force: true});
    expect(progress.readTraktPlayback()).toHaveLength(2);
    scope.saveActiveProfileId('kidprofile');
    scope.resetActiveProfileCacheForTests();
    expect(progress.readTraktPlayback()).toEqual([]);
    sync.updateAccount('trakt', {accessToken: 'b1'});
    expect(progress.readTraktPlayback()).toEqual([]);
    scope.saveActiveProfileId('default');
    scope.resetActiveProfileCacheForTests();
    expect(progress.readTraktPlayback()).toHaveLength(2);
  });

  it('removes a row on this device only', async () => {
    const {progress} = load();
    fetchMock.mockImplementation(() => json(200, PLAYBACK));
    await progress.refreshTraktPlayback({force: true});
    progress.hideTraktPlayback('11');
    expect(progress.readTraktPlayback().map((row: any) => row.id)).toEqual(['12']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('matches what is playing by id, then by title, season and episode', () => {
    const {progress} = load();
    const rows = progress.parseTraktPlayback(PLAYBACK);
    const match = (meta: any) => progress.traktResumePercent(meta, rows);
    expect(match({title: 'Heat', type: 'movie', imdbId: 'tt0113277'})).toBe(42.5);
    expect(match({title: 'Something else', type: 'movie', tmdbId: '949'})).toBe(42.5);
    expect(match({title: 'heat', type: 'movie', year: 1995})).toBe(42.5);
    expect(match({title: 'Heat', type: 'movie', year: 2020})).toBeUndefined();
    expect(match({title: 'Heat', type: 'movie', imdbId: 'tt9999999'})).toBeUndefined();
    expect(match({title: 'Severance', type: 'series', season: 1, episode: 3})).toBe(30);
    expect(match({title: 'Severance', type: 'series', imdbId: 'tt11280740', season: 1, episode: 4})).toBeUndefined();
    expect(match(undefined)).toBeUndefined();
  });

  it('turns the percent into seconds once the length is known', () => {
    const {progress} = load();
    expect(progress.traktResumeSeconds(42.5, 6000)).toBe(2550);
    expect(progress.traktResumeSeconds(42.5, 0)).toBe(0);
    expect(progress.traktResumeSeconds(undefined, 6000)).toBe(0);
    expect(progress.traktResumeSeconds(0.05, 6000)).toBe(0);
  });
});

describe('Continue on Trakt row', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('leaves out titles already in Continue watching and labels episodes', () => {
    const {withoutLocalTitles, traktSubtitle} = require('../src/components/TraktContinueRow');
    const rows = [
      {id: '1', type: 'movie', title: 'Heat', year: 1995, progress: 40, pausedAt: 2},
      {id: '2', type: 'series', title: 'Severance', season: 1, episode: 3, episodeTitle: 'In Perpetuity', progress: 30, pausedAt: 1},
    ];
    expect(withoutLocalTitles(rows, ['severance']).map((row: any) => row.id)).toEqual(['1']);
    expect(traktSubtitle(rows[1])).toBe('S1 · E3 · In Perpetuity');
    expect(traktSubtitle(rows[0])).toBe('1995');
  });

  it('opens Find streams at the episode with the poster', async () => {
    const React = require('react');
    const {act, create} = require('react-test-renderer');
    const sync = require('../src/lib/watchSync');
    sync.watchSyncBaseStorage.clearStore();
    sync.updateAccount('trakt', {clientId: 'cid', accessToken: 'a1', refreshToken: 'r1', issuedAt: Date.now(), expiresAt: Date.now() + 20 * HOUR});
    (globalThis as any).fetch = jest.fn((url: string) =>
      String(url).includes('api.trakt.tv')
        ? json(200, PLAYBACK)
        : json(200, {meta: {id: 'tt11280740', name: 'Severance', poster: 'https://img.example/sev.jpg'}}),
    );
    const Row = require('../src/components/TraktContinueRow').default;
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = create(React.createElement(Row));
    });
    await act(async () => undefined);
    const card = tree.root.findAll(node => node.props.accessibilityLabel === 'Severance' && node.props.onPress)[0];
    const {Text} = require('react-native');
    const texts = tree.root.findAllByType(Text).map((node: any) => node.props.children);
    expect(texts).toEqual(expect.arrayContaining(['Continue on Trakt', 'Severance|S1 · E3 · In Perpetuity|Trakt|0.3|https://img.example/sev.jpg']));
    act(() => card.props.onPress());
    expect(mockNavigation.navigate).toHaveBeenCalledWith('TorrentsStack', {
      screen: 'StreamFinder',
      initial: false,
      params: {title: 'Severance', type: 'series', year: 2022, imdbId: 'tt11280740', poster: 'https://img.example/sev.jpg', season: 1, episode: 3},
    });
    act(() => tree.unmount());
  });
});

const mockNavigation = {navigate: jest.fn(), getParent: () => undefined};
