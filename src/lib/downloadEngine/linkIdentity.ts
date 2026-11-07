/**
 * Checks that a new link serves the same file as a partial download, so the
 * saved bytes can be kept. Pure: no React Native imports, so it runs in tests.
 */

export interface SavedIdentity {
  /** Size the partial download expects. 0 when unknown. */
  totalBytes: number;
  etag?: string | null;
  lastModified?: string | null;
}

export interface ProbedIdentity {
  /** -1 or 0 when the server did not say. */
  size: number;
  etag?: string | null;
  lastModified?: string | null;
  acceptRanges: boolean;
}

export type LinkCheck =
  | {ok: true}
  | {ok: false; reason: 'no-size' | 'size' | 'ranges' | 'changed'; message: string};

const strip = (etag: string) => etag.trim().replace(/^W\//i, '');

type Comparison = 'same' | 'different' | 'unknown';

const compare = (left: string | null | undefined, right: string | null | undefined, normalize = (value: string) => value.trim()): Comparison => {
  if (!left || !right) return 'unknown';
  return normalize(left) === normalize(right) ? 'same' : 'different';
};

const formatSize = (bytes: number): string => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
};

/**
 * Same size, byte ranges supported, and no validator says the file changed.
 * Different hosts often send different ETags for one file, so one matching
 * validator (ETag or Last-Modified) is enough.
 */
export const checkReplacementLink = (saved: SavedIdentity, probed: ProbedIdentity): LinkCheck => {
  if (!(saved.totalBytes > 0) || !(probed.size > 0)) {
    return {ok: false, reason: 'no-size', message: 'The size of the file is unknown, so the saved part cannot be checked.'};
  }
  if (saved.totalBytes !== probed.size) {
    return {
      ok: false,
      reason: 'size',
      message: `The new link is a different file (${formatSize(probed.size)}, the download is ${formatSize(saved.totalBytes)}).`,
    };
  }
  if (!probed.acceptRanges) {
    return {ok: false, reason: 'ranges', message: 'The new link cannot continue a partial download.'};
  }
  const etag = compare(saved.etag, probed.etag, strip);
  const modified = compare(saved.lastModified, probed.lastModified);
  if (etag !== 'same' && modified !== 'same' && (etag === 'different' || modified === 'different')) {
    return {ok: false, reason: 'changed', message: 'The file on the new link has changed.'};
  }
  return {ok: true};
};

export interface LinkHeaderEdit {
  cookie?: string;
  referer?: string;
  userAgent?: string;
}

const EDITABLE: Record<keyof LinkHeaderEdit, string> = {cookie: 'Cookie', referer: 'Referer', userAgent: 'User-Agent'};

/** Current Cookie, Referer and User-Agent, whatever case the stored names use. */
export const readEditableHeaders = (headers: Record<string, string> | undefined): Required<LinkHeaderEdit> => {
  const find = (name: string) =>
    Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || '';
  return {cookie: find('Cookie'), referer: find('Referer'), userAgent: find('User-Agent')};
};

/** Sets or removes Cookie, Referer and User-Agent. Other headers stay as they were. */
export const applyHeaderEdit = (headers: Record<string, string> | undefined, edit: LinkHeaderEdit): Record<string, string> => {
  const result: Record<string, string> = {...(headers || {})};
  (Object.keys(EDITABLE) as (keyof LinkHeaderEdit)[]).forEach(field => {
    const value = edit[field];
    if (value === undefined) return;
    const name = EDITABLE[field];
    Object.keys(result).forEach(key => {
      if (key.toLowerCase() === name.toLowerCase()) delete result[key];
    });
    const clean = value.replace(/[\r\n]+/g, ' ').trim();
    if (clean) result[name] = clean;
  });
  return result;
};

/** Plain-text check of a link the user typed. */
export const validateDownloadUrl = (url: string): string | undefined => {
  const value = url.trim();
  if (!value) return 'Enter a link.';
  if (/\s/.test(value)) return 'The link has spaces in it.';
  if (!/^(https?|ftps?|ftpes):\/\/[^/\s]+/i.test(value)) return 'The link must start with http://, https:// or ftp://.';
  return undefined;
};
