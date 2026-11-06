import type {TorrentEngine} from '../types';
import {animetosho, apibay, internetArchive, knaben, nyaa, torrentsCsv, yts} from './api';
import {bitsearch, eztv, kickass, limeTorrents, magnetDl, torlock, torrentGalaxy, x1337} from './html';
import {customEngine, type SiteAdapter} from './custom';
import {torznabEngine, type TorznabInstance} from './torznab';

/** Built-in sites, in the order they appear in the source list. */
export const BUILT_IN_ENGINES: TorrentEngine[] = [
  knaben,
  apibay,
  x1337,
  yts,
  eztv,
  nyaa,
  animetosho,
  torrentGalaxy,
  limeTorrents,
  bitsearch,
  magnetDl,
  torrentsCsv,
  internetArchive,
  kickass,
  torlock,
];

export const allEngines = (torznab: TorznabInstance[] = [], adapters: SiteAdapter[] = []): TorrentEngine[] => [
  ...torznab.map(torznabEngine),
  ...BUILT_IN_ENGINES,
  ...adapters.map(customEngine),
];

export {torznabEngine};
export type {TorznabInstance, SiteAdapter};
export {customEngine};
