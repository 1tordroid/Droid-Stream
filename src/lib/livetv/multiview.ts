/**
 * Multi-view: 2 to 4 Live TV channels on one screen.
 *
 * Everything here is plain data, so the layout, limits, audio and DRM rules
 * can be tested without a player. The screen is screens/livetv/MultiView.tsx.
 */
import {getTotalRamMB} from '../deviceMemory';
import {knownProtectedChannels} from '../downloadEngine/engineStore';
import {profileKey} from '../profiles/scope';
import type {LiveChannel} from './m3u';
import {readLiveJson, removeLiveJson, toSaved, writeLiveJson, type SavedChannel} from './store';

/** 'side': 1 + 1 side by side. 'grid': 2 x 2. 'big': one big tile and 2 or 3 small ones. */
export type MultiLayout = 'side' | 'grid' | 'big';

export interface MultiTile {
  /** Stays the same while the tile changes channel, so audio stays with it. */
  key: string;
  channel: SavedChannel;
}

export interface MultiViewState {
  layout: MultiLayout;
  tiles: MultiTile[];
  /** The tile you hear; the others are muted. */
  audioKey?: string;
}

export const EMPTY_MULTI_VIEW: MultiViewState = {layout: 'grid', tiles: []};

export const DRM_LIMIT_MESSAGE =
  'Only one protected (DRM) channel can play at a time. The device has one secure video decoder. Remove the other protected channel first.';
export const ALREADY_ADDED_MESSAGE = 'This channel is already in multi-view.';
export const fullMessage = (max: number) => `Multi-view shows up to ${max} channels at once on this device.`;

// ---- Limits ----

/** Tiles this device can play at once: 2 GB of RAM or less gives 2, 4 GB or less 3, more gives 4. */
export const maxTilesForRam = (totalRamMB: number): number => {
  if (!(totalRamMB > 0) || totalRamMB <= 2048) return 2;
  if (totalRamMB <= 4096) return 3;
  return 4;
};

export const maxTiles = (): number => maxTilesForRam(getTotalRamMB());

// ---- Layout ----

/** Layouts that fit this many tiles. Two tiles sit side by side; three or four use the grid or big + small. */
export const layoutsFor = (count: number): MultiLayout[] => (count <= 2 ? ['side'] : ['grid', 'big']);

/** The layout to draw: the chosen one when it fits, else the closest one. */
export const effectiveLayout = (layout: MultiLayout, count: number): MultiLayout => {
  const choices = layoutsFor(count);
  if (choices.includes(layout)) return layout;
  return count <= 2 ? 'side' : 'big';
};

export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where each tile goes in a width x height area. In portrait (taller than
 * wide), side by side stacks and big + small puts the small tiles in a row
 * under the big one.
 */
export const tileRects = (layout: MultiLayout, count: number, width: number, height: number, gap = 6): TileRect[] => {
  if (count <= 0 || width <= 0 || height <= 0) return [];
  if (count === 1) return [{x: 0, y: 0, width, height}];
  const portrait = height > width;
  const shown = effectiveLayout(layout, count);
  const floor = Math.floor;
  if (shown === 'side') {
    if (portrait) {
      const h = floor((height - gap) / 2);
      return [0, 1].map(i => ({x: 0, y: i * (h + gap), width, height: h}));
    }
    const w = floor((width - gap) / 2);
    return [0, 1].map(i => ({x: i * (w + gap), y: 0, width: w, height}));
  }
  if (shown === 'grid') {
    const w = floor((width - gap) / 2);
    const h = floor((height - gap) / 2);
    return Array.from({length: Math.min(count, 4)}, (_, i) => ({x: (i % 2) * (w + gap), y: floor(i / 2) * (h + gap), width: w, height: h}));
  }
  // Big + small.
  const small = Math.min(count, 4) - 1;
  if (portrait) {
    const bigH = floor((height - gap) * 0.6);
    const smallH = height - gap - bigH;
    const smallW = floor((width - gap * (small - 1)) / small);
    return [
      {x: 0, y: 0, width, height: bigH},
      ...Array.from({length: small}, (_, i) => ({x: i * (smallW + gap), y: bigH + gap, width: smallW, height: smallH})),
    ];
  }
  const bigW = floor(((width - gap) * 2) / 3);
  const smallW = width - gap - bigW;
  const smallH = floor((height - gap * (small - 1)) / small);
  return [
    {x: 0, y: 0, width: bigW, height},
    ...Array.from({length: small}, (_, i) => ({x: bigW + gap, y: i * (smallH + gap), width: smallW, height: smallH})),
  ];
};

