/**
 * The TV guide for Favourites and Recent. Those lists mix channels from
 * several sources, so the guide groups the channels by the source they were
 * saved from and loads each source's own guide. JioTV channels load their
 * guide per channel, as on the JioTV page.
 */
import {catchupInfo} from './catchup';
import {DAY, HOUR} from './guide';
import {jioChannelId} from './jio/channels';
import {channelNameKeys} from './xmltv';
import type {XmltvResult} from './xmltv';

/** Favourites and Recent: lists that mix sources. */
export const isMixedGuide = (sourceId: string): sourceId is 'favourites' | 'recent' => sourceId === 'favourites' || sourceId === 'recent';

type GuideChannel = {sourceId: string; url: string; name: string; tvgId?: string; tvgName?: string; attrs?: Record<string, string>};

/** How far back the grid goes when no channel has catch-up. */
export const NO_CATCHUP_BACK = 2 * HOUR;
export const MAX_BACK_DAYS = 7;

/** How far back to keep programmes for these channels: their longest catch-up, else two hours. */
export const guideBackMs = (channels: {url: string; attrs?: Record<string, string>}[]): number => {
  let days = 0;
  for (const channel of channels) days = Math.max(days, catchupInfo(channel)?.days || 0);
  return days ? Math.min(days, MAX_BACK_DAYS) * DAY : NO_CATCHUP_BACK;
};

/** One XMLTV guide to load and the channels to keep from it. */
export interface GuideLoad {
  url: string;
  /** The sources that use this guide (guide keys: see `keyOf` in planGuideLoads). */
  sourceIds: string[];
  ids: string[];
  names: string[];
  /** Changes when the channels asked for change. */
  key: string;
}

/**
 * The guides to load for these channels: one per guide address, shared by
 * the sources that use the same one. Sources without a guide address and
 * JioTV channels are left out. A source may have more than one guide (a
 * World country with a second file that fills gaps); each is loaded.
 *
 * `keyOf` says which guide a channel uses, by default its source; All
 * countries uses source and country, as each country has its own guide.
 */
export const planGuideLoads = <C extends GuideChannel>(
  channels: C[],
  guideUrlFor: (sourceId: string, channel: C) => string | string[] | undefined,
  normalize: (name: string) => string,
  keyOf: (channel: C) => string = channel => channel.sourceId,
): GuideLoad[] => {
  const loads = new Map<string, {sourceIds: Set<string>; ids: Set<string>; names: Set<string>}>();
  const urls = new Map<string, string[]>();
  for (const channel of channels) {
    if (jioChannelId(channel.url)) continue;
    const key = keyOf(channel);
    if (!urls.has(key)) {
      const found = guideUrlFor(channel.sourceId, channel);
      urls.set(key, (Array.isArray(found) ? found : [found]).filter((url): url is string => !!url));
    }
    for (const url of urls.get(key)!) {
      const load = loads.get(url) || {sourceIds: new Set<string>(), ids: new Set<string>(), names: new Set<string>()};
      loads.set(url, load);
      load.sourceIds.add(key);
      if (channel.tvgId) load.ids.add(channel.tvgId);
      for (const name of [channel.tvgName, channel.name]) {
        const clean = name ? normalize(name) : '';
        if (clean) load.names.add(clean);
      }
      // Without tags like "(1080p)", and the tvg-id read as a name.
      for (const clean of channelNameKeys(channel)) load.names.add(clean);
    }
  }
  return [...loads.entries()]
    .filter(([, load]) => load.ids.size || load.names.size)
    .map(([url, load]) => {
      const ids = [...load.ids];
      const names = [...load.names];
      return {url, sourceIds: [...load.sourceIds], ids, names, key: `${url}|${ids.join(',')}|${names.join(',')}`};
    });
};

/**
 * Saved channels of one source with the catch-up attributes and tvg-name of
 * the same channel in that source's playlist, for channels saved before those were
 * kept. Channels that already have them, or are not in the playlist, stay as
 * they are.
 */
export const withPlaylistDetails = <T extends {id: string; sourceId: string; attrs?: Record<string, string>; tvgName?: string}>(
  saved: T[],
  sourceId: string,
  playlist: {id: string; attrs?: Record<string, string>; tvgName?: string}[],
  keep: (attrs?: Record<string, string>) => Record<string, string> | undefined,
): T[] => {
  if (!playlist.length) return saved;
  const byId = new Map(playlist.map(channel => [channel.id, channel]));
  return saved.map(channel => {
    const match = channel.sourceId === sourceId ? byId.get(channel.id) : undefined;
    if (!match || (channel.attrs && channel.tvgName)) return channel;
    const attrs = channel.attrs || keep(match.attrs);
    const tvgName = channel.tvgName || match.tvgName;
    return {...channel, ...(attrs ? {attrs} : {}), ...(tvgName ? {tvgName} : {})};
  });
};

/**
 * Two guides as one: programmes of the first win for a channel, the second
 * fills channels and names the first does not have.
 */
export const mergeGuides = <T extends XmltvResult>(first: T | undefined, second: T): T => {
  if (!first) return second;
  return {
    ...first,
    programmes: {...second.programmes, ...first.programmes},
    names: {...second.names, ...first.names},
  };
};
