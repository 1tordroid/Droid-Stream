/**
 * "Edit link" on a paused or failed download: a new address and/or Cookie,
 * Referer and User-Agent. The saved part is kept when the new link serves the
 * same file; otherwise the caller is told why, and may start over.
 */
import type {DownloadItem} from '../zustand/downloadsStore';
import useDownloadsStore from '../zustand/downloadsStore';
import {storeFtpPassword} from './engineStore';
import {bindLinkForResume, checkLinkForResume, LinkMismatchError} from './httpLink';
import {applyHeaderEdit, validateDownloadUrl, type LinkHeaderEdit} from './linkIdentity';

const EDITABLE_STATUSES = new Set<DownloadItem['status']>(['paused', 'error', 'interrupted']);

export const canEditDownloadLink = (record: DownloadItem): boolean =>
  EDITABLE_STATUSES.has(record.status) &&
  !record.isSubtitle &&
  (record.sourceType === 'http' || record.sourceType === 'ftp' || record.sourceType === 'hls' || record.sourceType === 'dash');

export type EditLinkResult =
  | {status: 'continued'}
  | {status: 'restarted'}
  | {status: 'mismatch'; message: string}
  | {status: 'invalid'; message: string};

/** HLS and DASH keep finished segments only for the same address, so a new one starts over. */
export const editStartsOver = (record: DownloadItem): boolean => record.sourceType === 'hls' || record.sourceType === 'dash';

export const editDownloadLink = async (
  downloadId: string,
  edit: {url: string; headers: LinkHeaderEdit},
  options: {restart?: boolean} = {},
): Promise<EditLinkResult> => {
  const record = useDownloadsStore.getState().getDownload(downloadId);
  if (!record || !canEditDownloadLink(record)) return {status: 'invalid', message: 'This download cannot be changed now.'};
  const problem = validateDownloadUrl(edit.url);
  if (problem) return {status: 'invalid', message: problem};
  const isFtpLink = /^ftp(e?s)?:\/\//i.test(edit.url.trim());
  if (isFtpLink !== (record.sourceType === 'ftp')) {
    return {status: 'invalid', message: record.sourceType === 'ftp' ? 'Enter an FTP link.' : 'Enter an http:// or https:// link.'};
  }
  // A password in an FTP link moves to encrypted storage.
  const url = isFtpLink ? storeFtpPassword(edit.url.trim()) : edit.url.trim();
  const headers = applyHeaderEdit(record.headers, edit.headers);
  const {replaceDownloadLink} = require('../downloadManager') as typeof import('../downloadManager');

  const hasData = record.downloadedBytes > 0;
  if (options.restart || editStartsOver(record) || !hasData) {
    await replaceDownloadLink(downloadId, {url, headers}, {discardData: Boolean(options.restart && hasData)});
    return {status: options.restart ? 'restarted' : 'continued'};
  }
  const check = await checkLinkForResume(downloadId, url, headers, record.totalBytes).catch(error => ({
    ok: false as const,
    reason: 'no-size' as const,
    message: error instanceof Error ? error.message : String(error),
  }));
  if (!check.ok) return {status: 'mismatch', message: check.message};
  try {
    await replaceDownloadLink(downloadId, {url, headers}, {
      beforeRestart: () => bindLinkForResume(downloadId, url, headers, record.totalBytes),
    });
  } catch (error) {
    if (error instanceof LinkMismatchError) return {status: 'mismatch', message: error.message};
    throw error;
  }
  return {status: 'continued'};
};
