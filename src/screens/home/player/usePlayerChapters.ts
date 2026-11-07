import {useEffect, useRef, useState} from 'react';
import {fetchServerChapters, readFileChapters} from '../../../lib/player/chapterSources';
import type {Chapter, ChapterSource} from '../../../lib/player/chapters';

interface ChapterState {
  chapters: Chapter[];
  source?: ChapterSource;
}

const NONE: ChapterState = {chapters: []};

/**
 * Chapters of what is playing. A Jellyfin, Emby or Plex item uses the
 * server's chapters (names and images); otherwise, once the video has
 * loaded, the file's own chapters are read.
 */
export function usePlayerChapters({
  streamUrls,
  serverItemKey,
  videoUri,
  headers,
  videoType,
  loaded,
  durationSeconds,
  enabled = true,
}: {
  streamUrls: (string | undefined)[];
  serverItemKey?: string;
  videoUri: string;
  headers?: Record<string, string>;
  videoType?: string;
  loaded: boolean;
  durationSeconds: number;
  enabled?: boolean;
}): ChapterState {
  const [state, setState] = useState<ChapterState>(NONE);
  const latest = useRef({streamUrls, headers, videoType, durationSeconds});
  latest.current = {streamUrls, headers, videoType, durationSeconds};
  useEffect(() => {
    let live = true;
    setState(NONE);
    if (!enabled) return;
    (async () => {
      const input = latest.current;
      const server = serverItemKey ? await fetchServerChapters(input.streamUrls).catch(() => undefined) : undefined;
      if (!live) return;
      if (server?.chapters.length) {
        setState(server);
        return;
      }
      if (!loaded || !videoUri) return;
      const chapters = await readFileChapters(videoUri, input.headers || {}, input.videoType, input.durationSeconds);
      if (live && chapters.length) setState({chapters, source: 'file'});
    })();
    return () => {
      live = false;
    };
  }, [serverItemKey, videoUri, loaded, enabled]);
  return state;
}
