import {openStore} from '../storage/openStore';
import type {
  SponsorCategory,
  YtdlAudioFormat,
  YtdlContainer,
  YtdlKind,
  YtdlSponsorMode,
  YtdlSubtitleMode,
} from './types';

const storage = openStore('droid-stream-ytdl');
const KEY = 'settings';

export interface YtdlTemplate {
  id: string;
  name: string;
  /** yt-dlp options, written as on a command line. */
  args: string;
}

export interface YtdlSettings {
  kind: YtdlKind;
  /** null is "Best". */
  maxHeight: number | null;
  container: YtdlContainer;
  audioFormat: YtdlAudioFormat;
  subtitleMode: YtdlSubtitleMode;
  /** Languages to pick when the video has them, such as ["en"]. */
  subtitleLanguages: string[];
  autoSubtitles: boolean;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  embedChapters: boolean;
  sponsorBlock: YtdlSponsorMode;
  sponsorCategories: SponsorCategory[];
  rateLimit: string;
  templates: YtdlTemplate[];
  /** Template applied to every download, or empty. */
  defaultTemplateId: string;
  /** Downloads go into a folder of this name inside the download location. */
  folderName: string;
  /** Open the Download sheet for shared web pages (otherwise only for known video sites). */
  offerForAllLinks: boolean;
}

export const DEFAULT_YTDL_SETTINGS: YtdlSettings = {
  kind: 'video',
  maxHeight: 1080,
  container: 'mp4',
  audioFormat: 'm4a',
  subtitleMode: 'embed',
  subtitleLanguages: ['en'],
  autoSubtitles: false,
  embedThumbnail: true,
  embedMetadata: true,
  embedChapters: true,
  sponsorBlock: 'off',
  sponsorCategories: ['sponsor', 'selfpromo', 'interaction'],
  rateLimit: '',
  templates: [],
  defaultTemplateId: '',
  folderName: 'Video downloads',
  offerForAllLinks: true,
};

export const readYtdlSettings = (): YtdlSettings => {
  try {
    const stored = JSON.parse(storage.getString(KEY) || '{}');
    return {...DEFAULT_YTDL_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {})};
  } catch {
    return {...DEFAULT_YTDL_SETTINGS};
  }
};

export const writeYtdlSettings = (settings: YtdlSettings): void => {
  storage.setString(KEY, JSON.stringify(settings));
};

export const updateYtdlSettings = (patch: Partial<YtdlSettings>): YtdlSettings => {
  const next = {...readYtdlSettings(), ...patch};
  writeYtdlSettings(next);
  return next;
};
