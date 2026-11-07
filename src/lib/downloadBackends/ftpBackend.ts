import {NativeEventEmitter, Platform, type EmitterSubscription} from 'react-native';
import {ftpOptions, ftpPasswordFor} from '../downloadEngine/engineStore';
import {ftpNative} from '../downloadEngine/native';
import useDownloadsStore, {type DownloadItem} from '../zustand/downloadsStore';
import {httpDownloadBackend} from './httpBackend';
import type {DownloadBackend, DownloadBackendContext} from './types';

interface FtpProgressEvent {
  downloadId: string;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
}

interface FtpStateEvent {
  downloadId: string;
  state: string;
  message?: string;
}

type FtpEvents = {
  VegaFtpDownloadProgress: [FtpProgressEvent];
  VegaFtpDownloadState: [FtpStateEvent];
};

export const hasNativeFtp = Platform.OS === 'android' && typeof ftpNative?.start === 'function';

const running = new Set<string>();

/** FTP and FTPS through the native module. Passwords come from the encrypted store. */
export const ftpDownloadBackend: DownloadBackend = {
  directToSaf: hasNativeFtp,
  preservePartialOnFailure: true,
  preserveStagingOnFailure: true,
  async start({record, destination}: DownloadBackendContext): Promise<void> {
    const native = ftpNative;
    if (!hasNativeFtp || !native) throw new Error('FTP downloads need the Android app.');
    const emitter = new NativeEventEmitter<FtpEvents>(native as never);
    const subscriptions: EmitterSubscription[] = [
      emitter.addListener('VegaFtpDownloadProgress', event => {
        if (event.downloadId !== record.id) return;
        useDownloadsStore.getState().updateProgress(record.id, event.downloadedBytes, event.totalBytes, event.speed);
      }),
      emitter.addListener('VegaFtpDownloadState', event => {
        if (event.downloadId !== record.id) return;
        if (event.state === 'waitingForNetwork') {
          useDownloadsStore.getState().updateDownload(record.id, {
            status: 'paused',
            speed: 0,
            canPause: false,
            canResume: true,
            errorCode: 'NETWORK_INTERRUPTED',
            errorMessage: event.message || 'Waiting for the FTP server',
          });
        } else if (event.state === 'connecting') {
          useDownloadsStore.getState().updateDownload(record.id, {
            status: 'starting',
            speed: 0,
            canPause: true,
            canResume: false,
            errorCode: undefined,
            errorMessage: undefined,
          });
        }
      }),
    ];
    running.add(record.id);
    useDownloadsStore.getState().updateDownload(record.id, {backendJobId: record.id, status: 'starting', canPause: true, canResume: false});
    const target = destination.directFinalDocumentUri || destination.stagingPath;
    const start = () => native.start(record.id, record.url, ftpPasswordFor(record.url) ?? null, target, ftpOptions());
    try {
      let result;
      try {
        result = await start();
      } catch (error) {
        // A job left from before a JavaScript reload: stop it, keeping the file, and start again.
        if ((error as {code?: unknown} | null)?.code !== 'DOWNLOAD_ACTIVE') throw error;
        await native.cancel(record.id, false);
        result = await start();
      }
      useDownloadsStore.getState().updateProgress(record.id, result.downloadedBytes, result.totalBytes, 0);
    } finally {
      running.delete(record.id);
      subscriptions.forEach(subscription => subscription.remove());
    }
  },
  async pause(downloadId: string): Promise<void> {
    await ftpNative!.pause(downloadId);
  },
  async resume(downloadId: string): Promise<void> {
    await ftpNative!.resume(downloadId);
  },
  async cancel(downloadId: string): Promise<void> {
    await ftpNative?.cancel(downloadId, true);
  },
  async cleanup(downloadId: string, record?: DownloadItem): Promise<void> {
    await ftpNative?.cancel(downloadId, true).catch(() => undefined);
    // The same output and staging clean-up as HTTP downloads.
    await httpDownloadBackend.cleanup(downloadId, record);
  },
};

/** Stops a running FTP job and keeps its file, for a link change. */
export const stopFtpKeepingData = async (downloadId: string): Promise<void> => {
  if (running.has(downloadId)) await ftpNative?.cancel(downloadId, false);
};
