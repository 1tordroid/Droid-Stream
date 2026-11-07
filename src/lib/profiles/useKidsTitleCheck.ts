import {useEffect, useState} from 'react';
import {hasAdultWords, isKidsSafe} from './kids';
import {useIsKidsProfile} from './useProfiles';

export type KidsVerdict = 'allowed' | 'checking' | 'blocked';

interface TitleRating {
  imdbId?: string;
  tmdbId?: number | string;
  type?: string;
  tags?: string[];
  genres?: string[];
}

/** Certification per title id, for this launch. */
const certifications = new Map<string, string | null>();
const CHECK_TIMEOUT_MS = 8000;

const lookupCertification = async (title: TitleRating): Promise<string | null> => {
  const key = `${title.type || ''}:${title.tmdbId || ''}:${title.imdbId || ''}`;
  if (certifications.has(key)) return certifications.get(key) ?? null;
  const {fetchStoryData} = require('../hooks/useTmdbStory') as typeof import('../hooks/useTmdbStory');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const story = await fetchStoryData({imdbId: title.imdbId, tmdbId: title.tmdbId, type: title.type, signal: controller.signal});
    const value = story?.certification || null;
    certifications.set(key, value);
    return value;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * On a kids profile, whether a title may be opened: blocked by adult tags or
 * genres at once, else by its TMDB certification once it is known. A title
 * without a rating, or whose rating cannot be loaded, is allowed.
 */
export const useKidsTitleCheck = (title: TitleRating | undefined): KidsVerdict => {
  const kids = useIsKidsProfile();
  const tagged = kids && hasAdultWords(...(title?.tags || []), ...(title?.genres || []));
  const lookup = kids && !tagged && Boolean(title?.imdbId || title?.tmdbId);
  const [verdict, setVerdict] = useState<KidsVerdict>(lookup ? 'checking' : 'allowed');

  useEffect(() => {
    if (!lookup || !title) {
      setVerdict('allowed');
      return;
    }
    let alive = true;
    setVerdict('checking');
    lookupCertification(title)
      .then(certification => alive && setVerdict(isKidsSafe({certification}) ? 'allowed' : 'blocked'))
      .catch(() => alive && setVerdict('allowed'));
    return () => {
      alive = false;
    };
    // The ids decide the lookup; tags and genres are checked on every render.
  }, [lookup, title?.imdbId, title?.tmdbId, title?.type]);

  if (!kids) return 'allowed';
  if (tagged) return 'blocked';
  return verdict;
};
