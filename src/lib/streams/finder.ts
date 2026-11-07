/**
 * Finds every way to watch one title or episode: Stremio add-ons, the torrent
 * sites, and the user's debrid caches. Ranks them so "Play best" picks a
 * cached source first, then the healthiest torrent at the preferred quality.
 */
import {openStore} from '../storage/openStore';
import {checkAllCaches, connectedServices, getService, pickVideo, readDebridSettings, sendToDebrid, type DebridFile, type DebridId} from '../debrid';
import {readLanguagePrefs, normalizeLanguage} from '../languagePrefs';
import {episodeTag, parseRelease, releaseMatches} from '../releaseName';
import {readPlugins, runPlugin, type ScriptPluginStream} from '../jsPlugins';
import {fetchMeta, fetchStreams, videoId, type StremioStream} from '../stremio';
import {searchAll} from '../torrentSearch/search';
import type {TorrentResult} from '../torrentSearch/types';
import {buildMagnet, infoHashFrom, makeResult, parseSize} from '../torrentSearch/util';
import {defaultPlayBestFilters, type PlayBestFilters} from './fallback';
import {demoteFailed, recentFailures} from './failedSources';

const storage = openStore('droid-stream-finder');

export interface WantedVideo {
  title: string;
  type: 'movie' | 'series';
  year?: number;
  imdbId?: string;
  season?: number;
  episode?: number;
  poster?: string;
}

export interface Candidate {
  id: string;
  kind: 'direct' | 'torrent';
  /** Release or file name. */
  title: string;
  /** Add-on or site that offered it. */
  origin: string;
  url?: string;
  headers?: Record<string, string>;
  infoHash?: string;
  magnet?: string;
  /** Sites like Internet Archive offer a .torrent file and no magnet. */
  torrentUrl?: string;
  fileIdx?: number;
  resolution?: string;
  sizeBytes: number;
  seeders: number;
  /** Debrid services that already hold it. */
  cachedOn: DebridId[];
  /** Add-on stream already resolved through a debrid ("[RD+]" style tags). */
  debridDirect?: boolean;
  lowQuality: boolean;
  languages: string[];
}

export interface FinderPrefs {
  maxResolution: '2160p' | '1080p' | '720p' | '480p';
  preferredLanguage: string;
  avoidCam: boolean;
  /** Use a debrid for torrents that are not cached yet, instead of the phone. */
  debridForUncached: boolean;
  /** Prepare the next episode in the background after playback starts. */
  preloadNext: boolean;
  /** Also search the torrent sites, not only add-ons. */
  includeSites: boolean;
  /** Play best moves on to the next source by itself when one does not play. */
  autoFallback: boolean;
  /** Seconds a source may take to show its first frame before Play best tries the next. */
  fallbackFirstFrameSec: number;
  /** Seconds a source may sit buffering at the start before Play best tries the next. */
  fallbackStallSec: number;
  /** Limits Play best applies when it picks sources (the full list still shows everything). */
  playBestFilters: PlayBestFilters;
}

export const defaultPrefs = (): FinderPrefs => ({
  maxResolution: '1080p',
  preferredLanguage: '',
  avoidCam: true,
  debridForUncached: true,
  preloadNext: true,
  includeSites: true,
  autoFallback: true,
  fallbackFirstFrameSec: 15,
  fallbackStallSec: 20,
  playBestFilters: defaultPlayBestFilters(),
});

export const readPrefs = (): FinderPrefs => {
  try {
    const saved = JSON.parse(storage.getString('prefs') || '{}');
    return {...defaultPrefs(), ...saved, playBestFilters: {...defaultPlayBestFilters(), ...saved?.playBestFilters}};
  } catch {
    return defaultPrefs();
  }
};

export const writePrefs = (prefs: FinderPrefs): void => {
  storage.setString('prefs', JSON.stringify(prefs));
};

const RES_ORDER = ['480p', '720p', '1080p', '2160p'];

const DEBRID_TAG = /\[(RD|TB|AD|PM|DL|OC|ED|PP|PK|EN)(\+|⚡)\]|⚡|\b(RD|TB|AD|PM)\+/i;

