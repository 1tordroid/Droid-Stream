import {useQuery} from '@tanstack/react-query';
import {useMemo} from 'react';
import {defaultRatingFetchers, loadTitleRatings, type RatingsTitle} from './load';
import {mergeRatings, parseTenScale, ratingBadges, RATING_IDS, type RatingBadge, type TitleRatings} from './ratings';
import useRatingSettings from './settings';

const HOUR_MS = 60 * 60 * 1000;

/** Fills in Cinemeta's IMDb score from the page when the lookup has none. */
export const withCinemetaHint = (data: TitleRatings | undefined, hint: number | undefined): TitleRatings => {
  if (!data) return mergeRatings({cinemeta: hint});
  if (data.imdb !== undefined || hint === undefined) return data;
  return {...data, imdb: hint, imdbFrom: 'cinemeta'};
};

/**
 * The rating badges for a title page. Shows Cinemeta's IMDb rating at once
 * when the page has it, then the full set when the lookups finish.
 */
export const useTitleRatings = (title: RatingsTitle | undefined): RatingBadge[] => {
  const show = useRatingSettings(state => state.show);
  const omdbKey = useRatingSettings(state => state.omdbKey);
  const omdbKeyChangedAt = useRatingSettings(state => state.omdbKeyChangedAt);
  const imdbId = title?.imdbId && /^tt\d+$/.test(title.imdbId) ? title.imdbId : undefined;
  const tmdbId = title?.tmdbId || undefined;
  const type = title?.type;
  const cinemetaRating = title?.cinemetaRating;
  const anyShown = RATING_IDS.some(id => show[id]);
  const tmdbMode = !show.tmdb ? 'never' : show.imdb ? 'fallback' : 'always';

  // The Cinemeta score often arrives after the page opens; it is not part of
  // the key, so its arrival does not start a second lookup.
  const query = useQuery({
    queryKey: ['titleRatings', imdbId, tmdbId, type, tmdbMode, omdbKey, omdbKeyChangedAt],
    queryFn: ({signal}) =>
      loadTitleRatings(
        {imdbId, tmdbId, type, cinemetaRating},
        {signal, tmdb: tmdbMode, fetchers: defaultRatingFetchers(omdbKey), retryFailedSince: omdbKeyChangedAt},
      ),
    enabled: anyShown && Boolean(imdbId || tmdbId),
    staleTime: 6 * HOUR_MS,
    gcTime: HOUR_MS,
    retry: false,
  });

  const data = query.data;
  return useMemo(
    () => ratingBadges(withCinemetaHint(data, parseTenScale(cinemetaRating)), show),
    [cinemetaRating, data, show],
  );
};
