import {
  ALREADY_ADDED_MESSAGE,
  DRM_LIMIT_MESSAGE,
  EMPTY_MULTI_VIEW,
  addTile,
  addToMultiView,
  audioKeyOf,
  drmBlocker,
  drmTileKey,
  effectiveLayout,
  fullMessage,
  layoutsFor,
  loadMultiView,
  maxBitRateFor,
  maxTilesForRam,
  removeTile,
  replaceTile,
  sanitizeMultiView,
  saveMultiView,
  setAudio,
  swapWithBig,
  tileQuality,
  tileRects,
  type MultiViewState,
} from '../src/lib/livetv/multiview';
import type {SavedChannel} from '../src/lib/livetv/store';
import {PROFILE_LIVETV_KEYS} from '../src/lib/profiles/profileData';
import {resetActiveProfileCacheForTests, saveActiveProfileId} from '../src/lib/profiles/scope';
import {openStore} from '../src/lib/storage/openStore';

const channel = (id: string, extra: Partial<SavedChannel> = {}): SavedChannel => ({id, name: id.toUpperCase(), url: `http://tv/${id}.m3u8`, sourceId: 'iptv-org', ...extra});
const none = new Set<string>();

const build = (ids: string[], max = 4, known: ReadonlySet<string> = none): MultiViewState =>
  ids.reduce<MultiViewState>((state, id) => {
    const result = addTile(state, channel(id), {max, known});
    if (!result.ok) throw new Error(result.error);
    return result.state;
  }, EMPTY_MULTI_VIEW);

const useProfile = (id: string) => {
  saveActiveProfileId(id);
  resetActiveProfileCacheForTests();
};
const live = () => openStore('droid-stream-livetv');

describe('multi-view limits', () => {
  it('picks the tile count from device RAM', () => {
    expect(maxTilesForRam(1024)).toBe(2);
    expect(maxTilesForRam(1900)).toBe(2);
    expect(maxTilesForRam(2048)).toBe(2);
    expect(maxTilesForRam(3000)).toBe(3);
    expect(maxTilesForRam(4096)).toBe(3);
    expect(maxTilesForRam(5600)).toBe(4);
    expect(maxTilesForRam(12000)).toBe(4);
    // Unknown RAM is treated as a small device.
    expect(maxTilesForRam(0)).toBe(2);
    expect(maxTilesForRam(NaN)).toBe(2);
  });

  it('refuses a channel past the limit or twice', () => {
    const state = build(['a', 'b']);
    const full = addTile(state, channel('c'), {max: 2, known: none});
    expect(full).toEqual({ok: false, error: fullMessage(2)});
    expect(addTile(state, channel('a'), {max: 4, known: none})).toEqual({ok: false, error: ALREADY_ADDED_MESSAGE});
    // The same stream from another list counts as the same channel.
    expect(addTile(state, {...channel('x'), url: 'http://tv/b.m3u8', sourceId: 'pl-1'}, {max: 4, known: none}).ok).toBe(false);
  });
});