/** Turns one Stremio stream into a candidate. Torrentio-style text gives seeders and size. */
export const fromStremio = (stream: StremioStream, origin: string): Candidate | undefined => {
  const text = [stream.name, stream.title, stream.description].filter(Boolean).join('\n');
  const firstLine = (stream.title || stream.description || stream.behaviorHints?.filename || stream.name || '').split('\n')[0];
  const parsed = parseRelease(stream.behaviorHints?.filename || firstLine);
  const resolution = parsed.resolution || (/\b4k\b/i.test(text) ? '2160p' : text.match(/\b(2160p|1080p|720p|480p)\b/i)?.[1]?.toLowerCase());
  const seeders = Number(text.match(/👤\s*(\d+)/)?.[1] || text.match(/seed(?:er)?s?\D{0,3}(\d+)/i)?.[1] || 0);
  const sizeBytes = stream.behaviorHints?.videoSize || parseSize(text.match(/💾\s*([\d.,]+\s*[KMGT]i?B)/i)?.[1] || text.match(/([\d.,]+\s*[KMGT]i?B)/i)?.[1]);
  const base = {
    title: firstLine || origin,
    origin: `${origin}${text.match(/⚙️\s*([^\n]+)/)?.[1] ? ` · ${text.match(/⚙️\s*([^\n]+)/)![1].trim()}` : ''}`,
    resolution,
    sizeBytes,
    seeders,
    cachedOn: [] as DebridId[],
    lowQuality: /\b(cam|hdcam|ts|telesync|hdts)\b/i.test(text),
    languages: parsed.language || [],
  };
  if (stream.url) {
    return {
      ...base,
      id: `url:${stream.url}`,
      kind: 'direct',
      url: stream.url,
      headers: stream.behaviorHints?.proxyHeaders?.request,
      debridDirect: DEBRID_TAG.test(stream.name || ''),
    };
  }
  if (stream.infoHash) {
    const hash = stream.infoHash.toLowerCase();
    const trackers = (stream.sources || []).filter(source => source.startsWith('tracker:')).map(source => source.slice(8));
    return {...base, id: `hash:${hash}:${stream.fileIdx ?? ''}`, kind: 'torrent', infoHash: hash, fileIdx: stream.fileIdx, magnet: buildMagnet(hash, base.title, trackers.length ? trackers : undefined)};
  }
  return undefined;
};

/** A stream from a script plugin, in the same shape as every other source. */
export const fromPlugin = (stream: ScriptPluginStream, origin: string): Candidate => {
  const url = stream.url!;
  const text = [stream.title, stream.name, stream.quality].filter(Boolean).join(' ');
  const parsed = parseRelease(text);
  const isMagnet = /^magnet:/i.test(url);
  const hash = isMagnet ? infoHashFrom(url) : undefined;
  return {
    id: isMagnet ? `hash:${hash || url}:` : `url:${url}`,
    kind: isMagnet ? 'torrent' : 'direct',
    title: stream.title || stream.name || origin,
    origin,
    url: isMagnet ? undefined : url,
    magnet: isMagnet ? url : undefined,
    infoHash: hash,
    headers: stream.headers,
    resolution: parsed.resolution || (/\b4k\b/i.test(text) ? '2160p' : undefined),
    sizeBytes: parseSize(stream.size || ''),
    seeders: 0,
    cachedOn: [],
    lowQuality: /\b(cam|hdcam|ts|telesync|hdts)\b/i.test(text),
    languages: parsed.language || [],
  };
};

export const fromSearch = (row: TorrentResult): Candidate => {
  const parsed = parseRelease(row.title);
  return {
    id: `hash:${row.infoHash || row.id}:`,
    kind: 'torrent',
    title: row.title,
    origin: row.engines.join(', '),
    infoHash: row.infoHash,
    magnet: row.magnet || (row.infoHash ? buildMagnet(row.infoHash, row.title) : undefined),
    torrentUrl: row.torrentUrl,
    resolution: parsed.resolution,
    sizeBytes: row.sizeBytes,
    seeders: row.seeders,
    cachedOn: [],
    lowQuality: /^(CAM|TS)$/.test(parsed.source || ''),
    languages: parsed.language || [],
  };
};

const preferredAudioLanguages = (): string[] => {
  try {
    const languages = readLanguagePrefs();
    return [languages.audioPrimary, languages.audioSecondary].map(normalizeLanguage).filter(Boolean);
  } catch {
    return [];
  }
};

