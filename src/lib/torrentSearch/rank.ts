import type {ResultFilters, SortKey, TorrentResult} from './types';

export interface QualityInfo {
  resolution: '2160p' | '1080p' | '720p' | '480p' | '';
  tags: string[];
  /** Camera or telesync rips: shown with a warning. */
  lowQuality: boolean;
}

const TAGS: [RegExp, string][] = [
  [/\b(x265|h\.?265|hevc)\b/i, 'HEVC'],
  [/\b(x264|h\.?264|avc)\b/i, 'H.264'],
  [/\bav1\b/i, 'AV1'],
  [/\b(dv|dolby ?vision)\b/i, 'DV'],
  [/\bhdr(10\+?)?\b/i, 'HDR'],
  [/\bremux\b/i, 'REMUX'],
  [/\b(blu-?ray|bdrip|brrip)\b/i, 'BluRay'],
  [/\bweb-?(dl|rip)?\b/i, 'WEB'],
  [/\b(atmos)\b/i, 'Atmos'],
  [/\b(ddp?5\.1|5\.1|7\.1)\b/i, '5.1+'],
  [/\b(multi|dual[ .-]?audio)\b/i, 'Multi audio'],
  [/\b(hindi)\b/i, 'Hindi'],
  [/\b(esub|subs?|subtitles?)\b/i, 'Subs'],
  [/\b(flac)\b/i, 'FLAC'],
  [/\b(320 ?kbps|mp3)\b/i, 'MP3'],
];

export const qualityOf = (title: string): QualityInfo => {
  const resolution = /\b(2160p|4k|uhd)\b/i.test(title)
    ? '2160p'
    : /\b1080[pi]\b/i.test(title)
      ? '1080p'
      : /\b720p\b/i.test(title)
        ? '720p'
        : /\b(480p|576p|dvdrip|sd)\b/i.test(title)
          ? '480p'
          : '';
  return {
    resolution,
    tags: TAGS.filter(([pattern]) => pattern.test(title)).map(([, label]) => label),
    lowQuality: /\b(cam|camrip|hdcam|ts|telesync|hdts|tc|telecine)\b/i.test(title),
  };
};

const normalize = (value: string): string =>
  value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Title match (0..1) for the query words, in order bonus included. */
export const titleMatch = (query: string, title: string): number => {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return 1;
  const text = ` ${normalize(title)} `;
  let hits = 0;
  for (const word of words) if (text.includes(` ${word} `) || text.includes(` ${word}`)) hits += 1;
  const phrase = text.includes(` ${words.join(' ')} `) ? 0.25 : 0;
  return Math.min(1, hits / words.length + phrase);
};

export const relevance = (query: string, row: TorrentResult): number => {
  const match = titleMatch(query, row.title);
  const health = Math.log10(1 + row.seeders) / 4; // 10k seeders ≈ 1
  const agreement = Math.min(0.3, (row.engines.length - 1) * 0.1);
  const penalty = qualityOf(row.title).lowQuality ? 0.2 : 0;
  return match * 2 + health + agreement - penalty;
};

/** Merges rows for the same info hash: keeps the best counts and every source. */
export const dedupe = (rows: TorrentResult[]): TorrentResult[] => {
  const byKey = new Map<string, TorrentResult>();
  for (const row of rows) {
    const key = row.infoHash || row.id;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {...row, engines: [...row.engines]});
      continue;
    }
    byKey.set(key, {
      ...existing,
      title: existing.title.length >= row.title.length ? existing.title : row.title,
      magnet: existing.magnet || row.magnet,
      torrentUrl: existing.torrentUrl || row.torrentUrl,
      detailUrl: existing.detailUrl || row.detailUrl,
      sizeBytes: existing.sizeBytes || row.sizeBytes,
      seeders: Math.max(existing.seeders, row.seeders),
      leechers: Math.max(existing.leechers, row.leechers),
      uploadedAt: existing.uploadedAt || row.uploadedAt,
      category: existing.category === 'other' ? row.category : existing.category,
      poster: existing.poster || row.poster,
      imdbId: existing.imdbId || row.imdbId,
      engines: Array.from(new Set([...existing.engines, ...row.engines])),
    });
  }
  return Array.from(byKey.values());
};

export const applyFilters = (rows: TorrentResult[], filters: ResultFilters): TorrentResult[] => {
  const exclude = filters.exclude.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const within = normalize(filters.within);
  return rows.filter(row => {
    if (filters.hideZeroSeed && row.seeders === 0 && !row.webSeeded) return false;
    if (filters.minSeeders && row.seeders < filters.minSeeders && !row.webSeeded) return false;
    if (filters.minSizeMb && row.sizeBytes && row.sizeBytes < filters.minSizeMb * 1024 * 1024) return false;
    if (filters.maxSizeMb && row.sizeBytes > filters.maxSizeMb * 1024 * 1024) return false;
    if (filters.qualities.length && !filters.qualities.includes(qualityOf(row.title).resolution || 'other')) return false;
    const title = row.title.toLowerCase();
    if (exclude.some(word => title.includes(word))) return false;
    if (within && !normalize(row.title).includes(within)) return false;
    return true;
  });
};

export const sortResults = (rows: TorrentResult[], sort: SortKey, query: string): TorrentResult[] => {
  const copy = [...rows];
  const by: Record<SortKey, (a: TorrentResult, b: TorrentResult) => number> = {
    relevance: (a, b) => relevance(query, b) - relevance(query, a),
    seeders: (a, b) => b.seeders - a.seeders,
    leechers: (a, b) => b.leechers - a.leechers,
    size: (a, b) => b.sizeBytes - a.sizeBytes,
    date: (a, b) => b.uploadedAt - a.uploadedAt,
    name: (a, b) => a.title.localeCompare(b.title),
  };
  return copy.sort((a, b) => by[sort](a, b) || b.seeders - a.seeders);
};

/** Search suggestions from history plus common release words. */
export const suggestions = (input: string, history: string[]): string[] => {
  const text = input.trim().toLowerCase();
  if (!text) return history.slice(0, 8);
  const fromHistory = history.filter(item => item.toLowerCase().includes(text));
  const extras = ['1080p', '2160p', 'x265', 'complete', 'season 1', 'web-dl'].map(word => `${input.trim()} ${word}`);
  return Array.from(new Set([...fromHistory, ...(text.length > 2 ? extras : [])])).slice(0, 8);
};
