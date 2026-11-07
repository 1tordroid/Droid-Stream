import {
  buildWatchNextEntries,
  buildWatchNextLink,
  emptyWatchNextState,
  isOwnWatchNextKey,
  mergeProviderPrograms,
  parseWatchNextLink,
  planWatchNextSync,
  watchNextKey,
  watchNextKeyProfile,
  withDismissed,
  WATCH_NEXT_PROGRESS_THROTTLE_MS,
  type WatchNextEntry,
} from '../src/lib/tv/watchNext/plan';
import type {ContinueWatchingItem} from '../src/lib/zustand/continueWatchingStore';

const item = (overrides: Partial<ContinueWatchingItem> = {}): ContinueWatchingItem => ({
  id: 'show-1',
  title: 'The Show',
  episodeTitle: 'Episode 2',
  seasonTitle: 'Season 1',
  episode: {title: 'Episode 2', link: 'https://example.com/e2'},
  type: 'series',
  poster: 'https://image.tmdb.org/t/p/w342/poster.jpg',
  background: 'https://image.tmdb.org/t/p/original/backdrop.jpg',
  providerValue: 'provider',
  infoUrl: 'https://example.com/show',
  position: 600,
  duration: 1800,
  updatedAt: 1000,
  ...overrides,
});

const build = (items: ContinueWatchingItem[], kids = false, profileId = 'default') =>
  buildWatchNextEntries(items, {profileId, kids});

describe('buildWatchNextEntries', () => {
  it('publishes an in-progress title as Continue with its position and duration', () => {
    const [entry] = build([item()]);
    expect(entry).toMatchObject({
      kind: 'continue',
      type: 'episode',
      title: 'The Show',
      episodeTitle: 'Episode 2',
      positionMs: 600000,
      durationMs: 1800000,
      lastEngagementMs: 1000,
      posterShape: 'landscape',
      posterUri: 'https://image.tmdb.org/t/p/original/backdrop.jpg',
    });
    expect(parseWatchNextLink(entry.intentUri)).toEqual({profileId: 'default', link: 'https://example.com/show', provider: 'provider'});
  });

  it('publishes a show moved on to its next episode as Next', () => {
    const [entry] = build([item({position: 0, duration: 0, updatedAt: 5000, episodeTitle: 'Episode 3'})]);
    expect(entry).toMatchObject({kind: 'next', positionMs: 0, durationMs: 0, episodeTitle: 'Episode 3'});
  });

  it('leaves out finished titles, unstarted movies and titles without web artwork', () => {
    expect(build([item({type: 'movie', position: 1750, duration: 1800})])).toEqual([]);
    expect(build([item({position: 1750, duration: 1800})])).toEqual([]);
    expect(build([item({type: 'movie', position: 0, duration: 0})])).toEqual([]);
    expect(build([item({position: 0, duration: 0, updatedAt: 0})])).toEqual([]);
    expect(build([item({poster: 'file:///data/poster.jpg', background: undefined})])).toEqual([]);
  });

  it('uses the poster when there is no backdrop, and drops the episode line for movies', () => {
    const [entry] = build([item({type: 'movie', background: undefined, episodeTitle: 'Movie'})]);
    expect(entry).toMatchObject({type: 'movie', posterShape: 'poster', posterUri: 'https://image.tmdb.org/t/p/w342/poster.jpg'});
    expect(entry.episodeTitle).toBeUndefined();
  });

  it('keeps the newest ten', () => {
    const items = Array.from({length: 14}, (_, index) => item({id: `t${index}`, updatedAt: index + 1}));
    const entries = build(items);
    expect(entries).toHaveLength(10);
    expect(entries[0].lastEngagementMs).toBe(14);
  });

  it('only publishes kids-allowed titles on a kids profile', () => {
    const items = [item({id: 'a', title: 'Cartoon'}), item({id: 'b', title: 'Adult Nights'}), item({id: 'c', providerValue: 'xxx-tube'})];
    expect(build(items, true).map(entry => entry.title)).toEqual(['Cartoon']);
    expect(build(items, false)).toHaveLength(3);
  });

  it('gives each profile its own keys', () => {
    const one = build([item()], false, 'default')[0].key;
    const two = build([item()], false, 'abc123')[0].key;
    expect(one).not.toBe(two);
    expect(watchNextKeyProfile(two)).toBe('abc123');
    expect(isOwnWatchNextKey(one)).toBe(true);
    expect(isOwnWatchNextKey('other-app-id')).toBe(false);
  });
});

describe('Play Next links', () => {
  it('round-trips links with special characters and rejects others', () => {
    const url = buildWatchNextLink('p1', {infoUrl: 'https://x.test/a?b=1&c=2#d', providerValue: 'pro vider'});
    expect(parseWatchNextLink(url)).toEqual({profileId: 'p1', link: 'https://x.test/a?b=1&c=2#d', provider: 'pro vider'});
    expect(parseWatchNextLink('droidstream://setup?a=1')).toBeUndefined();
    expect(parseWatchNextLink('droidstream://watchnext?p=1')).toBeUndefined();
    expect(parseWatchNextLink(null)).toBeUndefined();
  });
});

