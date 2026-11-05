/** Identity of what is playing, passed to the player when known. */
export interface WatchMeta {
  title: string;
  type: 'movie' | 'series';
  year?: number;
  imdbId?: string;
  tmdbId?: string;
  season?: number;
  episode?: number;
  /** Set for anime when known, so AniSkip and AniList need no lookup. */
  malId?: number;
  anilistId?: number;
  anime?: boolean;
}

const SXXEXX = /\bS(\d{1,2})\s?E(\d{1,4})\b/i;

/**
 * Builds a best-effort identity from what the Vega player already knows:
 * the show title, the season label ("Season 2"), and the episode title
 * ("Episode 5", "S02E05", "5. Name").
 */
export const guessWatchMeta = (input: {primaryTitle?: string; secondaryTitle?: string; episodeTitle?: string; type?: string}): WatchMeta | undefined => {
  const title = (input.primaryTitle || '').trim();
  if (!title) return undefined;
  const episodeText = `${input.secondaryTitle || ''} ${input.episodeTitle || ''}`;
  const se = episodeText.match(SXXEXX);
  const season = se ? Number(se[1]) : Number(input.secondaryTitle?.match(/season\s*(\d{1,2})/i)?.[1] || NaN);
  const episode = se ? Number(se[2]) : Number(input.episodeTitle?.match(/(?:episode|ep\.?|^)\s*(\d{1,4})\b/i)?.[1] || NaN);
  const series = input.type === 'series' || Number.isFinite(episode);
  return {
    title,
    type: series ? 'series' : 'movie',
    season: Number.isFinite(season) ? season : series && Number.isFinite(episode) ? 1 : undefined,
    episode: Number.isFinite(episode) ? episode : undefined,
  };
};
