import type {DownloadSourceType} from '../zustand/downloadsStore';
import {hlsDownloadBackend} from './hlsBackend';
import {httpDownloadBackend} from './httpBackend';
import {torrentDownloadBackend} from './torrentBackend';
import type {DownloadBackend} from './types';
import {ytdlpDownloadBackend} from './ytdlpBackend';
import {socialDownloadBackend} from '../social/backend';

const backends: Record<DownloadSourceType, DownloadBackend> = {
  http: httpDownloadBackend,
  hls: hlsDownloadBackend,
  torrent: torrentDownloadBackend,
  ytdlp: ytdlpDownloadBackend,
  social: socialDownloadBackend,
};

export const getDownloadBackend = (
  sourceType: DownloadSourceType,
): DownloadBackend => backends[sourceType];
