import {fetchMeta, findImdb, type StremioMeta} from '../../stremio';
import type {NetlibMatch} from '../types';

const yearOf = (meta: StremioMeta) => Number(String(meta.releaseInfo || meta.year || '').slice(0, 4)) || undefined;

export const metaToMatch = (meta: StremioMeta, type: 'movie' | 'series'): NetlibMatch => {
  const year = yearOf(meta);
  return {
    type,
    title: meta.name,
    ...(year ? {year} : {}),
    imdbId: meta.id,
    ...(meta.poster ? {poster: meta.poster} : {}),
    ...(meta.background ? {background: meta.background} : {}),
    ...(meta.description ? {overview: meta.description} : {}),
    ...(meta.imdbRating ? {rating: meta.imdbRating} : {}),
    ...(Array.isArray(meta.genres) ? {genres: meta.genres.filter(genre => typeof genre === 'string')} : {}),
  };
};

/** The lookup used without a TMDB key: Cinemeta's search, scored by findImdb. */
export const matchCinemeta = async (title: string, type: 'movie' | 'series', year?: number): Promise<NetlibMatch | undefined> => {
  const meta = await findImdb(title, type, year);
  return meta?.id?.startsWith('tt') ? metaToMatch(meta, type) : undefined;
};

/** A title by its IMDb id, for an id tag in a file or folder name. */
export const cinemetaById = async (imdbId: string, type: 'movie' | 'series'): Promise<NetlibMatch | undefined> => {
  const meta = await fetchMeta(type, imdbId);
  return meta?.name ? metaToMatch({...meta, id: meta.id || imdbId}, type) : undefined;
};
