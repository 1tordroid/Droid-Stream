import type {PreparedDownloadDestination} from '../downloadDestination';
import type {DownloadItem} from '../zustand/downloadsStore';

export interface DownloadBackendContext {
  record: DownloadItem;
  destination: PreparedDownloadDestination;
}

export interface DownloadBackend {
  directToSaf?: boolean;
  preservePartialOnFailure?: boolean;
  preserveStagingOnFailure?: boolean;
  restartOnResume?: boolean;
  start(context: DownloadBackendContext): Promise<void>;
  pause?(downloadId: string): Promise<void>;
  resume?(downloadId: string): Promise<void>;
  cancel(downloadId: string): Promise<void>;
  cleanup(downloadId: string, record?: DownloadItem): Promise<void>;
  /** Ends a live job and keeps its data, so it can start again with another link. */
  stopKeepingData?(downloadId: string): Promise<void>;
  /**
   * Moves the saved part to [url] when it serves the same file. Resolves false
   * (nothing changed) when it does not.
   */
  relink?(record: DownloadItem, url: string, headers?: Record<string, string>): Promise<boolean>;
}

export class DownloadPauseSupportError extends Error {
  constructor(message = 'This server does not support pausing this download') {
    super(message);
    this.name = 'DownloadPauseSupportError';
  }
}

export class DownloadPausedError extends Error {
  constructor() { super('Download paused'); this.name = 'DownloadPausedError'; }
}
