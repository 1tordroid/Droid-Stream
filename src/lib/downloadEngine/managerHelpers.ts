/**
 * Download manager helpers for the extra engines, kept out of
 * downloadManager.ts: scheduled recordings and continuing a partial download
 * with a renewed link.
 */
import type {DownloadBackend} from '../downloadBackends/types';
import {canRefreshDownloadSource, isExpiredLinkError} from '../downloadSourceRefresh';
import useDownloadsStore, {type DownloadItem} from '../zustand/downloadsStore';
import {advancedDownloadSettings, scheduledStartDelay} from './engineStore';
import {hasDebridSource, refreshLink} from './linkRefresh';

let wakeTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Leaves out recordings scheduled for later and sets one timer for the next
 * of them. Long waits are checked again every hour, so a changed clock is noticed.
 */
export const withoutScheduledLater = (items: DownloadItem[], wake: () => void): DownloadItem[] => {
  const delays: number[] = [];
  const due = items.filter(item => {
    const delay = item.sourceType === 'live' ? scheduledStartDelay(item.id) : 0;
    if (delay > 0) delays.push(delay);
    return delay <= 0;
  });
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = undefined;
  if (delays.length) {
    wakeTimer = setTimeout(() => {
      wakeTimer = undefined;
      wake();
    }, Math.min(Math.min(...delays) + 500, 60 * 60_000));
  }
  return due;
};

/** A provider or debrid link that can be fetched again. */
export const canRenewLink = (record: DownloadItem): boolean => canRefreshDownloadSource(record) || hasDebridSource(record);

/**
 * Whether an expired link after part of the file arrived should be renewed
 * and the download continued (needs a backend that can check the new link).
 */
export const shouldRenewPartial = (backend: DownloadBackend, record: DownloadItem, message: string): boolean =>
  Boolean(backend.relink) && advancedDownloadSettings.autoRefreshLinks() &&
  record.downloadedBytes > 0 && canRenewLink(record) && isExpiredLinkError(message);

/**
 * Renews the link and moves the saved part to it, when the backend confirms it
 * is the same file (size and validators). Returns false when nothing changed.
 */
export const renewPartialLink = async (
  backend: DownloadBackend,
  record: DownloadItem,
  signal: AbortSignal,
  canContinue: () => boolean,
): Promise<boolean> => {
  const fresh = await refreshLink(record, signal);
  if (!fresh || fresh.url === record.url || !canContinue()) return false;
  const current = useDownloadsStore.getState().getDownload(record.id);
  if (!current || !(await backend.relink!(current, fresh.url, fresh.headers)) || !canContinue()) return false;
  useDownloadsStore.getState().updateDownload(record.id, fresh);
  return true;
};
