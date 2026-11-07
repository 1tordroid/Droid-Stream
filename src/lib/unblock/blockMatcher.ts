/**
 * Decides whether a response or DNS answer is an ISP block. The native router
 * (SmartUnblock.kt) does the same checks with the same BLOCK_RULES; keep the
 * two in step.
 */
import {BLOCK_RULES, type BlockRules} from './blockSignatures';

export interface ResponseSample {
  status: number;
  /** The URL that was asked for. */
  requestUrl: string;
  /** Every URL the response redirected to, in order. */
  redirects?: string[];
  contentType?: string;
  /** The start of the body; only read for small HTML pages. */
  body?: string;
  bodyBytes?: number;
}

export interface BlockMatch {
  id: string;
  source: string;
}

const hostOf = (url: string): string => {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url);
  return (match?.[1] || '').toLowerCase();
};

const regex = (source: string) => new RegExp(source, 'i');

const isHtml = (contentType?: string) =>
  !contentType || /text\/html|application\/xhtml|text\/plain/i.test(contentType);

/** Text of the page without tags, so phrases split by markup still match. */
export const pageText = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ');

export const matchBlockPage = (
  sample: ResponseSample,
  rules: BlockRules = BLOCK_RULES,
): BlockMatch | null => {
  if (rules.statusCodes.includes(sample.status)) {
    return {id: `status-${sample.status}`, source: 'any ISP'};
  }
  const origin = hostOf(sample.requestUrl);
  for (const url of sample.redirects || []) {
    // A site moving to another page of its own is not a block.
    if (hostOf(url) === origin) continue;
    const hit = rules.redirects.find(signature => regex(signature.url).test(url));
    if (hit) return {id: hit.id, source: hit.source};
  }
  if (!sample.body || !isHtml(sample.contentType)) return null;
  if ((sample.bodyBytes ?? sample.body.length) > rules.maxBodyBytes) return null;
  const text = pageText(sample.body);
  const page = rules.pages.find(signature => signature.all.every(source => regex(source).test(text)));
  return page ? {id: page.id, source: page.source} : null;
};

const ipv4ToNumber = (ip: string): number | null => {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const byte = Number(part);
    if (byte > 255) return null;
    value = value * 256 + byte;
  }
  return value;
};

const inCidr = (ip: number, cidr: string): boolean => {
  const [base, bitsText] = cidr.split('/');
  const start = ipv4ToNumber(base);
  const bits = Number(bitsText);
  if (start == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const size = 2 ** (32 - bits);
  const first = Math.floor(start / size) * size;
  return ip >= first && ip < first + size;
};

/** True for an address an ISP resolver hands out instead of the real one. */
export const isSinkholeAddress = (ip: string, rules: BlockRules = BLOCK_RULES): boolean => {
  if (rules.blockPageIps.includes(ip)) return true;
  if (ip === '::' || ip === '::1') return true;
  const value = ipv4ToNumber(ip);
  return value != null && rules.sinkholeCidrs.some(cidr => inCidr(value, cidr));
};

/**
 * The system resolver is blocking a name when it fails or gives only sinkhole
 * addresses while DNS over HTTPS gives a public address that differs.
 */
export const looksDnsBlocked = (
  system: string[] | null,
  doh: string[] | null,
  rules: BlockRules = BLOCK_RULES,
): boolean => {
  const real = (doh || []).filter(ip => !isSinkholeAddress(ip, rules));
  if (!real.length) return false;
  if (!system || !system.length) return true;
  return system.every(ip => isSinkholeAddress(ip, rules)) && !system.some(ip => real.includes(ip));
};
