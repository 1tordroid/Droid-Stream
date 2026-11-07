import type {OMDBResult, OMDBResponse, OMDBTitle} from '../../types/omdb';

/** The app's shared free key (1,000 requests a day for everyone together). */
export const OMDB_API_KEY = '7755307f';
const BASE_URL = 'https://www.omdbapi.com';

export const searchOMDB = async (query: string): Promise<OMDBResult[]> => {
  if (!query) {
    return [];
  }

  try {
    const response = await fetch(
      `${BASE_URL}/?apikey=${OMDB_API_KEY}&s=${encodeURIComponent(query)}`,
    );
    const data: OMDBResponse = await response.json();
    return data.Response === 'True' ? data.Search : [];
  } catch (error) {
    console.error('OMDB search error:', error);
    return [];
  }
};

/**
 * One title by IMDb id, with its ratings. Uses [apiKey] when given, else the
 * shared key. Throws on a network error or when OMDb answers with an error
 * (unknown id, daily limit reached, bad key).
 */
export const fetchOmdbTitle = async (
  imdbId: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<OMDBTitle> => {
  const key = apiKey?.trim() || OMDB_API_KEY;
  const response = await fetch(
    `${BASE_URL}/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(imdbId)}&tomatoes=true`,
    {signal},
  );
  const data = (await response.json()) as OMDBTitle;
  if (data?.Response !== 'True') {
    throw new Error(data?.Error || `OMDb error ${response.status}`);
  }
  return data;
};
