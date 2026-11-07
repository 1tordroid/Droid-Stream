import {buildWatchNextEntries, WATCH_NEXT_PROGRESS_THROTTLE_MS, type WatchNextEntry, type WatchNextState} from '../src/lib/tv/watchNext/plan';
import {createWatchNextSyncer, type WatchNextBackend} from '../src/lib/tv/watchNext/syncer';
import type {ContinueWatchingItem} from '../src/lib/zustand/continueWatchingStore';

const item = (overrides: Partial<ContinueWatchingItem> = {}): ContinueWatchingItem => ({
  id: 'movie-1',
  title: 'A Movie',
  episode: {title: 'A Movie', link: 'https://example.com/m'},
  type: 'movie',
  background: 'https://example.com/b.jpg',
  providerValue: 'provider',
  infoUrl: 'https://example.com/movie',
  position: 100,
  duration: 6000,
  updatedAt: 1,
  ...overrides,
});

/** A fake TV provider holding programs by key. */
const fakeProvider = () => {
  const rows = new Map<string, {entry: WatchNextEntry; browsable: boolean}>();
  let dismissed: {key: string; at: number}[] = [];
  const backend: WatchNextBackend = {
    list: jest.fn(async () => [...rows].map(([key, row]) => ({key, browsable: row.browsable}))),
    apply: jest.fn(async (upserts: WatchNextEntry[], removes: string[]) => {
      removes.forEach(key => rows.delete(key));
      upserts.forEach(entry => rows.set(entry.key, {entry, browsable: true}));
      return {failed: []};
    }),
    takeDismissed: jest.fn(async () => {
      const taken = dismissed;
      dismissed = [];
      return taken;
    }),
  };
  return {
    rows,
    backend,
    userRemoves: (key: string, at: number) => {
      rows.delete(key);
      dismissed.push({key, at});
    },
  };
};

const setup = (initialItems: ContinueWatchingItem[], profileId = 'default') => {
  let items = initialItems;
  let profile = profileId;
  let kids = false;
  let clock = 1_000_000;
  let saved: WatchNextState | undefined;
  const provider = fakeProvider();
  const make = () =>
    createWatchNextSyncer({
      backend: provider.backend,
      readEntries: () => buildWatchNextEntries(items, {profileId: profile, kids}),
      loadState: () => saved,
      saveState: state => {
        saved = JSON.parse(JSON.stringify(state));
      },
      now: () => clock,
      batchMs: 3000,
    });
  return {
    provider,
    make,
    setItems: (next: ContinueWatchingItem[]) => (items = next),
    setProfile: (id: string, isKids = false) => {
      profile = id;
      kids = isKids;
    },
    advance: (ms: number) => {
      clock += ms;
      jest.advanceTimersByTime(ms);
    },
  };
};

