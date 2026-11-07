import type {SocialSite} from '../types';
import {SITE_LABELS} from '../urls';

export const ISSUES_NEW_URL = 'https://github.com/1tordroid/Droid-Stream/issues/new';

const MAX_ERROR = 500;

export interface SiteReport {
  site: SocialSite;
  /** App version, such as "5.6.1 (230)". */
  appVersion: string;
  rulesVersion: number;
  /** The message the app showed, if any. */
  error?: string;
  /** The post link; added only when the person ticked "Include the post link". */
  postUrl?: string;
  includeLink?: boolean;
  /** User names, post ids and the like to hide from the error text when the link is not shared. */
  hide?: (string | undefined)[];
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Error text without links, e-mail addresses, or the names and ids the
 * person did not choose to share, cut to a short length.
 */
export const cleanErrorText = (text: string, hide: (string | undefined)[] = []): string => {
  let clean = text
    .replace(/\bhttps?:\/\/\S+/gi, '[link]')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[e-mail]')
    .replace(/\s+/g, ' ')
    .trim();
  for (const value of hide) {
    if (value && value.length >= 2) clean = clean.replace(new RegExp(escapeRegex(value), 'gi'), '[hidden]');
  }
  return clean.length > MAX_ERROR ? `${clean.slice(0, MAX_ERROR - 1)}…` : clean;
};

/** Only an http(s) link to the site is ever put in a report, without its query (share tokens and tracking). */
const shareableLink = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return undefined;
  }
};

/** A new GitHub issue, filled in, for a site the photo downloader no longer reads. */
export const buildSiteIssueUrl = (report: SiteReport): string => {
  const label = SITE_LABELS[report.site];
  const link = report.includeLink ? shareableLink(report.postUrl) : undefined;
  const hide = link ? [] : report.hide || [];
  const error = report.error ? cleanErrorText(report.error, hide) : '';
  const body = [
    `Site: ${label}`,
    `App version: ${report.appVersion || 'unknown'}`,
    `Site rules version: ${report.rulesVersion}`,
    `Error: ${error || 'none shown'}`,
    `Post link: ${link || 'not shared'}`,
    '',
    'What happened (optional):',
    '',
  ].join('\n');
  const query = `title=${encodeURIComponent(`${label} stopped working`)}&body=${encodeURIComponent(body)}`;
  return `${ISSUES_NEW_URL}?${query}`;
};
