/**
 * The TV guide for Favourites and Recent. Those lists mix channels from
 * several sources, so the guide groups the channels by the source they were
 * saved from and loads each source's own guide. JioTV channels load their
 * guide per channel, as on the JioTV page.
 */
import {jioChannelId} from './jio/channels';

/** Favourites and Recent: lists that mix sources. */
export const isMixedGuide = (sourceId: string): sourceId is 'favourites' | 'recent' => sourceId === 'favourites' || sourceId === 'recent';

type GuideChannel = {sourceId: string; url: string; name: string; tvgId?: string; tvgName?: string};

/** One XMLTV guide to load and the channels to keep from it. */
export interface GuideLoad {
  url: string;
  /** The sources that use this guide. */
  sourceIds: string[];
  ids: string[];
  names: string[];
  /** Changes when the channels asked for change. */
  key: string;
}

/**
 * The guides to load for these channels: one per guide address, shared by
 * the sources that use the same one. Sources without a guide address and
 * JioTV channels are left out.
 */
export const planGuideLoads = (
  channels: GuideChannel[],
  guideUrlFor: (sourceId: string) => string | undefined,
  normalize: (name: string) => string,
): GuideLoad[] => {
  const loads = new Map<string, {sourceIds: Set<string>; ids: Set<string>; names: Set<string>}>();
  const urls = new Map<string, string | undefined>();
  for (const channel of channels) {
    if (jioChannelId(channel.url)) continue;
    if (!urls.has(channel.sourceId)) urls.set(channel.sourceId, guideUrlFor(channel.sourceId));
    const url = urls.get(channel.sourceId);
    if (!url) continue;
    const load = loads.get(url) || {sourceIds: new Set<string>(), ids: new Set<string>(), names: new Set<string>()};
    loads.set(url, load);
    load.sourceIds.add(channel.sourceId);
    if (channel.tvgId) load.ids.add(channel.tvgId);
    for (const name of [channel.tvgName, channel.name]) {
      const clean = name ? normalize(name) : '';
      if (clean) load.names.add(clean);
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
