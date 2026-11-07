import {create} from 'zustand';
import type {DebridId} from '../debrid/types';
import type {TorrentResult} from '../torrentSearch/types';

export interface WatchOnlineRequest {
  result: TorrentResult;
  /** Cache check results the caller already has. */
  cachedOn?: DebridId[];
  navigate: (screen: string, params?: object) => void;
}

interface WatchOnlineState {
  request?: WatchOnlineRequest;
}

/** The open Watch online sheet; the host at the app root shows it. */
export const useWatchOnlineStore = create<WatchOnlineState>(() => ({request: undefined}));

export const openWatchOnline = (request: WatchOnlineRequest): void => useWatchOnlineStore.setState({request});

export const closeWatchOnline = (): void => useWatchOnlineStore.setState({request: undefined});
