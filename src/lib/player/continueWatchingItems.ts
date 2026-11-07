import type {LocalTitle} from '../localContent/model';
import {localContentInfo, localContentLink} from '../localContent/library';
import {getLocalContinueWatching} from '../localContent/playback';
import {netlibContinueWatchingRows} from '../netlib/continueWatching';
import type {NetlibHistoryEntry} from '../netlib/history';
import {findNetlibItem} from '../netlib/library';
import {watchProgressStorage} from '../storage';
import type {ContinueWatchingItem} from '../zustand/continueWatchingStore';
import {getContinueWatchingRow} from './upNext';

const readProgress = (uri: string) => watchProgressStorage.getProgress(uri) || undefined;

/**
 * Everything the Continue watching row shows, latest first: the saved list
 * plus local folders and library sources (WebDAV, SMB, device folders), which
 * keep their own history. The Home row and the TV home screen both use it.
 */
export const collectContinueWatchingItems = ({
  stored,
  localTitles,
  netlibHistory,
  localOnly = false,
}: {
  stored: ContinueWatchingItem[];
  localTitles: LocalTitle[];
  netlibHistory: NetlibHistoryEntry[];
  localOnly?: boolean;
}): ContinueWatchingItem[] => {
  const localItems: ContinueWatchingItem[] = localTitles.flatMap(title => {
    const target = getLocalContinueWatching(title, readProgress);
    if (!target) return [];
    const link = localContentLink(title.id);
    return [{id: link, infoUrl: link, providerValue: 'local',
      title: title.metadata?.title || title.name, episodeTitle: target.title, seasonTitle: target.seasonTitle,
      episode: {id: target.episode.uri, link: target.episode.uri, title: target.title},
      type: localContentInfo(title).type || 'series', poster: title.metadata?.poster, background: title.metadata?.background,
      position: target.position, duration: target.duration, updatedAt: target.updatedAt}];
  });
  const netlibItems: ContinueWatchingItem[] = netlibContinueWatchingRows(netlibHistory, findNetlibItem, readProgress);
  return getContinueWatchingRow([...(localOnly ? [] : stored), ...localItems, ...netlibItems]);
};
