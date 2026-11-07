import type {DownloadSourceType} from '../zustand/downloadsStore';
import {ed2kDownloadBackend} from './ed2kBackend';
import {hlsDownloadBackend} from './hlsBackend';
import {httpDownloadBackend} from './httpBackend';
import {torrentDownloadBackend} from './torrentBackend';
import type {DownloadBackend} from './types';

const backends: Record<DownloadSourceType, DownloadBackend> = {
  http: httpDownloadBackend,
  hls: hlsDownloadBackend,
  torrent: torrentDownloadBackend,
  ed2k: ed2kDownloadBackend,
};

export const getDownloadBackend = (
  sourceType: DownloadSourceType,
): DownloadBackend => backends[sourceType];
