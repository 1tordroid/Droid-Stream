import {ifExists} from './file/ifExists';
import {
  ensureDownloadLocationAccess,
  getDownloadFileName,
} from './downloadLocation';
import {scheduleQueuedDownloads} from './downloadManager';
import {storeFtpPassword} from './downloadEngine/engineStore';
import {settingsStorage} from './storage';
import useDownloadsStore, {
  DownloadMediaInput,
  DownloadSubtitle,
  DownloadSourceType,
} from './zustand/downloadsStore';

import type {SkipInterval} from './providers/types';

const getSourceType = (url: string, fileType: string): DownloadSourceType => {
  if (fileType === 'torrent' || url.startsWith('magnet:')) {
    return 'torrent';
  }
  if (fileType === 'm3u8') {
    return 'hls';
  }
  if (fileType === 'mpd' || fileType === 'dash' || /\.mpd(\?|$)/i.test(url)) {
    return 'dash';
  }
  if (/^ftp(e?s)?:\/\//i.test(url)) {
    return 'ftp';
  }
  if (/^ed2k:\/\//i.test(url)) {
    return 'ed2k';
  }
  return 'http';
};

export const downloadManager = async ({
  downloadId,
  title,
  showName,
  episodeName,
  seasonTitle,
  episodeIndex,
  mediaType,
  imdbId,
  poster,
  background,
  synopsis,
  provider,
  server,
  quality,
  isSubtitle,
  infoUrl,
  sourceLink,
  url,
  fileName,
  fileType,
  headers,
  subtitles,
  skip,
}: {
  downloadId: string;
  title: string;
  showName?: string;
  episodeName?: string;
  seasonTitle?: string;
  episodeIndex?: number;
  mediaType: 'movie' | 'series';
  imdbId?: string;
  poster?: string;
  background?: string;
  synopsis?: string;
  provider?: string;
  server?: string;
  quality?: string;
  isSubtitle?: boolean;
  infoUrl?: string;
  sourceLink?: string;
  url: string;
  fileName: string;
  fileType: string;
  headers?: Record<string, string>;
  subtitles?: DownloadSubtitle[];
  skip?: SkipInterval[];
  deleteDownload: () => void;
}): Promise<void> => {
  const store = useDownloadsStore.getState();
  if (store.downloads[downloadId]?.status === 'completed') {
    return;
  }

  const downloadLocation = await ensureDownloadLocationAccess(
    settingsStorage.getDownloadLocationConfig(),
  );
  if (!downloadLocation) {
    return;
  }
  settingsStorage.setDownloadLocation(downloadLocation);

  // HLS and DASH streams are saved as one MP4.
  // An FTP password moves to encrypted storage; the download keeps only the user name.
  if (/^ftp(e?s)?:\/\//i.test(url)) {
    url = storeFtpPassword(url);
  }
  const outputFileType = fileType === 'm3u8' || getSourceType(url, fileType) === 'dash' ? 'mp4' : fileType;
  const media: DownloadMediaInput = {
    id: downloadId,
    title,
    showName,
    episodeName,
    seasonTitle,
    episodeIndex,
    type: mediaType,
    imdbId,
    poster,
    background,
    synopsis,
    provider,
    server,
    quality,
    isSubtitle,
    infoUrl,
    sourceLink,
    subtitles,
    skip,
    displayFileName: getDownloadFileName(fileName, outputFileType),
  };
  const existingFile = await ifExists(fileName);
  if (existingFile) {
    store.enqueueDownload({
      ...media,
      url,
      headers,
      videoType: outputFileType,
      sourceType: getSourceType(url, fileType),
      filePath: String(existingFile),
      status: 'completed',
      legacy: true,
    });
    return;
  }

  store.enqueueDownload({
    ...media,
    url,
    headers,
    videoType: outputFileType,
    sourceType: getSourceType(url, fileType),
    downloadLocation,
    filePath: '',
    status: 'queued',
  });

  await scheduleQueuedDownloads();
};
