import {create} from 'zustand';
import {getTmdbApiKey} from '../hooks/useTmdbStory';
import {registerStorageClearHook} from '../storage/StorageService';
import {getSourceSettings, loadLibrary, saveLibrary} from './cache';
import {groupNetlib} from './group';
import {matchItems} from './match';
import {findNetlibSource, savedSourceOf, scanRootOf} from './resolve';
import {deviceLister} from './scan/device';
import {smbLister} from './scan/smb';
import {walkVideos, type NetlibLister} from './scan/walk';
import {webDavLister} from './scan/webdav';
import type {NetlibItem, NetlibLibrary, NetlibMatch, NetlibSource} from './types';

export interface ScanState {
  phase: 'listing' | 'matching';
  found: number;
}

interface NetlibState {
  libraries: Record<string, NetlibLibrary | undefined>;
  scans: Record<string, ScanState | undefined>;
  errors: Record<string, string | undefined>;
}

/** Libraries loaded this session and scans in progress, for the screens. */
export const useNetlibStore = create<NetlibState>(() => ({libraries: {}, scans: {}, errors: {}}));

// Erase all empties the netlib store; forget what was loaded from it.
if (typeof registerStorageClearHook === 'function') {
  registerStorageClearHook(() => useNetlibStore.setState({libraries: {}, errors: {}}));
}

const setLibrary = (library: NetlibLibrary) => {
  saveLibrary(library);
  useNetlibStore.setState(state => ({libraries: {...state.libraries, [library.sourceId]: library}}));
};

/** The saved library of a source, read once from storage. */
export const getNetlibLibrary = (sourceId: string): NetlibLibrary | undefined => {
  const loaded = useNetlibStore.getState().libraries[sourceId];
  if (loaded) return loaded;
  const stored = loadLibrary(sourceId);
  if (stored) useNetlibStore.setState(state => ({libraries: {...state.libraries, [sourceId]: stored}}));
  return stored;
};

/** Item ids start with their source id (see itemId in ids.ts). */
export const sourceIdOfItem = (id: string): string => id.split('|')[0];

export const findNetlibItem = (id: string): NetlibItem | undefined =>
  getNetlibLibrary(sourceIdOfItem(id))?.items.find(item => item.id === id);

export const useNetlibLibrary = (sourceId: string): NetlibLibrary | undefined => {
  const library = useNetlibStore(state => state.libraries[sourceId]);
  return library || getNetlibLibrary(sourceId);
};

export const useNetlibItem = (id?: string): NetlibItem | undefined => {
  const sourceId = id ? sourceIdOfItem(id) : '';
  const library = useNetlibLibrary(sourceId);
  return id ? library?.items.find(item => item.id === id) : undefined;
};

const listerFor = (source: NetlibSource): NetlibLister => {
  if (source.kind === 'device') return deviceLister;
  const saved = savedSourceOf(source.id);
  if (!saved) throw new Error('This source was removed.');
  return source.kind === 'smb' ? smbLister(saved) : webDavLister(saved);
};

/** Folder listing for the Folders tab. */
export const listNetlibFolder = (source: NetlibSource, folder: string) => listerFor(source)(folder);

const scans = new Map<string, AbortController>();

const setScan = (sourceId: string, scan?: ScanState) =>
  useNetlibStore.setState(state => ({scans: {...state.scans, [sourceId]: scan}}));

/**
 * Lists a source, groups its videos into titles and matches the new ones.
 * Matches from the last scan carry over, so a rescan only looks up what is new.
 * A second call while one runs returns without starting another.
 */
export const scanNetlibSource = async (sourceId: string): Promise<void> => {
  if (scans.has(sourceId)) return;
  const source = findNetlibSource(sourceId);
  if (!source) return;
  const controller = new AbortController();
  scans.set(sourceId, controller);
  useNetlibStore.setState(state => ({errors: {...state.errors, [sourceId]: undefined}}));
  setScan(sourceId, {phase: 'listing', found: 0});
  try {
    const {files, truncated} = await walkVideos(scanRootOf(source), listerFor(source), {
      signal: controller.signal,
      onProgress: found => setScan(sourceId, {phase: 'listing', found}),
    });
    const previous = new Map((getNetlibLibrary(sourceId)?.items || []).map(item => [item.id, item]));
    const items = groupNetlib(sourceId, files).map(item => {
      const before = previous.get(item.id);
      return before?.match ? {...item, match: before.match} : item;
    });
    let library: NetlibLibrary = {sourceId, scannedAt: Date.now(), items, ...(truncated ? {truncated} : {})};
    setLibrary(library);

    if (getSourceSettings(sourceId).matchOnline) {
      setScan(sourceId, {phase: 'matching', found: files.length});
      const pending = items.filter(item => !item.match);
      let changed = 0;
      await matchItems(pending, {
        tmdbKey: getTmdbApiKey(),
        signal: controller.signal,
        onMatch: (id, match) => {
          if (!match) return;
          library = {...library, items: library.items.map(item => (item.id === id ? {...item, match} : item))};
          changed += 1;
          // Posters appear in batches rather than one write per title.
          if (changed % 8 === 0) setLibrary(library);
        },
      });
      setLibrary(library);
    }
  } catch (error: any) {
    if (!controller.signal.aborted) {
      useNetlibStore.setState(state => ({errors: {...state.errors, [sourceId]: error?.message || 'Could not scan this source'}}));
    }
  } finally {
    scans.delete(sourceId);
    setScan(sourceId, undefined);
  }
};

export const cancelNetlibScan = (sourceId: string): void => scans.get(sourceId)?.abort();

/** Fix match: sets the title's match by hand, or with undefined clears it so the next scan looks it up again. */
export const setNetlibMatch = (id: string, match: NetlibMatch | undefined): void => {
  const library = getNetlibLibrary(sourceIdOfItem(id));
  if (!library) return;
  setLibrary({
    ...library,
    items: library.items.map(item => {
      if (item.id !== id) return item;
      const {match: _old, ...rest} = item;
      return match ? {...rest, match: {...match, manual: true}} : rest;
    }),
  });
};
