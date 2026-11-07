/** Typed access to the native download helpers. Each may be missing on old builds or iOS/tvOS. */
import {NativeModules} from 'react-native';

export interface NativeProbe {
  fileName?: string;
  size: number;
  mime?: string;
  acceptRanges: boolean;
  statusCode?: number;
  etag?: string;
  lastModified?: string;
}

export interface NativeResumeInfo {
  url: string;
  etag?: string;
  lastModified?: string;
  totalBytes: number;
  hasRanges: boolean;
}

interface HttpExtras {
  probe(url: string, headers: Record<string, string> | null): Promise<NativeProbe>;
  resumeInfo?(downloadId: string): Promise<NativeResumeInfo | null>;
  rebindUrl?(downloadId: string, url: string, etag: string | null, lastModified: string | null): Promise<boolean>;
  fetchToFile(tag: string, url: string, path: string, headers: Record<string, string>): Promise<{statusCode: number}>;
  cancelFetches(tag: string): void;
}

interface MediaTools {
  concatFiles(parts: string[], outputPath: string, deleteParts: boolean): Promise<number>;
  muxTracks(videoPath: string | null, audioPath: string | null, outputPath: string, format: 'mp4' | 'matroska'): Promise<{size: number}>;
  finalizeHlsAs(videoPlaylist: string, audioPlaylist: string | null, outputPath: string, format: 'mp4' | 'mpegts'): Promise<{size: number}>;
}

export interface FtpOptions {
  passive: boolean;
  connections: number;
}

interface FtpModule {
  start(
    downloadId: string,
    url: string,
    password: string | null,
    destination: string,
    options: FtpOptions,
  ): Promise<{downloadedBytes: number; totalBytes: number}>;
  pause(downloadId: string): Promise<void>;
  resume(downloadId: string): Promise<void>;
  cancel(downloadId: string, deleteDestination: boolean): Promise<void>;
  probe(url: string, password: string | null, options: FtpOptions): Promise<{size: number; fileName: string; acceptRanges: boolean}>;
  resumeInfo(downloadId: string): Promise<{totalBytes: number; hasRanges: boolean} | null>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export const httpNative = NativeModules.HttpDownloadModule as HttpExtras | undefined;
export const mediaTools = NativeModules.MediaToolsModule as MediaTools | undefined;
export const ftpNative = NativeModules.FtpDownloadModule as FtpModule | undefined;

export const canFetchSegments = (): boolean =>
  typeof httpNative?.fetchToFile === 'function' && typeof httpNative?.cancelFetches === 'function';

export const canRebindHttp = (): boolean =>
  typeof httpNative?.resumeInfo === 'function' && typeof httpNative?.rebindUrl === 'function';

export const requireMediaTools = (): MediaTools => {
  if (!mediaTools?.concatFiles) throw new Error('This app version cannot save this kind of download. Update the app.');
  return mediaTools;
};
