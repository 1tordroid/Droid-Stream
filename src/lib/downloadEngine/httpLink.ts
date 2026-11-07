/**
 * Moving a partial HTTP or FTP download to another address (edited link,
 * refreshed link, mirror) without losing the bytes already saved. The new
 * address must serve the same file: same size, byte ranges, and no validator
 * saying it changed. Otherwise nothing changes and the caller decides.
 */
import {advancedDownloadSettings, ftpOptions, ftpPasswordFor, parseFtpUrl} from './engineStore';
import {checkReplacementLink, type LinkCheck} from './linkIdentity';
import {applyMirrors} from './mirrors';
import {canRebindHttp, ftpNative, httpNative} from './native';

export class LinkMismatchError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message);
    this.name = 'LinkMismatchError';
  }
}

const isFtp = (url: string) => Boolean(parseFtpUrl(url));

/** Checks [url] against what the partial download saved. */
export const checkLinkForResume = async (
  downloadId: string,
  url: string,
  headers: Record<string, string> | undefined,
  expectedBytes: number,
): Promise<LinkCheck & {etag?: string; lastModified?: string}> => {
  if (isFtp(url)) {
    if (!ftpNative?.probe) throw new Error('FTP downloads need the Android app.');
    const saved = await ftpNative.resumeInfo(downloadId).catch(() => null);
    const probed = await ftpNative.probe(url, ftpPasswordFor(url) ?? null, ftpOptions());
    // FTP has no validators; REST support shows up when the download continues.
    return checkReplacementLink(
      {totalBytes: saved?.totalBytes && saved.totalBytes > 0 ? saved.totalBytes : expectedBytes},
      {size: probed.size, acceptRanges: true},
    );
  }
  if (!httpNative?.probe) throw new Error('Checking links needs the Android app.');
  const saved = (await httpNative.resumeInfo?.(downloadId).catch(() => null)) ?? null;
  const probed = await httpNative.probe(url, headers || null);
  if (probed.statusCode && probed.statusCode >= 400) {
    return {ok: false, reason: 'no-size', message: `The new link does not work (HTTP ${probed.statusCode}).`};
  }
  const result = checkReplacementLink(
    {
      totalBytes: saved?.totalBytes && saved.totalBytes > 0 ? saved.totalBytes : expectedBytes,
      etag: saved?.etag,
      lastModified: saved?.lastModified,
    },
    {size: Number(probed.size), etag: probed.etag, lastModified: probed.lastModified, acceptRanges: probed.acceptRanges},
  );
  return {...result, etag: probed.etag, lastModified: probed.lastModified};
};

/**
 * Makes the native downloader continue this download from [url]. Does nothing
 * when it already uses that address or has saved nothing. Throws
 * LinkMismatchError when the address serves another file.
 */
export const bindLinkForResume = async (
  downloadId: string,
  url: string,
  headers: Record<string, string> | undefined,
  expectedBytes: number,
): Promise<void> => {
  if (isFtp(url)) {
    const saved = await ftpNative?.resumeInfo(downloadId).catch(() => null);
    if (!saved) return;
    const check = await checkLinkForResume(downloadId, url, headers, expectedBytes);
    if (!check.ok) throw new LinkMismatchError(check.message, check.reason);
    return;
  }
  if (!canRebindHttp()) return;
  const saved = await httpNative!.resumeInfo!(downloadId).catch(() => null);
  if (!saved || saved.url === url) return;
  const check = await checkLinkForResume(downloadId, url, headers, expectedBytes);
  if (!check.ok) throw new LinkMismatchError(check.message, check.reason);
  await httpNative!.rebindUrl!(downloadId, url, check.etag ?? null, check.lastModified ?? null);
};

/** The mirrored address for this download, when a mirror rule applies and it answers. */
export const mirrorFor = async (url: string, headers: Record<string, string> | undefined): Promise<string | undefined> => {
  const mirrored = applyMirrors(url, advancedDownloadSettings.activeMirrorRules());
  if (!mirrored || !httpNative?.probe) return undefined;
  try {
    const probed = await httpNative.probe(mirrored, headers || null);
    if (probed.statusCode && probed.statusCode >= 400) return undefined;
    return mirrored;
  } catch {
    return undefined;
  }
};
