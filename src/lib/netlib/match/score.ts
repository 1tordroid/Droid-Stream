import {normalizeTitle} from '../ids';

export interface MatchCandidate {
  title: string;
  originalTitle?: string;
  year?: number;
  /** Higher is better known; breaks near ties. */
  popularity?: number;
}

/** Below this a candidate is not used: no poster is better than the wrong one. */
export const MATCH_THRESHOLD = 0.72;

const withoutArticle = (value: string) => value.replace(/^(the|a|an) /, '');

const tokens = (value: string) => new Set(withoutArticle(value).split(' ').filter(Boolean));

/** 0 to 1: how alike two titles are, after normalising. */
export const titleSimilarity = (a: string, b: string): number => {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (withoutArticle(x) === withoutArticle(y)) return 0.97;
  if (x.replace(/ /g, '') === y.replace(/ /g, '')) return 0.95;
  const left = tokens(x);
  const right = tokens(y);
  let shared = 0;
  left.forEach(word => {
    if (right.has(word)) shared += 1;
  });
  const union = left.size + right.size - shared;
  const jaccard = union ? shared / union : 0;
  // "Star Wars" for "Star Wars Episode IV A New Hope": a prefix is close, not equal.
  const prefix = withoutArticle(y).startsWith(`${withoutArticle(x)} `) || withoutArticle(x).startsWith(`${withoutArticle(y)} `);
  return Math.max(jaccard * 0.9, prefix ? 0.75 : 0);
};

/** Title similarity moved by the year: the same year helps, a different one hurts. */
export const scoreCandidate = (want: {title: string; year?: number}, candidate: MatchCandidate): number => {
  const similarity = Math.max(
    titleSimilarity(want.title, candidate.title),
    candidate.originalTitle ? titleSimilarity(want.title, candidate.originalTitle) : 0,
  );
  if (!want.year || !candidate.year) return similarity - (want.year && !candidate.year ? 0.05 : 0);
  const gap = Math.abs(want.year - candidate.year);
  return similarity + (gap === 0 ? 0.15 : gap === 1 ? 0.05 : -0.35);
};

/** The best candidate at or above the threshold, ties going to the better known. */
export const pickBest = <T extends MatchCandidate>(want: {title: string; year?: number}, candidates: T[]): T | undefined => {
  let best: {candidate: T; score: number} | undefined;
  for (const candidate of candidates) {
    const score = scoreCandidate(want, candidate);
    if (score < MATCH_THRESHOLD) continue;
    if (
      !best ||
      score > best.score + 0.001 ||
      (Math.abs(score - best.score) <= 0.001 && (candidate.popularity || 0) > (best.candidate.popularity || 0))
    ) {
      best = {candidate, score};
    }
  }
  return best?.candidate;
};
