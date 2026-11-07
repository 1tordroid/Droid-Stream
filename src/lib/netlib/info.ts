import type {Info} from '../providers/types';
import {itemTitle, itemYear} from './group';
import type {NetlibItem} from './types';

/** The Info screen's details for a library title. */
export const netlibInfo = (item: NetlibItem): Info => ({
  title: itemTitle(item),
  image: item.match?.background || item.match?.poster || '',
  ...(item.match?.poster ? {poster: item.match.poster} : {}),
  synopsis: item.match?.overview || '',
  ...(item.match?.imdbId || item.imdbId ? {imdbId: item.match?.imdbId || item.imdbId} : {}),
  ...(item.match?.tmdbId || item.tmdbId ? {tmdbId: item.match?.tmdbId || item.tmdbId} : {}),
  type: item.kind === 'show' ? 'series' : 'movie',
  ...(item.match?.genres ? {tags: item.match.genres} : {}),
  ...(item.match?.rating ? {rating: item.match.rating} : {}),
  populateMeta: false,
  linkList: [],
});

/** The enhanced-metadata shape Info reads (name, background, year...). */
export const netlibMeta = (item: NetlibItem) =>
  item.match
    ? {
        name: itemTitle(item),
        background: item.match.background,
        poster: item.match.poster,
        description: item.match.overview,
        genres: item.match.genres,
        imdbRating: item.match.rating,
        year: itemYear(item) ? String(itemYear(item)) : undefined,
      }
    : null;