/** 'full' for a tile alone or the big one, 'medium' side by side, 'low' for small tiles. */
export type TileQuality = 'full' | 'medium' | 'low';

export const tileQuality = (layout: MultiLayout, count: number, index: number): TileQuality => {
  if (count <= 1) return 'full';
  const shown = effectiveLayout(layout, count);
  if (shown === 'big') return index === 0 ? 'full' : 'low';
  return shown === 'side' ? 'medium' : 'low';
};

/**
 * The player's maxBitRate for a tile (0 = no limit). A limit of 1 bit/s is
 * below every variant, so the player takes the lowest one the stream offers.
 */
export const maxBitRateFor = (quality: TileQuality): number => (quality === 'full' ? 0 : quality === 'medium' ? 2_500_000 : 1);

// ---- Tiles ----

const sameChannel = (a: Pick<SavedChannel, 'sourceId' | 'id' | 'url'>, b: Pick<SavedChannel, 'sourceId' | 'id' | 'url'>) =>
  (a.sourceId === b.sourceId && a.id === b.id) || a.url === b.url;

/** The next free tile key ("t1", "t2", ...). */
export const nextTileKey = (tiles: MultiTile[]): string => {
  const used = tiles.map(tile => Number(/^t(\d+)$/.exec(tile.key)?.[1]) || 0);
  return `t${Math.max(0, ...used) + 1}`;
};

/** The tile you hear: the chosen one while it is there, else the first. */
export const audioKeyOf = (state: MultiViewState): string | undefined =>
  state.tiles.some(tile => tile.key === state.audioKey) ? state.audioKey : state.tiles[0]?.key;

export const setAudio = (state: MultiViewState, key: string): MultiViewState =>
  state.tiles.some(tile => tile.key === key) ? {...state, audioKey: key} : state;

export const setLayout = (state: MultiViewState, layout: MultiLayout): MultiViewState => ({...state, layout});

/** Whether a channel uses DRM: marked in its playlist, or JioTV said so when it played before. */
export const isProtectedChannel = (channel: Pick<SavedChannel, 'drm' | 'url'>, known: ReadonlySet<string>): boolean =>
  !!channel.drm || known.has(channel.url);

/** Why this channel cannot join (another tile is already protected), or undefined when it can. */
export const drmBlocker = (
  tiles: MultiTile[],
  channel: Pick<SavedChannel, 'drm' | 'url'>,
  known: ReadonlySet<string>,
  exceptKey?: string,
): string | undefined => {
  if (!isProtectedChannel(channel, known)) return undefined;
  return tiles.some(tile => tile.key !== exceptKey && isProtectedChannel(tile.channel, known)) ? DRM_LIMIT_MESSAGE : undefined;
};

/**
 * The one tile allowed to play DRM while the screen runs. JioTV only says a
 * channel is protected once its stream is fetched, so two can turn out to be
 * protected; the tile that had it keeps it, else the first one in order.
 */
export const drmTileKey = (tiles: MultiTile[], drmKeys: ReadonlySet<string>, current?: string): string | undefined => {
  if (current && drmKeys.has(current) && tiles.some(tile => tile.key === current)) return current;
  return tiles.find(tile => drmKeys.has(tile.key))?.key;
};

export type TileResult = {ok: true; state: MultiViewState; key: string} | {ok: false; error: string};

interface AddOptions {
  max: number;
  known: ReadonlySet<string>;
}

export const addTile = (state: MultiViewState, channel: SavedChannel, {max, known}: AddOptions): TileResult => {
  if (state.tiles.some(tile => sameChannel(tile.channel, channel))) return {ok: false, error: ALREADY_ADDED_MESSAGE};
  if (state.tiles.length >= max) return {ok: false, error: fullMessage(max)};
  const blocked = drmBlocker(state.tiles, channel, known);
  if (blocked) return {ok: false, error: blocked};
  const key = nextTileKey(state.tiles);
  const tiles = [...state.tiles, {key, channel}];
  return {ok: true, key, state: {...state, tiles, audioKey: audioKeyOf({...state, tiles})}};
};

