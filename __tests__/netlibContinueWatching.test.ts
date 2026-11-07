// Continue watching for library titles: resume, next episode at 85%, movie
// parts, finished titles, removed rows, and next-episode streams in the player.
jest.mock('../src/lib/sources/smb', () => ({
  openSmbStream: jest.fn(),
  listSmbShare: jest.fn(),
  canStreamSmb: () => false,
  normalizeSmbPath: (path: string) => path,
}));

import {netlibContinueWatchingRows, netlibResume} from '../src/lib/netlib/continueWatching';
import {getNetlibHistorySnapshot, hideNetlibHistory, readNetlibHistory, saveNetlibHistory} from '../src/lib/netlib/history';
import {netlibPlayerParams} from '../src/lib/netlib/playback';
import type {NetlibItem} from '../src/lib/netlib/types';

const show: NetlibItem = {
  id: 'w|show|dark|',
  sourceId: 'w',
  kind: 'show',
  title: 'Dark',
  versions: [],
  episodes: [
    {season: 0, episode: 1, versions: [{key: 'k0', name: 'special.mkv'}]},
    {season: 1, episode: 1, versions: [{key: 'k1', name: 'e1.mkv'}, {key: 'k1-720', name: 'e1.720p.mkv'}]},
    {season: 1, episode: 2, versions: [{key: 'k2', name: 'e2.mkv'}]},
  ],
  added: 0,
  match: {type: 'series', title: 'Dark', poster: 'p.jpg'},
};

const movie: NetlibItem = {
  id: 'w|movie|seven samurai|1954',
  sourceId: 'w',
  kind: 'movie',
  title: 'Seven Samurai',
  year: 1954,
  versions: [{key: 'cd1', name: 'cd1.avi', part: 1}, {key: 'cd2', name: 'cd2.avi', part: 2}],
  episodes: [],
  added: 0,
};

const entry = (itemId: string, key: string, position: number, duration = 100) => ({itemId, key, position, duration, updatedAt: 5});
const none = () => undefined;

describe('netlib continue watching', () => {
  it('resumes the file left part way, in any of its versions', () => {
    expect(netlibResume(show, none, entry(show.id, 'k1-720', 40))).toMatchObject({mode: 'resume', key: 'k1-720', position: 40, remainingSeconds: 60});
  });

  it('moves to the next episode past 85%, skipping watched ones, specials last', () => {
    expect(netlibResume(show, none, entry(show.id, 'k1', 90))).toMatchObject({mode: 'next', key: 'k2', episode: {season: 1, episode: 2}});
    const watched = (key: string) => (key === 'k2' ? {position: 99, duration: 100} : undefined);
    expect(netlibResume(show, watched, entry(show.id, 'k1', 90))).toMatchObject({mode: 'next', key: 'k0'});
    const all = () => ({position: 99, duration: 100});
    expect(netlibResume(show, all, entry(show.id, 'k1', 90))).toMatchObject({mode: 'start', finished: true});
  });

  it('plays a split movie part by part', () => {
    expect(netlibResume(movie, none, entry(movie.id, 'cd1', 95))).toMatchObject({mode: 'next', key: 'cd2'});
    expect(netlibPlayerParams(movie, 'cd2')).toMatchObject({linkIndex: 1, episodeList: [{link: 'cd1'}, {link: 'cd2'}], netlib: true, providerValue: 'netlib'});
    expect(netlibPlayerParams(show, 'k2')).toMatchObject({linkIndex: 2, secondaryTitle: 'Season 1', type: 'series'});
  });

  it('builds rows from history and leaves out finished, removed and missing titles', () => {
    const items: Record<string, NetlibItem> = {[show.id]: show, [movie.id]: movie};
    const rows = netlibContinueWatchingRows(
      [entry(show.id, 'k1', 90), entry(movie.id, 'cd2', 99), entry('gone', 'x', 10), {...entry(show.id, 'k2', 10), hidden: true}],
      id => items[id],
      none,
    );
    expect(rows).toEqual([
      expect.objectContaining({
        id: `netlib:i:${encodeURIComponent(show.id)}`,
        providerValue: 'netlib',
        title: 'Dark',
        episodeTitle: 'S1 E2',
        episode: {id: 'k2', link: 'k2', title: 'S1 E2'},
        poster: 'p.jpg',
        position: 0,
      }),
    ]);
  });

  it('keeps history newest first, hides on remove and shows again on play', () => {
    saveNetlibHistory('a', 'ka', 10, 100, 1);
    saveNetlibHistory('b', 'kb', 10, 100, 2);
    const before = getNetlibHistorySnapshot();
    expect(getNetlibHistorySnapshot()).toBe(before);
    hideNetlibHistory('a');
    expect(getNetlibHistorySnapshot()).not.toBe(before);
    expect(readNetlibHistory().map(item => [item.itemId, Boolean(item.hidden)])).toEqual([['b', false], ['a', true]]);
    saveNetlibHistory('a', 'ka', 20, 100, 3);
    expect(readNetlibHistory()[0]).toMatchObject({itemId: 'a', position: 20});
    expect(readNetlibHistory()[0].hidden).toBeUndefined();
  });

  it('opens the next library episode in the player through the stream list', async () => {
    const {saveSource} = require('../src/lib/sources/vault');
    const {versionKey} = require('../src/lib/netlib/ids');
    const {fetchStreamList} = require('../src/lib/hooks/useStream');
    saveSource({id: 'dav', kind: 'webdav', name: 'DAV', server: 'https://dav.local', username: 'u', secret: 'p'});
    const key = versionKey('dav', 'https://dav.local/Dark/e2.mkv');
    const first = {link: versionKey('dav', 'https://dav.local/Dark/e1.mkv'), title: 'S1 E1'};
    const routeParams = {netlib: true, linkIndex: 0, episodeList: [first, {link: key, title: 'S1 E2'}], initialStream: {server: 'Library', link: 'https://dav.local/Dark/e1.mkv', type: 'mkv'}};
    const streams = await fetchStreamList({episode: {link: key, title: 'S1 E2'}, routeParams, provider: 'netlib'});
    expect(streams).toEqual([{server: 'Library', link: 'https://dav.local/Dark/e2.mkv', type: 'mkv', headers: {Authorization: expect.stringMatching(/^Basic /)}}]);
    expect(await fetchStreamList({episode: first, routeParams, provider: 'netlib'})).toEqual([routeParams.initialStream]);
  });
});
