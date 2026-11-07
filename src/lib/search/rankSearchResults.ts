import {sanitizeSearchQuery} from '../utils/helpers';

const tokens = (text: string): string[] =>
  sanitizeSearchQuery(text || '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean);

/**
 * How well a title matches the query, from 0 to 1. Mostly the share of query
 * words found in the title, with a little weight on how few extra words the
 * title has. An exact match scores 1.
 */
export function titleMatchScore(query: string, title: string): number {
  const q = tokens(query);
  const t = tokens(title);
  if (q.length === 0 || t.length === 0) {
    return 0;
  }
  if (q.join(' ') === t.join(' ')) {
    return 1;
  }
  const titleSet = new Set(t);
  const querySet = new Set(q);
  let hits = 0;
  querySet.forEach(word => {
    if (titleSet.has(word)) {
      hits += 1;
    }
  });
  const recall = hits / querySet.size;
  const precision = hits / titleSet.size;
  return Math.min(0.99, recall * 0.75 + precision * 0.24);
}

/** Posts sorted by title match, best first. Ties keep the provider's order. */
export function rankPosts<T extends {title?: string}>(query: string, posts: T[]): T[] {
  return posts
    .map((post, index) => ({post, index, score: titleMatchScore(query, post.title || '')}))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(entry => entry.post);
}

export function bestScore(query: string, posts: {title?: string}[]): number {
  return posts.reduce((best, post) => Math.max(best, titleMatchScore(query, post.title || '')), 0);
}

/**
 * Insert a row after every row whose best match is at least as good, so rows
 * that arrive later with the same score stay below earlier ones.
 */
export function insertRankedRow<T extends {Posts: {title?: string}[]}>(
  query: string,
  rows: T[],
  row: T,
): T[] {
  const score = bestScore(query, row.Posts);
  const at = rows.findIndex(existing => bestScore(query, existing.Posts) < score);
  if (at === -1) {
    return [...rows, row];
  }
  return [...rows.slice(0, at), row, ...rows.slice(at)];
}
