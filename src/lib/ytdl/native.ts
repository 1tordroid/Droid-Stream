import {DeviceEventEmitter, NativeModules, Platform} from 'react-native';
import {parseYtdlInfo} from './formats';
import type {YtdlEvent, YtdlInfo, YtdlResult, YtdlStatus} from './types';

interface YtdlNative {
  status(): Promise<string>;
  extract(url: string): Promise<string>;
  download(jobId: string, url: string, argsJson: string, workDir: string): Promise<string>;
  cancel(jobId: string): Promise<void>;
  latestVersion(): Promise<string>;
  update(): Promise<string>;
  resetToBundled(): Promise<string>;
  saveCookies(siteUrl: string): Promise<number>;
  clearCookies(siteUrl: string | null): Promise<void>;
  cookieSites(): Promise<string>;
}

const native = (): YtdlNative | undefined =>
  Platform.OS === 'android' ? (NativeModules.YtdlModule as YtdlNative | undefined) : undefined;

const required = (): YtdlNative => {
  const module = native();
  if (!module) throw new Error('The video downloader is not part of this build');
  return module;
};

export const ytdlSupported = (): boolean => Boolean(native());

export const ytdlStatus = async (): Promise<YtdlStatus> => {
  const module = native();
  if (!module) return {available: false, error: 'The video downloader is not part of this build'};
  return JSON.parse(await module.status()) as YtdlStatus;
};

export const ytdlExtract = async (url: string): Promise<YtdlInfo> =>
  parseYtdlInfo(await required().extract(url), url);

export const ytdlDownload = async (
  jobId: string,
  url: string,
  args: string[],
  workDir: string,
): Promise<YtdlResult> =>
  JSON.parse(await required().download(jobId, url, JSON.stringify(args), workDir)) as YtdlResult;

export const ytdlCancel = async (jobId: string): Promise<void> => {
  await native()?.cancel(jobId);
};

export const ytdlLatestVersion = (): Promise<string> => required().latestVersion();

export const ytdlUpdate = async (): Promise<{version: string; updated: boolean; pending?: boolean}> =>
  JSON.parse(await required().update());

export const ytdlResetToBundled = async (): Promise<YtdlStatus> =>
  JSON.parse(await required().resetToBundled()) as YtdlStatus;

export const ytdlSaveCookies = (siteUrl: string): Promise<number> => required().saveCookies(siteUrl);

export const ytdlClearCookies = async (siteUrl?: string): Promise<void> => {
  await required().clearCookies(siteUrl ?? null);
};

export const ytdlCookieSites = async (): Promise<string[]> => {
  const module = native();
  if (!module) return [];
  return JSON.parse(await module.cookieSites()) as string[];
};

/** Events for one job. Returns the unsubscribe function. */
export const onYtdlEvent = (jobId: string, listener: (event: YtdlEvent) => void): (() => void) => {
  const subscription = DeviceEventEmitter.addListener(
    'YtdlEvent',
    (payload: {jobId?: string; event?: string}) => {
      if (payload?.jobId !== jobId || !payload.event) return;
      try {
        listener(JSON.parse(payload.event) as YtdlEvent);
      } catch {
        // A malformed event is skipped.
      }
    },
  );
  return () => subscription.remove();
};