const flush = async () => {
  for (let index = 0; index < 5; index++) await Promise.resolve();
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('createWatchNextSyncer', () => {
  it('publishes Continue watching at start and batches later changes', async () => {
    const env = setup([item()]);
    const syncer = env.make();
    await syncer.start();
    expect([...env.provider.rows.values()].map(row => row.entry.title)).toEqual(['A Movie']);

    env.setItems([item(), item({id: 'movie-2', title: 'Second', updatedAt: 2})]);
    syncer.schedule();
    syncer.schedule();
    expect(env.provider.backend.apply).toHaveBeenCalledTimes(1);
    env.advance(3000);
    await flush();
    expect(env.provider.backend.apply).toHaveBeenCalledTimes(2);
    expect(env.provider.rows.size).toBe(2);
    syncer.stop();
  });

  it('holds back position updates, then writes the latest one when the throttle ends', async () => {
    const env = setup([item()]);
    const syncer = env.make();
    await syncer.start();
    env.setItems([item({position: 160, updatedAt: 2})]);
    syncer.schedule();
    env.advance(3000);
    await flush();
    expect(env.provider.backend.apply).toHaveBeenCalledTimes(1);
    env.setItems([item({position: 220, updatedAt: 3})]);
    env.advance(WATCH_NEXT_PROGRESS_THROTTLE_MS);
    await flush();
    expect(env.provider.backend.apply).toHaveBeenCalledTimes(2);
    expect([...env.provider.rows.values()][0].entry.positionMs).toBe(220_000);
    syncer.stop();
  });

  it('writes at once when forced (leaving the player)', async () => {
    const env = setup([item()]);
    const syncer = env.make();
    await syncer.start();
    env.setItems([item({position: 300, updatedAt: 2})]);
    syncer.schedule(true);
    env.advance(0);
    await flush();
    expect([...env.provider.rows.values()][0].entry.positionMs).toBe(300_000);
    syncer.stop();
  });

  it('removes a title when it is finished or removed from Continue watching', async () => {
    const env = setup([item(), item({id: 'movie-2', updatedAt: 2})]);
    const syncer = env.make();
    await syncer.start();
    env.setItems([item({position: 5900}), item({id: 'movie-2', updatedAt: 2})]);
    await syncer.runNow();
    expect(env.provider.rows.size).toBe(1);
    env.setItems([]);
    await syncer.runNow();
    expect(env.provider.rows.size).toBe(0);
    syncer.stop();
  });

  it('replaces the row with the next profile on the next start', async () => {
    const env = setup([item()]);
    const first = env.make();
    await first.start();
    first.stop();
    const before = [...env.provider.rows.keys()];

    env.setProfile('kid1', true);
    env.setItems([item({id: 'cartoon', title: 'Cartoon'}), item({id: 'grown', title: 'Erotic Tales'})]);
    const second = env.make();
    await second.start();
    const titles = [...env.provider.rows.values()].map(row => row.entry.title);
    expect(titles).toEqual(['Cartoon']);
    expect([...env.provider.rows.keys()].some(key => before.includes(key))).toBe(false);
    second.stop();
  });

  it('clears programs left from a lost state at start', async () => {
    const env = setup([item()]);
    const first = env.make();
    await first.start();
    first.stop();
    // Same provider, new install of the state: unknown own programs are removed.
    env.setItems([]);
    const second = createWatchNextSyncer({
      backend: env.provider.backend,
      readEntries: () => [],
      loadState: () => undefined,
      saveState: () => undefined,
    });
    await second.start();
    expect(env.provider.rows.size).toBe(0);
    second.stop();
  });

  it('does not add back a program the user removed from the TV home', async () => {
    const env = setup([item()]);
    const syncer = env.make();
    await syncer.start();
    const [key] = [...env.provider.rows.keys()];
    env.provider.userRemoves(key, 1_000_500);
    await syncer.dismissed();
    expect(env.provider.rows.size).toBe(0);
    env.setItems([item({position: 120, updatedAt: 1_000_400})]);
    await syncer.runNow(true);
    expect(env.provider.rows.size).toBe(0);
    // Watched again after removing it: back in Play Next.
    env.setItems([item({position: 140, updatedAt: 1_000_600})]);
    await syncer.runNow(true);
    expect(env.provider.rows.size).toBe(1);
    syncer.stop();
  });

  it('publishes nothing when the setting is off', async () => {
    const env = setup([item()]);
    const syncer = env.make();
    await syncer.start();
    env.setItems([]);
    await syncer.runNow(true);
    expect(env.provider.rows.size).toBe(0);
    syncer.stop();
  });

  it('tries failed writes again', async () => {
    const env = setup([item()]);
    const [{key}] = buildWatchNextEntries([item()], {profileId: 'default', kids: false});
    (env.provider.backend.apply as jest.Mock).mockResolvedValueOnce({failed: [key]}).mockImplementationOnce(async () => {
      throw new Error('provider busy');
    });
    const syncer = env.make();
    await syncer.start();
    expect(env.provider.rows.size).toBe(0);
    await syncer.runNow();
    expect(env.provider.backend.apply).toHaveBeenCalledTimes(2);
    expect(env.provider.rows.size).toBe(0);
    await syncer.runNow();
    expect(env.provider.backend.apply).toHaveBeenCalledTimes(3);
    expect(env.provider.rows.size).toBe(1);
    await syncer.runNow();
    expect(env.provider.backend.apply).toHaveBeenCalledTimes(3);
    syncer.stop();
  });
});
