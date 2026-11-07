import {DeviceEventEmitter, NativeModules, Platform} from 'react-native';

interface SocialMediaNative {
  runFfmpeg(jobId: string, argsJson: string): Promise<{code: number; cancelled: boolean; log: string}>;
  cancel(jobId: string): void;
  mediaDuration(path: string): Promise<number>;
}

interface FileFetcher {
  fetchToFile(tag: string, url: string, path: string, headers: Record<string, string>): Promise<{statusCode: number}>;
  cancelFetches(tag: string): void;
}

const media = (): SocialMediaNative | undefined =>
  Platform.OS === 'android' ? (NativeModules.SocialMediaModule as SocialMediaNative | undefined) : undefined;

const fetcher = (): Partial<FileFetcher> | undefined => NativeModules.HttpDownloadModule as Partial<FileFetcher> | undefined;

/** Making videos needs the native module; photos and songs do not. */
export const canMakeSongVideos = (): boolean => Boolean(media()) && typeof fetcher()?.fetchToFile === 'function';

export const runFfmpeg = async (jobId: string, args: string[]) => {
  const module = media();
  if (!module) throw new Error('Making videos is not part of this build');
  return module.runFfmpeg(jobId, JSON.stringify(args));
};

export const cancelFfmpeg = (jobId: string): void => {
  media()?.cancel(jobId);
};

export const mediaDuration = async (path: string): Promise<number> => (await media()?.mediaDuration(path)) || 0;

/** Downloads one file through the app's HTTP client (DNS over HTTPS and WARP apply). */
export const fetchFile = async (tag: string, url: string, path: string, headers: Record<string, string>): Promise<void> => {
  const native = fetcher();
  if (!native?.fetchToFile) throw new Error('File downloads are not part of this build');
  const {statusCode} = await native.fetchToFile(tag, url, path, headers);
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(statusCode === 403 || statusCode === 410 ? 'The link expired. Open the post again.' : `The server answered ${statusCode}`);
  }
};

export const cancelFetches = (tag: string): void => {
  fetcher()?.cancelFetches?.(tag);
};

/** Encoding progress, in ms of video made. Returns the unsubscribe function. */
export const onFfmpegProgress = (jobId: string, listener: (timeMs: number) => void): (() => void) => {
  const subscription = DeviceEventEmitter.addListener('SocialMediaProgress', (payload: {jobId?: string; timeMs?: number}) => {
    if (payload?.jobId === jobId && typeof payload.timeMs === 'number') listener(payload.timeMs);
  });
  return () => subscription.remove();
};
