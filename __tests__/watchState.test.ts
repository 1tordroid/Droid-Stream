import {buildWatchStateMap, withoutWatched} from '../src/lib/watchState';
import type {ContinueWatchingItem} from '../src/lib/zustand/continueWatchingStore';

const item = (infoUrl: string, type: string, position: number, duration: number) =>
  ({
    id: infoUrl,
    infoUrl,
    title: infoUrl,
    type,
    position,
    duration,
    providerValue: 'p',
    episode: {title: 'e', link: `${infoUrl}/e`},
    updatedAt: 1,
  }) as ContinueWatchingItem;

describe('watch state', () => {
  const states = buildWatchStateMap([
    item('movie-done', 'movie', 95, 100),
    item('movie-half', 'movie', 50, 100),
    item('show-done', 'series', 95, 100),
    item('unknown', 'movie', 10, 0),
  ]);

  it('marks only movies past the watched mark as watched', () => {
    expect(states.get('movie-done')).toEqual({progress: 0.95, watched: true});
    expect(states.get('movie-half')).toEqual({progress: 0.5, watched: false});
    expect(states.get('show-done')?.watched).toBe(false);
    expect(states.has('unknown')).toBe(false);
  });

  it('hides watched titles only when asked', () => {
    const posts = [{link: 'movie-done'}, {link: 'movie-half'}, {link: 'new'}];
    expect(withoutWatched(posts, states, false, p => p.link)).toHaveLength(3);
    expect(withoutWatched(posts, states, true, p => p.link).map(p => p.link)).toEqual([
      'movie-half',
      'new',
    ]);
  });
});
