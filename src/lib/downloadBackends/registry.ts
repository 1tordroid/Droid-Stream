import type {DownloadSourceType} from '../zustand/downloadsStore';
import {dashDownloadBackend} from './dashBackend';
import {ftpDownloadBackend} from './ftpBackend';
import {ed2kDownloadBackend} from './ed2kBackend';
import {hlsDownloadBackend} from './hlsBackend';
import {httpDownloadBackend} from './httpBackend';
import {liveDownloadBackend} from './liveBackend';
import {torrentDownloadBackend} from './torrentBackend';
import type {DownloadBackend} from './types';
import {ytdlpDownloadBackend} from './ytdlpBackend';
import {socialDownloadBackend} from '../social/backend';

const backends: Record<DownloadSourceType, DownloadBackend> = {
  http: httpDownloadBackend,
  hls: hlsDownloadBackend,
  torrent: torrentDownloadBackend,
  ytdlp: ytdlpDownloadBackend,
  dash: dashDownloadBackend,
  live: liveDownloadBackend,
  ftp: ftpDownloadBackend,
  ed2k: ed2kDownloadBackend,
  social: socialDownloadBackend,
};

export const getDownloadBackend = (
  sourceType: DownloadSourceType,
): DownloadBackend => backends[sourceType];