/** Higher is better. Exported for tests. */
export const scoreCandidate = (candidate: Candidate, prefs: FinderPrefs): number => {
  let score = 0;
  if (candidate.kind === 'direct' && candidate.debridDirect) score += 1000;
  else if (candidate.cachedOn.length) score += 950;
  else if (candidate.kind === 'direct') score += 600;
  const resIndex = RES_ORDER.indexOf(candidate.resolution || '');
  const maxIndex = RES_ORDER.indexOf(prefs.maxResolution);
  if (resIndex >= 0) score += resIndex > maxIndex ? 40 - (resIndex - maxIndex) * 60 : 40 + resIndex * 25;
  if (candidate.kind === 'torrent') score += Math.min(120, Math.log10(1 + candidate.seeders) * 40) - (candidate.seeders === 0 ? 200 : 0);
  if (prefs.avoidCam && candidate.lowQuality) score -= 400;
  const wantedLanguages = prefs.preferredLanguage ? [normalizeLanguage(prefs.preferredLanguage)] : preferredAudioLanguages();
  const candidateLanguages = candidate.languages.map(normalizeLanguage);
  if (wantedLanguages[0] && candidateLanguages.includes(wantedLanguages[0])) score += 60;
  else if (wantedLanguages[1] && candidateLanguages.includes(wantedLanguages[1])) score += 30;
  // Very large files are slow on phones unless cached.
  if (!candidate.cachedOn.length && !candidate.debridDirect && candidate.sizeBytes > 25 * 1024 ** 3) score -= 50;
  return score;
};

export const rankCandidates = (candidates: Candidate[], prefs = readPrefs()): Candidate[] => {
  const unique = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = candidate.infoHash ? `hash:${candidate.infoHash}:${candidate.fileIdx ?? ''}` : candidate.id;
    const existing = unique.get(key);
    if (!existing || existing.seeders < candidate.seeders) unique.set(key, existing ? {...candidate, cachedOn: Array.from(new Set([...existing.cachedOn, ...candidate.cachedOn]))} : candidate);
  }
  return Array.from(unique.values()).sort((a, b) => scoreCandidate(b, prefs) - scoreCandidate(a, prefs));
};

export interface FinderStatus {
  label: string;
  state: 'loading' | 'done' | 'error';
  count: number;
  error?: string;
}

export const searchQueryFor = (want: WantedVideo): string =>
  want.type === 'series' && want.season !== undefined && want.episode !== undefined
    ? `${want.title} ${episodeTag(want.season, want.episode)}`
    : `${want.title}${want.year ? ` ${want.year}` : ''}`;

const memory = new Map<string, Candidate[]>();
const memoryKey = (want: WantedVideo) => `${want.imdbId || want.title}:${want.season ?? ''}:${want.episode ?? ''}`;

export const cachedCandidates = (want: WantedVideo): Candidate[] | undefined => memory.get(memoryKey(want));