describe('planWatchNextSync', () => {
  const entry = (overrides: Partial<WatchNextEntry> = {}): WatchNextEntry => ({...build([item()])[0], ...overrides});

  it('adds new programs, then skips unchanged ones', () => {
    const first = planWatchNextSync([entry()], emptyWatchNextState(), 10_000);
    expect(first.upserts).toHaveLength(1);
    expect(first.removes).toEqual([]);
    const again = planWatchNextSync([entry()], first.next, 20_000);
    expect(again.upserts).toEqual([]);
    expect(again.removes).toEqual([]);
  });

  it('updates a changed title or episode at once', () => {
    const first = planWatchNextSync([entry()], emptyWatchNextState(), 10_000);
    const changed = planWatchNextSync([entry({episodeTitle: 'Episode 3', kind: 'next'})], first.next, 11_000);
    expect(changed.upserts).toHaveLength(1);
  });

  it('throttles position-only updates and says when to retry', () => {
    const first = planWatchNextSync([entry()], emptyWatchNextState(), 10_000);
    const moved = entry({positionMs: 660_000, lastEngagementMs: 2000});
    const soon = planWatchNextSync([moved], first.next, 40_000);
    expect(soon.upserts).toEqual([]);
    expect(soon.retryInMs).toBe(WATCH_NEXT_PROGRESS_THROTTLE_MS - 30_000);
    const later = planWatchNextSync([moved], soon.next, 10_000 + WATCH_NEXT_PROGRESS_THROTTLE_MS);
    expect(later.upserts).toEqual([moved]);
    expect(later.retryInMs).toBeUndefined();
  });

  it('writes positions at once when forced', () => {
    const first = planWatchNextSync([entry()], emptyWatchNextState(), 10_000);
    const forced = planWatchNextSync([entry({positionMs: 700_000})], first.next, 11_000, {force: true});
    expect(forced.upserts).toHaveLength(1);
  });

  it('removes programs no longer in Continue watching (finished or removed)', () => {
    const first = planWatchNextSync([entry()], emptyWatchNextState(), 10_000);
    const gone = planWatchNextSync([], first.next, 11_000);
    expect(gone.removes).toEqual([entry().key]);
    expect(gone.next.published).toEqual({});
  });

  it('replaces the row when the profile changes', () => {
    const fromDefault = planWatchNextSync(build([item()], false, 'default'), emptyWatchNextState(), 10_000);
    const otherEntries = build([item({id: 'other'})], false, 'kid1');
    const switched = planWatchNextSync(otherEntries, fromDefault.next, 20_000);
    expect(switched.removes).toEqual([build([item()], false, 'default')[0].key]);
    expect(switched.upserts.map(next => next.key)).toEqual([otherEntries[0].key]);
  });

  it('keeps a program the user removed away until it is watched again', () => {
    const first = planWatchNextSync([entry()], emptyWatchNextState(), 10_000);
    const dismissedState = withDismissed(first.next, [{key: entry().key, at: 5000}]);
    expect(dismissedState.published[entry().key]).toBeUndefined();
    const still = planWatchNextSync([entry({lastEngagementMs: 4000})], dismissedState, 12_000);
    expect(still.upserts).toEqual([]);
    expect(still.next.dismissed[entry().key]).toBe(5000);
    const watched = planWatchNextSync([entry({lastEngagementMs: 6000})], still.next, 13_000);
    expect(watched.upserts).toHaveLength(1);
    expect(watched.next.dismissed[entry().key]).toBeUndefined();
  });

  it('forgets dismissals of titles that left Continue watching', () => {
    const state = withDismissed(emptyWatchNextState(), [{key: entry().key, at: 5000}]);
    expect(planWatchNextSync([], state, 1).next.dismissed).toEqual({});
  });

  it('ignores dismissals of programs that are not its own', () => {
    expect(withDismissed(emptyWatchNextState(), [{key: 'foreign', at: 1}]).dismissed).toEqual({});
  });
});

describe('mergeProviderPrograms', () => {
  it('rewrites programs the TV home lost, removes unknown ones, and treats turned-off ones as dismissed', () => {
    const wanted = build([item({id: 'a'}), item({id: 'b'})]);
    const published = planWatchNextSync(wanted, emptyWatchNextState(), 1000).next;
    const stray = watchNextKey('old', 'x');
    const merged = mergeProviderPrograms(published, [
      {key: wanted[0].key, browsable: true},
      {key: wanted[1].key, browsable: false},
      {key: stray, browsable: true},
      {key: 'another-app', browsable: true},
    ], 7000);
    expect(merged.dismissed[wanted[1].key]).toBe(7000);
    const plan = planWatchNextSync(wanted, merged, 8000);
    expect(plan.upserts).toEqual([]);
    expect(plan.removes.sort()).toEqual([wanted[1].key, stray].sort());

    const lost = mergeProviderPrograms(published, [], 9000);
    expect(planWatchNextSync(wanted, lost, 9000).upserts).toHaveLength(2);
  });
});
