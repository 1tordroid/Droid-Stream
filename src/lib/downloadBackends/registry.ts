import type {DownloadSourceType} from '../zustand/downloadsStore';
import {hlsDownloadBackend} from './hlsBackend';
import {httpDownloadBackend} from './httpBackend';
import {torrentDownloadBackend} from './torrentBackend';
import type {DownloadBackend} from './types';
import {ytdlpDownloadBackend} from './ytdlpBackend';

const backends: Record<DownloadSourceType, DownloadBackend> = {
  http: httpDownloadBackend,
  hls: hlsDownloadBackend,
  torrent: torrentDownloadBackend,
  ytdlp: ytdlpDownloadBackend,
};

export const getDownloadBackend = (
  sourceType: DownloadSourceType,
): DownloadBackend => backends[sourceType];
