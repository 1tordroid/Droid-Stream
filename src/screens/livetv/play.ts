/** Opens Live TV channels and catch-up replays in the player. */
import type {GuideProgramme} from '../../lib/livetv/guide';
import {buildCatchupUrl, catchupInfo} from '../../lib/livetv/catchup';
import type {LiveChannel} from '../../lib/livetv/m3u';
import {getJioCatchupStream, getJioStream, jioChannelId} from '../../lib/livetv/jio/channels';
import {pushRecent, type SavedChannel} from '../../lib/livetv/store';

export type GridChannel = (LiveChannel | SavedChannel) & {sourceId: string};

export const streamType = (url: string) => (/\.mp4(\?|$)/i.test(url) ? 'mp4' : /\.ts(\?|$)/i.test(url) ? 'ts' : 'm3u8');

const poster = (channel: GridChannel) => (channel.logo ? {logo: channel.logo, poster: channel.logo} : {});

/** JioTV addresses expire within hours, so a Jio channel asks for a fresh one each time it opens. */
const openJioChannel = async (navigation: any, channel: GridChannel, id: string) => {
  const stream = await getJioStream(id);
  pushRecent(channel, channel.sourceId);
  navigation.navigate('Player', {
    linkIndex: 0,
    // The placeholder address keeps the short-lived token out of history and logs.
    episodeList: [{title: channel.name, link: channel.url}],
    type: 'movie',
    primaryTitle: channel.name,
    secondaryTitle: channel.group || 'JioTV',
    poster: poster(channel),
    initialStream: {server: 'JioTV', link: stream.url, type: stream.type, headers: stream.headers, ...(stream.drm ? {drm: stream.drm} : {})},
    live: true,
  });
};

export const openChannel = (navigation: any, channel: GridChannel, sourceName: string): Promise<void> | void => {
  const jioId = jioChannelId(channel.url);
  if (jioId) return openJioChannel(navigation, channel, jioId);
  pushRecent(channel, channel.sourceId);
  navigation.navigate('Player', {
    linkIndex: 0,
    episodeList: [{title: channel.name, link: channel.url}],
    directUrl: channel.url,
    type: 'movie',
    primaryTitle: channel.name,
    secondaryTitle: channel.group || sourceName,
    poster: poster(channel),
    initialStream: {server: sourceName, link: channel.url, type: streamType(channel.url), ...(channel.headers ? {headers: channel.headers} : {})},
    live: true,
  });
};

/** Whether a past programme on this channel can be replayed. */
export const canReplayOn = (channel: GridChannel, programme: GuideProgramme, now = Date.now()): boolean => {
  const info = catchupInfo(channel);
  if (!info || programme.stop > now || programme.start < now - info.days * 86_400_000) return false;
  return info.mode === 'jio' ? !!programme.srno && !!jioChannelId(channel.url) : !!buildCatchupUrl(channel, programme, now, info);
};

/** Plays a past programme from the channel's catch-up. Saves no progress (it is marked live). */
export const openReplay = async (navigation: any, channel: GridChannel, programme: GuideProgramme, sourceName: string): Promise<void> => {
  const common = {
    linkIndex: 0,
    type: 'movie',
    primaryTitle: programme.title,
    secondaryTitle: channel.name,
    poster: poster(channel),
    live: true,
    catchup: true,
  };
  const jioId = jioChannelId(channel.url);
  if (jioId) {
    if (!programme.srno) throw new Error('This programme cannot be replayed.');
    const stream = await getJioCatchupStream(jioId, {start: programme.start, stop: programme.stop, srno: programme.srno});
    navigation.navigate('Player', {
      ...common,
      episodeList: [{title: programme.title, link: `${channel.url}@${programme.start}`}],
      initialStream: {server: 'JioTV', link: stream.url, type: stream.type, headers: stream.headers, ...(stream.drm ? {drm: stream.drm} : {})},
    });
    return;
  }
  const url = buildCatchupUrl(channel, programme);
  if (!url) throw new Error('This programme cannot be replayed.');
  navigation.navigate('Player', {
    ...common,
    episodeList: [{title: programme.title, link: url}],
    directUrl: url,
    initialStream: {server: sourceName, link: url, type: streamType(url), ...(channel.headers ? {headers: channel.headers} : {})},
  });
};
