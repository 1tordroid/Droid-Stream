/**
 * What a kids profile hides. Ratings are used where the app has them (TMDB
 * certification, adult flags, provider tags and names); a title with no
 * rating stays visible, since most provider titles have none.
 */

/** Ratings at or above this age are hidden. */
export const KIDS_MAX_AGE = 12;

const ADULT_WORDS = /(^|[^a-z0-9])(18\+|adults?|xxx|porn\w*|nsfw|hentai|ecchi|erotic\w*|sex\w*|nude|nudity|mature)([^a-z0-9]|$)/i;

/** Rating codes that are adult-only without a number in them. */
const ADULT_CODES = new Set(['R', 'X', 'XXX', 'A', 'S', 'TV-MA', 'MA', 'MA15+', 'R18', 'R18+', 'RESTRICTED', 'ADULT', 'NC-17']);

/**
 * True when a certification is for teens or adults: "R", "TV-MA", "PG-13",
 * "TV-14", "15", "18", "U/A 13+", "A". "G", "PG", "TV-Y7", "U", "12" pass.
 */
export const isRestrictedCertification = (certification?: string | null): boolean => {
  const code = (certification || '').trim().toUpperCase();
  if (!code) return false;
  if (ADULT_CODES.has(code)) return true;
  const age = /(\d{1,2})/.exec(code);
  if (age) return Number(age[1]) > KIDS_MAX_AGE;
  return false;
};

/** True when any of the words (genres, tags, a name) marks adult content. */
export const hasAdultWords = (...texts: (string | null | undefined)[]): boolean =>
  texts.some(text => Boolean(text) && ADULT_WORDS.test(text as string));

export interface RatingInfo {
  certification?: string | null;
  adult?: boolean | null;
  genres?: (string | null | undefined)[];
  tags?: (string | null | undefined)[];
}

/** Whether a kids profile may open a title. Unknown ratings pass. */
export const isKidsSafe = ({certification, adult, genres, tags}: RatingInfo): boolean =>
  adult !== true && !isRestrictedCertification(certification) && !hasAdultWords(...(genres || []), ...(tags || []));

/** Live TV groups a kids profile keeps. */
const KIDS_GROUP = /kid|animation|cartoon/i;

export const isKidsChannelGroup = (group?: string | null): boolean => Boolean(group) && KIDS_GROUP.test(group as string);

/** Providers and add-ons a kids profile hides: adult-flagged or adult-named. */
export const isAdultSource = (source: {name?: string; value?: string; adult?: boolean | null}): boolean =>
  source.adult === true || hasAdultWords(source.name, source.value);
