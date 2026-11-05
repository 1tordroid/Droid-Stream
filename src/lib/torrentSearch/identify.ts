import {parseRelease} from '../releaseName';
import {findImdb, type StremioMeta} from '../stremio';
import type {TorrentResult} from './types';

export interface Identified {
  title: string;
  type: 'movie' | 'series';
  year?: number;
  meta?: StremioMeta;
}

/** The title most results agree on, e.g. "Dune Part Two (2024)". */
export const dominantTitle = (rows: TorrentResult[]): Omit<Identified, 'meta'> | undefined => {
  const counts = new Map<string, {title: string; year?: number; series: number; total: number}>();
  for (const row of rows.slice(0, 25)) {
    const parsed = parseRelease(row.title);
    if (!parsed.title || parsed.title.length < 2) continue;
    const key = parsed.title.toLowerCase();
    const entry = counts.get(key) || {title: parsed.title, year: parsed.year, series: 0, total: 0};
    entry.total += 1 + Math.log10(1 + row.seeders);
    if (parsed.season !== undefined || parsed.seasonPack) entry.series += 1;
    entry.year = entry.year || parsed.year;
    counts.set(key, entry);
  }
  const best = Array.from(counts.values()).sort((a, b) => b.total - a.total)[0];
  if (!best || best.total < 2) return undefined;
  return {title: best.title, year: best.year, type: best.series > 0 ? 'series' : 'movie'};
};

const cache = new Map<string, Identified | null>();

export const identifyResults = async (rows: TorrentResult[]): Promise<Identified | undefined> => {
  const guess = dominantTitle(rows);
  if (!guess) return undefined;
  const key = `${guess.type}:${guess.title}:${guess.year ?? ''}`.toLowerCase();
  if (cache.has(key)) return cache.get(key) || undefined;
  const meta = await findImdb(guess.title, guess.type, guess.year).catch(() => undefined);
  const result = meta ? {...guess, meta} : null;
  cache.set(key, result);
  return result || undefined;
};