describe('multi-view layout', () => {
  it('offers side by side for two and grid or big + small for three or four', () => {
    expect(layoutsFor(1)).toEqual(['side']);
    expect(layoutsFor(2)).toEqual(['side']);
    expect(layoutsFor(3)).toEqual(['grid', 'big']);
    expect(layoutsFor(4)).toEqual(['grid', 'big']);
    expect(effectiveLayout('grid', 2)).toBe('side');
    expect(effectiveLayout('side', 3)).toBe('big');
    expect(effectiveLayout('grid', 4)).toBe('grid');
  });

  it('places one tile full size and two side by side', () => {
    expect(tileRects('grid', 1, 1000, 500)).toEqual([{x: 0, y: 0, width: 1000, height: 500}]);
    expect(tileRects('side', 2, 1006, 500, 6)).toEqual([
      {x: 0, y: 0, width: 500, height: 500},
      {x: 506, y: 0, width: 500, height: 500},
    ]);
    // Portrait phone: one above the other.
    expect(tileRects('side', 2, 400, 806, 6)).toEqual([
      {x: 0, y: 0, width: 400, height: 400},
      {x: 0, y: 406, width: 400, height: 400},
    ]);
    expect(tileRects('side', 0, 400, 800)).toEqual([]);
  });

  it('places a 2 x 2 grid, leaving the fourth cell empty for three', () => {
    const rects = tileRects('grid', 4, 1926, 1086, 6);
    expect(rects).toEqual([
      {x: 0, y: 0, width: 960, height: 540},
      {x: 966, y: 0, width: 960, height: 540},
      {x: 0, y: 546, width: 960, height: 540},
      {x: 966, y: 546, width: 960, height: 540},
    ]);
    expect(tileRects('grid', 3, 1926, 1086, 6)).toEqual(rects.slice(0, 3));
  });

  it('places one big tile and the small ones beside it, or under it in portrait', () => {
    const [big, ...small] = tileRects('big', 4, 1206, 612, 6);
    expect(big).toEqual({x: 0, y: 0, width: 800, height: 612});
    expect(small).toEqual([
      {x: 806, y: 0, width: 400, height: 200},
      {x: 806, y: 206, width: 400, height: 200},
      {x: 806, y: 412, width: 400, height: 200},
    ]);
    const three = tileRects('big', 3, 1206, 606, 6);
    expect(three[1]).toEqual({x: 806, y: 0, width: 400, height: 300});
    expect(three[2]).toEqual({x: 806, y: 306, width: 400, height: 300});
    const portrait = tileRects('big', 3, 406, 1006, 6);
    expect(portrait[0]).toEqual({x: 0, y: 0, width: 406, height: 600});
    expect(portrait.slice(1)).toEqual([
      {x: 0, y: 606, width: 200, height: 400},
      {x: 206, y: 606, width: 200, height: 400},
    ]);
  });

  it('every tile stays inside the area', () => {
    for (const layout of ['side', 'grid', 'big'] as const) {
      for (let count = 1; count <= 4; count++) {
        for (const [w, h] of [[1920, 1080], [393, 852], [960, 540]]) {
          const rects = tileRects(layout, count, w, h);
          expect(rects).toHaveLength(count);
          for (const r of rects) {
            expect(r.x + r.width).toBeLessThanOrEqual(w);
            expect(r.y + r.height).toBeLessThanOrEqual(h);
            expect(r.width).toBeGreaterThan(0);
            expect(r.height).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('uses the lowest variant for small tiles', () => {
    expect(tileQuality('grid', 1, 0)).toBe('full');
    expect(tileQuality('side', 2, 1)).toBe('medium');
    expect(tileQuality('grid', 4, 0)).toBe('low');
    expect(tileQuality('big', 4, 0)).toBe('full');
    expect(tileQuality('big', 4, 2)).toBe('low');
    expect(maxBitRateFor('full')).toBe(0);
    expect(maxBitRateFor('medium')).toBeGreaterThan(1);
    expect(maxBitRateFor('low')).toBe(1);
  });
});

describe('multi-view audio', () => {
  it('starts on the first tile and moves with a tap', () => {
    const state = build(['a', 'b', 'c']);
    expect(audioKeyOf(state)).toBe('t1');
    const moved = setAudio(state, 't3');
    expect(audioKeyOf(moved)).toBe('t3');
    // An unknown tile changes nothing.
    expect(setAudio(moved, 't9')).toBe(moved);
  });

  it('stays with its tile when tiles swap or change channel', () => {
    const state = setAudio(build(['a', 'b', 'c']), 't3');
    const swapped = swapWithBig(state, 't3');
    expect(swapped.tiles.map(tile => tile.channel.id)).toEqual(['c', 'b', 'a']);
    expect(audioKeyOf(swapped)).toBe('t3');
    expect(swapWithBig(swapped, 't3')).toBe(swapped);
    const changed = replaceTile(swapped, 't3', channel('d'), {known: none});
    expect(changed.ok && changed.state.tiles[0]).toEqual({key: 't3', channel: channel('d')});
    expect(changed.ok && audioKeyOf(changed.state)).toBe('t3');
  });

  it('goes to the first tile left when its tile is removed', () => {
    const state = setAudio(build(['a', 'b', 'c']), 't2');
    expect(audioKeyOf(removeTile(state, 't1'))).toBe('t2');
    const removed = removeTile(state, 't2');
    expect(removed.tiles.map(tile => tile.key)).toEqual(['t1', 't3']);
    expect(audioKeyOf(removed)).toBe('t1');
    expect(audioKeyOf(removeTile(removeTile(removed, 't1'), 't3'))).toBeUndefined();
    // New tiles get fresh keys.
    const again = addTile(removed, channel('z'), {max: 4, known: none});
    expect(again.ok && again.key).toBe('t4');
  });
});

describe('multi-view DRM limit', () => {
  const jio = channel('jio1', {url: 'jiotv:143', sourceId: 'jio'});
  const marked = channel('m', {drm: true});

  it('allows one protected channel', () => {
    const known = new Set(['jiotv:143']);
    const state = build(['a']);
    const first = addTile(state, jio, {max: 4, known});
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(addTile(first.state, marked, {max: 4, known})).toEqual({ok: false, error: DRM_LIMIT_MESSAGE});
    expect(addTile(first.state, channel('b'), {max: 4, known}).ok).toBe(true);
    // Changing the protected tile to another protected channel is fine.
    expect(replaceTile(first.state, first.key, marked, {known}).ok).toBe(true);
    expect(replaceTile(first.state, 't1', marked, {known})).toEqual({ok: false, error: DRM_LIMIT_MESSAGE});
    expect(drmBlocker(first.state.tiles, channel('plain'), known)).toBeUndefined();
    expect(drmBlocker(removeTile(first.state, first.key).tiles, marked, known)).toBeUndefined();
  });

  it('lets only one tile play DRM found while playing', () => {
    const state = build(['a', 'b', 'c']);
    expect(drmTileKey(state.tiles, new Set())).toBeUndefined();
    expect(drmTileKey(state.tiles, new Set(['t3', 't2']))).toBe('t2');
    // The tile that has it keeps it.
    expect(drmTileKey(state.tiles, new Set(['t2', 't3']), 't3')).toBe('t3');
    expect(drmTileKey(removeTile(state, 't3').tiles, new Set(['t2', 't3']), 't3')).toBe('t2');
  });
});

describe('multi-view saved set', () => {
  beforeEach(() => {
    useProfile('default');
    for (const key of live().getAllKeys?.() || []) live().removeItem(key);
  });
  afterAll(() => useProfile('default'));

  it('keeps the last set per profile', () => {
    const state = setAudio({...build(['a', 'b', 'c']), layout: 'big'}, 't2');
    saveMultiView(state);
    expect(loadMultiView(4)).toEqual(state);
    useProfile('kid1');
    expect(loadMultiView(4)).toEqual(EMPTY_MULTI_VIEW);
    saveMultiView(build(['k']));
    expect(JSON.parse(live().getString('p.kid1.multiView')!).tiles[0].channel.id).toBe('k');
    useProfile('default');
    expect(loadMultiView(4)).toEqual(state);
    expect(PROFILE_LIVETV_KEYS).toContain('multiView');
    saveMultiView(EMPTY_MULTI_VIEW);
    expect(live().getString('multiView')).toBeUndefined();
  });

  it('keeps only the tiles this device can play and drops bad data', () => {
    saveMultiView(setAudio(build(['a', 'b', 'c', 'd']), 't4'));
    const small = loadMultiView(2);
    expect(small.tiles.map(tile => tile.key)).toEqual(['t1', 't2']);
    expect(audioKeyOf(small)).toBe('t1');
    expect(sanitizeMultiView('nope', 4)).toEqual(EMPTY_MULTI_VIEW);
    const messy = sanitizeMultiView(
      {layout: 'diagonal', tiles: [{key: 't1', channel: channel('a')}, {key: 't1', channel: channel('b')}, {key: 't2'}, {key: 't3', channel: {name: 'x'}}, {key: 't4', channel: channel('a')}], audioKey: 'gone'},
      4,
    );
    expect(messy).toEqual({layout: 'grid', tiles: [{key: 't1', channel: channel('a')}], audioKey: 't1'});
  });

  it('adds from the Live TV long-press menu', () => {
    const first = addToMultiView({...channel('a'), attrs: {}, group: 'News'}, {max: 2, known: none});
    expect(first.ok).toBe(true);
    expect(loadMultiView(2).tiles[0].channel).toMatchObject({id: 'a', group: 'News', sourceId: 'iptv-org'});
    expect(addToMultiView(channel('b'), {max: 2, known: none}).ok).toBe(true);
    expect(addToMultiView(channel('c'), {max: 2, known: none})).toEqual({ok: false, error: fullMessage(2)});
    expect(loadMultiView(2).tiles).toHaveLength(2);
  });
});