/** Runs every source at once and reports as each finishes. */
export const findSources = async (
  want: WantedVideo,
  onUpdate?: (candidates: Candidate[], status: Record<string, FinderStatus>) => void,
): Promise<Candidate[]> => {
  const prefs = readPrefs();
  const status: Record<string, FinderStatus> = {};
  let all: Candidate[] = [];
  // Sources that failed for this title lately go last.
  const failed = recentFailures(want);
  const emit = () => onUpdate?.(demoteFailed(rankCandidates(all, prefs), failed), {...status});

  const addonTask = want.imdbId
    ? fetchStreams(want.type, videoId(want.imdbId, want.season, want.episode), undefined, result => {
        const label = result.addon.manifest.name;
        const found = result.streams.map(stream => fromStremio(stream, label)).filter(Boolean) as Candidate[];
        all = [...all, ...found];
        status[label] = {label, state: result.error ? 'error' : 'done', count: found.length, error: result.error};
        emit();
      })
    : Promise.resolve([]);

  const siteTask = prefs.includeSites
    ? (async () => {
        status.sites = {label: 'Torrent sites', state: 'loading', count: 0};
        emit();
        const run = searchAll(searchQueryFor(want), {category: want.type === 'series' ? 'tv' : 'movies'});
        const rows = await run.promise.catch(() => [] as TorrentResult[]);
        const matching = rows.filter(row => releaseMatches(row.title, want)).map(fromSearch);
        all = [...all, ...matching];
        status.sites = {label: 'Torrent sites', state: 'done', count: matching.length};
        emit();
      })()
    : Promise.resolve();

  const plugins = readPlugins().filter(plugin => plugin.enabled && plugin.types.includes(want.type === 'series' ? 'tv' : 'movie'));
  const pluginTask = plugins.length && want.imdbId
    ? (async () => {
        const tmdbId = (await fetchMeta(want.type, want.imdbId!).catch(() => undefined))?.moviedb_id;
        await Promise.all(plugins.map(async plugin => {
          const key = `plugin:${plugin.repoUrl}:${plugin.id}`;
          status[key] = {label: plugin.name, state: 'loading', count: 0};
          emit();
          try {
            if (!tmdbId) throw new Error('No TMDB id for this title');
            const streams = await runPlugin(plugin, {tmdbId, mediaType: want.type === 'series' ? 'tv' : 'movie', season: want.season, episode: want.episode});
            all = [...all, ...streams.map(stream => fromPlugin(stream, plugin.name))];
            status[key] = {label: plugin.name, state: 'done', count: streams.length};
          } catch (error: any) {
            status[key] = {label: plugin.name, state: 'error', count: 0, error: error?.message || String(error)};
          }
          emit();
        }));
      })()
    : Promise.resolve();

  await Promise.all([addonTask, siteTask, pluginTask]);

  const hashes = all.map(candidate => candidate.infoHash).filter(Boolean) as string[];
  if (hashes.length && connectedServices().some(service => service.canCheckCache)) {
    status.cache = {label: 'Debrid caches', state: 'loading', count: 0};
    emit();
    const cached = await checkAllCaches(hashes).catch(() => ({}) as Record<string, DebridId[]>);
    all = all.map(candidate => (candidate.infoHash && cached[candidate.infoHash] ? {...candidate, cachedOn: cached[candidate.infoHash]} : candidate));
    status.cache = {label: 'Debrid caches', state: 'done', count: Object.keys(cached).length};
  }
  const ranked = demoteFailed(rankCandidates(all, prefs), failed);
  memory.set(memoryKey(want), ranked);
  onUpdate?.(ranked, {...status});
  return ranked;
};

/** Picks the file for the wanted episode inside a season pack. */
export const pickEpisodeFile = <T extends {name: string; size?: number}>(files: T[], want?: Pick<WantedVideo, 'season' | 'episode'>): T | undefined => {
  if (want?.episode !== undefined) {
    const match = files.find(file => {
      const parsed = parseRelease(file.name.split('/').pop() || file.name);
      return parsed.episodes?.includes(want.episode!) && (want.season === undefined || parsed.season === undefined || parsed.season === want.season);
    });
    if (match) return match;
  }
  return pickVideo(files.map(file => ({id: '', size: 0, ...file})) as unknown as DebridFile[]) as unknown as T | undefined;
};

/** The service Play best uses for a torrent candidate, if any. */
export const debridFor = (candidate: Candidate, prefs = readPrefs()): DebridId | undefined => {
  const settings = readDebridSettings();
  const connected = connectedServices(settings).map(service => service.id);
  const cachedHere = candidate.cachedOn.find(id => connected.includes(id));
  if (cachedHere) return cachedHere;
  if (prefs.debridForUncached && connected.length) return connected[0];
  return undefined;
};

export const candidateToResult = (candidate: Candidate): TorrentResult =>
  makeResult({engine: 'finder', title: candidate.title, magnet: candidate.magnet, torrentUrl: candidate.torrentUrl, infoHash: candidate.infoHash || infoHashFrom(candidate.magnet), sizeBytes: candidate.sizeBytes, seeders: candidate.seeders});

/**
 * After an episode starts, quietly finds the next one and, when a debrid is
 * connected, adds its best torrent so it is cached by the time it is needed.
 */
export const preloadNext = async (next: WantedVideo): Promise<void> => {
  const prefs = readPrefs();
  if (!prefs.preloadNext) return;
  const ranked = await findSources(next).catch(() => [] as Candidate[]);
  const best = ranked[0];
  if (!best || best.kind !== 'torrent' || best.cachedOn.length || !best.magnet) return;
  const service = debridFor(best, prefs);
  if (!service || getService(service).id === 'pikpak') return;
  await sendToDebrid(service, best.magnet, {maxWaitMs: 1}).catch(() => undefined);
};
