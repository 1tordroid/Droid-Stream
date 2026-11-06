import axios from 'axios';
import {getTmdbApiKey} from '../hooks/useTmdbStory';

export interface ArtworkMatch {
  poster?: string;
  rating?: string;
  title: string;
  year?: number;
  mediaType: 'movie' | 'tv';
}

export const lookupArtwork = async (
  title: string,
  year?: number,
): Promise<ArtworkMatch | undefined> => {
  const key = getTmdbApiKey();
  if (!key || !title) return undefined;
  const response = await axios.get('https://api.themoviedb.org/3/search/multi', {
    params: {api_key: key, query: title, year},
    timeout: 8000,
  });
  const hit = (response.data?.results || []).find(
    (item: {media_type?: string; poster_path?: string}) =>
      (item.media_type === 'movie' || item.media_type === 'tv') && item.poster_path,
  );
  if (!hit) return undefined;
  return {
    title: hit.title || hit.name || title,
    year: Number(String(hit.release_date || hit.first_air_date || '').slice(0, 4)) || year,
    rating: typeof hit.vote_average === 'number' ? hit.vote_average.toFixed(1) : undefined,
    poster: `https://image.tmdb.org/t/p/w342${hit.poster_path}`,
    mediaType: hit.media_type,
  };
};
