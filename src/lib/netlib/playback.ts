import {ToastAndroid} from 'react-native';
import {itemTitle} from './group';
import {NETLIB_PROVIDER, netlibLink} from './ids';
import {resolveNetlibStream} from './resolve';
import type {NetlibEpisode, NetlibItem, NetlibVersion} from './types';

export interface NetlibEpisodeLink {
  title: string;
  link: string;
  season?: number;
  episode?: number;
}

export const episodeLabel = (episode: NetlibEpisode): string =>
  episode.season === 0
    ? `Special ${episode.episode}`
    : `S${episode.season} E${episode.episode}${episode.lastEpisode ? `-${episode.lastEpisode}` : ''}`;

/**
 * What the player steps through: every episode of a show (its best file), or
 * the parts of the chosen movie copy in order.
 */
export const netlibEpisodeList = (item: NetlibItem, key: string): NetlibEpisodeLink[] => {
  if (item.kind === 'show') {
    return item.episodes.map(episode => ({
      title: episodeLabel(episode),
      link: (episode.versions.find(version => version.key === key) || episode.versions[0]).key,
      season: episode.season,
      episode: episode.episode,
    }));
  }
  const chosen = item.versions.find(version => version.key === key) || item.versions[0];
  if (!chosen) return [];
  const parts = chosen.part
    ? item.versions.filter(version => version.part && version.resolution === chosen.resolution).sort((a, b) => (a.part || 0) - (b.part || 0))
    : [chosen];
  return parts.map((version: NetlibVersion) => ({title: version.part ? `Part ${version.part}` : itemTitle(item), link: version.key}));
};

/** The show episode or movie copy a version key belongs to. */
export const findVersion = (item: NetlibItem, key: string): {version: NetlibVersion; episode?: NetlibEpisode} | undefined => {
  for (const episode of item.episodes) {
    const version = episode.versions.find(entry => entry.key === key);
    if (version) return {version, episode};
  }
  const version = item.versions.find(entry => entry.key === key);
  return version ? {version} : undefined;
};

/** Player route params for one file of a library title. */
export const netlibPlayerParams = (item: NetlibItem, key: string) => {
  const episodeList = netlibEpisodeList(item, key);
  const linkIndex = Math.max(0, episodeList.findIndex(entry => entry.link === key));
  const found = findVersion(item, key);
  return {
    linkIndex,
    episodeList,
    type: item.kind === 'show' ? 'series' : 'movie',
    primaryTitle: itemTitle(item),
    secondaryTitle: found?.episode ? (found.episode.season === 0 ? 'Specials' : `Season ${found.episode.season}`) : undefined,
    poster: {poster: item.match?.poster, background: item.match?.background},
    infoUrl: netlibLink(item.id),
    providerValue: NETLIB_PROVIDER,
    netlib: true,
  };
};

type Navigation = {navigate: (screen: string, params: object) => void};

/**
 * Opens the player on a library file. The address is resolved first (an SMB
 * stream, or WebDAV with its sign-in), so a source that cannot play says so
 * here instead of in the player.
 */
export const playNetlibVersion = async (navigation: Navigation, item: NetlibItem, key: string, extra: object = {}): Promise<boolean> => {
  try {
    const stream = await resolveNetlibStream(key);
    navigation.navigate('Player', {
      ...netlibPlayerParams(item, key),
      directUrl: stream.url,
      initialStream: {
        server: stream.local ? 'This device' : stream.label || 'Library',
        link: stream.url,
        type: stream.type,
        ...(stream.headers ? {headers: stream.headers} : {}),
      },
      ...extra,
    });
    return true;
  } catch (error) {
    ToastAndroid.show(error instanceof Error ? error.message : 'Could not open this video.', ToastAndroid.LONG);
    return false;
  }
};
