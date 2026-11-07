/**
 * The World source in Live TV: iptv-org's publicly listed free channels for
 * one country at a time. India is not a World country; it keeps its own
 * "Free Indian channels" source.
 *
 * Which list opens first and the countries picked are kept per profile.
 */
import {profileKey} from '../profiles/scope';
import {findCountry, INDIA, normalizeCountryCode, worldPlaylistUrl} from './countries';
import {listSources, readLiveJson, writeLiveJson, type LiveSource} from './store';

export const WORLD_PREFIX = 'world:';
/** The existing Free Indian channels source. */
export const INDIA_SOURCE_ID = 'iptv-org';
const RECENT_COUNTRIES_LIMIT = 5;

const KEYS = {
  get view() {
    return profileKey('liveView');
  },
  get country() {
    return profileKey('liveCountry');
  },
  get recent() {
    return profileKey('liveCountries');
  },
};

/** "world:gb" for a country; India goes to the Free Indian channels source. */
export const worldSourceId = (code: string | undefined): string | undefined => {
  const clean = normalizeCountryCode(code);
  if (!clean) return undefined;
  return clean === INDIA ? INDIA_SOURCE_ID : `${WORLD_PREFIX}${clean.toLowerCase()}`;
};

/** The country of a World source id ("world:gb" gives "GB"). */
export const worldCountryOf = (sourceId: string | undefined): string | undefined => {
  if (!sourceId?.startsWith(WORLD_PREFIX)) return undefined;
  const code = normalizeCountryCode(sourceId.slice(WORLD_PREFIX.length));
  return code && code !== INDIA ? code : undefined;
};

export const worldSource = (code: string | undefined): LiveSource | undefined => {
  const country = findCountry(code);
  const id = worldSourceId(country?.code);
  if (!country || !id?.startsWith(WORLD_PREFIX)) return undefined;
  return {id, kind: 'world', name: `World: ${country.name}`, url: worldPlaylistUrl(country.code)};
};

/** Any source by id, World countries included. */
export const findSource = (sourceId: string): LiveSource | undefined =>
  listSources().find(item => item.id === sourceId) || worldSource(worldCountryOf(sourceId));

// ---- Remembered choices (per profile) ----

/** The list the user last opened in Live TV. */
export const getSavedLiveView = (): string | undefined => {
  const value = readLiveJson<unknown>(KEYS.view);
  return typeof value === 'string' && value ? value : undefined;
};
export const saveLiveView = (view: string) => writeLiveJson(KEYS.view, view);

/** The World country picked last. */
export const getWorldCountry = (): string | undefined => {
  const code = normalizeCountryCode(readLiveJson<string>(KEYS.country));
  return code && code !== INDIA ? code : undefined;
};

/** Countries picked before, newest first. */
export const listRecentCountries = (): string[] => {
  const value = readLiveJson<unknown>(KEYS.recent);
  if (!Array.isArray(value)) return [];
  return value.map(item => normalizeCountryCode(typeof item === 'string' ? item : '')).filter((code): code is string => !!code);
};

/** Saves a country pick. Returns the source id to open. */
export const pickCountry = (code: string): string | undefined => {
  const clean = normalizeCountryCode(code);
  if (!clean) return undefined;
  if (clean !== INDIA) writeLiveJson(KEYS.country, clean);
  writeLiveJson(KEYS.recent, [clean, ...listRecentCountries().filter(item => item !== clean)].slice(0, RECENT_COUNTRIES_LIMIT));
  return worldSourceId(clean);
};

/** The country the World chip opens: the one picked last, else the detected one (not India). */
export const worldChipCountry = (detected: string | undefined): string | undefined => {
  const picked = getWorldCountry();
  if (picked) return picked;
  const code = normalizeCountryCode(detected);
  return code && code !== INDIA ? code : undefined;
};

/**
 * The list Live TV opens on. A saved choice wins while it still exists.
 * Otherwise Favourites when there are any (as before), then the detected
 * country: India, or no country found, opens Free Indian channels as before;
 * any other country opens its World list.
 */
export const initialLiveView = ({
  saved,
  validIds,
  hasFavourites,
  detected,
}: {
  saved: string | undefined;
  validIds: string[];
  hasFavourites: boolean;
  detected: string | undefined;
}): string => {
  if (saved && (validIds.includes(saved) || worldCountryOf(saved))) return saved;
  if (hasFavourites) return 'favourites';
  const code = normalizeCountryCode(detected);
  return code && code !== INDIA ? worldSourceId(code)! : INDIA_SOURCE_ID;
};
