import type {DownloadSourceType} from '../zustand/downloadsStore';
import {dashDownloadBackend} from './dashBackend';
import {ftpDownloadBackend} from './ftpBackend';
import {hlsDownloadBackend} from './hlsBackend';
import {httpDownloadBackend} from './httpBackend';
import {liveDownloadBackend} from './liveBackend';
import {torrentDownloadBackend} from './torrentBackend';
import type {DownloadBackend} from './types';

const backends: Record<DownloadSourceType, DownloadBackend> = {
  http: httpDownloadBackend,
  hls: hlsDownloadBackend,
  torrent: torrentDownloadBackend,
  dash: dashDownloadBackend,
  live: liveDownloadBackend,
  ftp: ftpDownloadBackend,
};

export const getDownloadBackend = (
  sourceType: DownloadSourceType,
): DownloadBackend => backends[sourceType];