/** Puts another channel on a tile. The tile keeps its place and its audio. */
export const replaceTile = (state: MultiViewState, key: string, channel: SavedChannel, {known}: Pick<AddOptions, 'known'>): TileResult => {
  if (!state.tiles.some(tile => tile.key === key)) return {ok: false, error: 'This tile is gone.'};
  if (state.tiles.some(tile => tile.key !== key && sameChannel(tile.channel, channel))) return {ok: false, error: ALREADY_ADDED_MESSAGE};
  const blocked = drmBlocker(state.tiles, channel, known, key);
  if (blocked) return {ok: false, error: blocked};
  return {ok: true, key, state: {...state, tiles: state.tiles.map(tile => (tile.key === key ? {key, channel} : tile))}};
};

/** Removes a tile. When it had the audio, the first tile left gets it. */
export const removeTile = (state: MultiViewState, key: string): MultiViewState => {
  const tiles = state.tiles.filter(tile => tile.key !== key);
  const audioKey = state.audioKey === key ? tiles[0]?.key : state.audioKey;
  return {...state, tiles, audioKey: audioKeyOf({...state, tiles, audioKey})};
};

/** Swaps a tile with the first (big) one. */
export const swapWithBig = (state: MultiViewState, key: string): MultiViewState => {
  const index = state.tiles.findIndex(tile => tile.key === key);
  if (index <= 0) return state;
  const tiles = [...state.tiles];
  [tiles[0], tiles[index]] = [tiles[index], tiles[0]];
  return {...state, tiles};
};

// ---- Saved set (per profile) ----

/** Per-profile key in the Live TV store (listed in PROFILE_LIVETV_KEYS). */
export const MULTI_VIEW_KEY = 'multiView';
const storeKey = () => profileKey(MULTI_VIEW_KEY);

const isLayout = (value: unknown): value is MultiLayout => value === 'side' || value === 'grid' || value === 'big';

const isChannel = (value: any): value is SavedChannel =>
  !!value && typeof value === 'object' && typeof value.id === 'string' && typeof value.name === 'string' &&
  typeof value.url === 'string' && !!value.url && typeof value.sourceId === 'string';

/** Cleans a saved set and keeps only as many tiles as this device can play. */
export const sanitizeMultiView = (value: unknown, max: number): MultiViewState => {
  if (!value || typeof value !== 'object') return EMPTY_MULTI_VIEW;
  const raw = value as Record<string, unknown>;
  const keys = new Set<string>();
  const tiles: MultiTile[] = [];
  for (const item of Array.isArray(raw.tiles) ? raw.tiles : []) {
    if (tiles.length >= max) break;
    const key = typeof item?.key === 'string' ? item.key : '';
    if (!key || keys.has(key) || !isChannel(item.channel)) continue;
    if (tiles.some(tile => sameChannel(tile.channel, item.channel))) continue;
    keys.add(key);
    tiles.push({key, channel: item.channel});
  }
  const state: MultiViewState = {layout: isLayout(raw.layout) ? raw.layout : EMPTY_MULTI_VIEW.layout, tiles};
  const audioKey = audioKeyOf({...state, audioKey: typeof raw.audioKey === 'string' ? raw.audioKey : undefined});
  return audioKey ? {...state, audioKey} : state;
};

export const loadMultiView = (max: number = maxTiles()): MultiViewState => sanitizeMultiView(readLiveJson<unknown>(storeKey()), max);

export const saveMultiView = (state: MultiViewState): void => {
  if (!state.tiles.length && state.layout === EMPTY_MULTI_VIEW.layout) {
    removeLiveJson(storeKey());
    return;
  }
  writeLiveJson(storeKey(), {layout: state.layout, tiles: state.tiles, ...(state.audioKey ? {audioKey: state.audioKey} : {})});
};

/** Long-press "Add to multi-view" in Live TV: adds the channel to the saved set. */
export const addToMultiView = (
  channel: (LiveChannel | SavedChannel) & {sourceId: string},
  {max = maxTiles(), known = knownProtectedChannels()}: Partial<AddOptions> = {},
): TileResult => {
  const result = addTile(loadMultiView(max), toSaved(channel, channel.sourceId), {max, known});
  if (result.ok) saveMultiView(result.state);
  return result;
};
