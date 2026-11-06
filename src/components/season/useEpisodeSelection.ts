import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BackHandler, ToastAndroid} from 'react-native';
import {copyText} from '../../lib/clipboard';
import {
  EpisodeLinkTarget,
  FetchEpisodeStreams,
  copiedLinksMessage,
  resolveEpisodeLinks,
} from '../../lib/episodeLinks';
import {Stream} from '../../lib/providers/types';

export interface CopyProgress {
  current: number;
  total: number;
  action?: 'copy' | 'download';
}

interface UseEpisodeSelectionOptions {
  /** Every episode of the season, in season order. */
  items: EpisodeLinkTarget[];
  /** Selection ends when this changes, e.g. on season change. */
  resetKey: string | undefined;
  fetchStreams: FetchEpisodeStreams;
  prepareDownloads?: () => Promise<boolean>;
  downloadEpisode?: (
    episode: EpisodeLinkTarget,
    stream: Stream,
    signal: AbortSignal,
  ) => Promise<boolean>;
}

export const useEpisodeSelection = ({
  items,
  resetKey,
  fetchStreams,
  prepareDownloads,
  downloadEpisode,
}: UseEpisodeSelectionOptions) => {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState<CopyProgress | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const stopCopy = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setProgress(null);
  }, []);

  const exit = useCallback(() => {
    stopCopy();
    setSelected(new Set());
    setActive(false);
  }, [stopCopy]);

  const start = useCallback((link?: string) => {
    setSelected(new Set(link ? [link] : []));
    setActive(true);
  }, []);

  const toggle = useCallback((link: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(link)) {
        next.delete(link);
      } else {
        next.add(link);
      }
      return next;
    });
  }, []);

  const allSelected =
    items.length > 0 && items.every(item => selected.has(item.link));

  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(items.map(i => i.link)));
  }, [allSelected, items]);

  // Only count episodes of the current season.
  const selectedItems = useMemo(
    () => items.filter(item => selected.has(item.link)),
    [items, selected],
  );

  useEffect(() => {
    exit();
  }, [resetKey, exit]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const cancelCopy = useCallback(() => {
    if (!controllerRef.current) return;
    stopCopy();
    ToastAndroid.show('Cancelled', ToastAndroid.SHORT);
  }, [stopCopy]);

  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (progress) {
        cancelCopy();
      } else {
        exit();
      }
      return true;
    });
    return () => sub.remove();
  }, [active, progress, cancelCopy, exit]);

  const copyLinks = useCallback(async () => {
    if (controllerRef.current || selectedItems.length === 0) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setProgress({current: 0, total: selectedItems.length});
    const result = await resolveEpisodeLinks({
      episodes: selectedItems,
      fetchStreams,
      signal: controller.signal,
      onProgress: (current, total) => {
        if (!controller.signal.aborted) setProgress({current, total});
      },
    });
    if (result.cancelled || controllerRef.current !== controller) return;
    controllerRef.current = null;
    setProgress(null);
    if (result.links.length === 0) {
      ToastAndroid.show('No downloadable links found', ToastAndroid.SHORT);
      return;
    }
    copyText(result.links.join('\n'));
    ToastAndroid.show(
      copiedLinksMessage(result.links.length, result.skipped.length),
      ToastAndroid.LONG,
    );
  }, [fetchStreams, selectedItems]);

  const downloadSelected = useCallback(async () => {
    if (controllerRef.current || !downloadEpisode || !selectedItems.length)
      return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setProgress({current: 0, total: selectedItems.length, action: 'download'});
    let queued = 0;
    let skipped = 0;
    try {
      if (prepareDownloads && !(await prepareDownloads())) return;
      for (let index = 0; index < selectedItems.length; index++) {
        if (controller.signal.aborted) return;
        setProgress({
          current: index + 1,
          total: selectedItems.length,
          action: 'download',
        });
        try {
          const streams = await fetchStreams(
            selectedItems[index].link,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          const stream = streams?.[0];
          if (
            stream?.link &&
            (await downloadEpisode(
              selectedItems[index],
              stream,
              controller.signal,
            ))
          ) {
            queued++;
          } else {
            skipped++;
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          console.warn('Could not queue episode download', error);
          skipped++;
        }
      }
      if (!controller.signal.aborted) {
        ToastAndroid.show(
          `Queued ${queued} download${queued === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}`,
          ToastAndroid.LONG,
        );
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.warn('Could not start selected downloads', error);
        ToastAndroid.show('Could not start downloads', ToastAndroid.SHORT);
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setProgress(null);
      }
    }
  }, [downloadEpisode, fetchStreams, prepareDownloads, selectedItems]);

  return {
    active,
    selected,
    selectedCount: selectedItems.length,
    allSelected,
    progress,
    start,
    exit,
    toggle,
    toggleAll,
    copyLinks,
    downloadSelected,
    cancelCopy,
  };
};

export type EpisodeSelection = ReturnType<typeof useEpisodeSelection>;
