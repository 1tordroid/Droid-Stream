export interface OMDBResult {
  Title: string;
  Year: string;
  imdbID: string;
  Type: 'movie' | 'series' | 'episode';
  Poster: string;
}

export interface OMDBResponse {
  Search: OMDBResult[];
  totalResults: string;
  Response: string;
}

/** A title looked up by id. Values are strings, "N/A" when missing. */
export interface OMDBTitle {
  Title?: string;
  Year?: string;
  imdbID?: string;
  imdbRating?: string;
  imdbVotes?: string;
  Metascore?: string;
  Ratings?: {Source: string; Value: string}[];
  /** Only in old OMDb answers; usually missing or "N/A". */
  tomatoMeter?: string;
  tomatoUserMeter?: string;
  Response: string;
  Error?: string;
}
