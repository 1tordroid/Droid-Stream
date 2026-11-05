import {allEngines} from './engines';
import {dedupe} from './rank';
import {readSearchSettings, type TorrentSearchSettings} from './store';
import type {EngineStatus, TorrentCategory, TorrentEngine, TorrentResult} from './types';

export const engineEnabled = (engine: TorrentEngine, settings: TorrentSearchSettings): boolean =>
  settings.engines[engine.id]?.enabled ?? engine.enabledByDefault;

export const engineBaseUrl = (engine: TorrentEngine, settings: TorrentSearchSettings): string => {
  const mirror = settings.engines[engine.id]?.mirror;
  if (mirror && /^https?:\/\//i.test(mirror)) return mirror.replace(/\/+$/, '');
  return engine.mirrors[0];
};

/** Engines that are on and cover the category. */
export const activeEngines = (category: TorrentCategory, settings = readSearchSettings()): TorrentEngine[] =>
  allEngines(settings.torznab, settings.adapters).filter(
    engine => engineEnabled(engine, settings) && (category === 'all' || engine.categories.includes(category) || engine.categories.includes('all')),
  );

export const findEngine = (id: string, settings = readSearchSettings()): TorrentEngine | undefined =>
  allEngines(settings.torznab, settings.adapters).find(engine => engine.id === id);

export interface SearchRun {
  promise: Promise<TorrentResult[]>;
  cancel: () => void;
}

const withTimeout = <T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms);
    const onAbort = () => reject(new Error('Cancelled'));
    signal.addEventListener?.('abort', onAbort);
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener?.('abort', onAbort);
    });
  });

/**
 * Asks every enabled site at once. `onUpdate` fires as each site answers, so
 * results appear progressively, and a slow or blocked site never holds up the rest.
 */
export const searchAll = (
  query: string,
  options: {
    category: TorrentCategory;
    page?: number;
    engines?: TorrentEngine[];
    mode?: 'search' | 'trending';
    onUpdate?: (rows: TorrentResult[], status: Record<string, EngineStatus>) => void;
  },
): SearchRun => {
  const settings = readSearchSettings();
  const controller = new AbortController();
  const engines = (options.engines || activeEngines(options.category, settings)).filter(
    engine => options.mode !== 'trending' || engine.trending,
  );
  const page = options.page || 1;
  const status: Record<string, EngineStatus> = {};
  let rows: TorrentResult[] = [];
  const emit = () => options.onUpdate?.(rows, {...status});
  engines.forEach(engine => {
    status[engine.id] = {engine: engine.id, state: 'loading', count: 0, ms: 0};
  });
  emit();

  const tasks = engines.map(async engine => {
    const started = Date.now();
    try {
      const params = {category: options.category, page, signal: controller.signal, baseUrl: engineBaseUrl(engine, settings)};
      const call = options.mode === 'trending' ? engine.trending!(params) : engine.search(query, params);
      const found = await withTimeout(call, settings.timeoutSeconds * 1000, controller.signal);
      const filtered = options.category === 'all' ? found : found.filter(row => row.category === options.category || row.category === 'other' || engine.categories.length === 1);
      rows = dedupe([...rows, ...filtered]);
      status[engine.id] = {engine: engine.id, state: 'done', count: filtered.length, ms: Date.now() - started};
    } catch (error: any) {
      status[engine.id] = {engine: engine.id, state: 'error', count: 0, ms: Date.now() - started, error: error?.message || String(error)};
    }
    if (!controller.signal.aborted) emit();
  });

  return {
    promise: Promise.all(tasks).then(() => rows),
    cancel: () => controller.abort(),
  };
};

/** Makes sure a result has a magnet or torrent link before it is used. */
export const resolveResult = async (result: TorrentResult): Promise<TorrentResult> => {
  if (result.magnet || result.torrentUrl) return result;
  const settings = readSearchSettings();
  for (const id of result.engines) {
    const engine = findEngine(id, settings);
    if (!engine?.resolve) continue;
    const controller = new AbortController();
    try {
      return await withTimeout(engine.resolve(result, {signal: controller.signal, baseUrl: engineBaseUrl(engine, settings)}), 20000, controller.signal);
    } catch {
      controller.abort();
    }
  }
  throw new Error('Could not get a magnet for this result');
};

/** Quick health check for the source list: one real search on that site only. */
export const testEngine = async (engine: TorrentEngine, query = 'ubuntu'): Promise<EngineStatus> => {
  let last: EngineStatus = {engine: engine.id, state: 'loading', count: 0, ms: 0};
  const run = searchAll(query, {
    category: 'all',
    engines: [engine],
    onUpdate: (_rows, status) => {
      if (status[engine.id]) last = status[engine.id];
    },
  });
  await run.promise.catch(() => undefined);
  return last;
};
