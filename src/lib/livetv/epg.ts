/**
 * Small XMLTV reader for now / next. It only keeps the current and the next
 * programme per channel, so memory stays small. Gzipped guides (.xml.gz, as
 * jiotv_go serves) are skipped: there is no gunzip in the JS runtime, and a
 * full guide is heavy. The hook in LiveTV stays ready for a lighter source.
 */

export interface Programme {
  title: string;
  start: number;
  stop: number;
}
export interface NowNext {
  now?: Programme;
  next?: Programme;
}

/** Max guide size we read, in characters. */
export const EPG_MAX_CHARS = 3_000_000;

/** XMLTV time: "20261107183000 +0530" (offset optional, UTC when missing). */
export const parseXmltvTime = (value: string): number => {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{2})?(\d{2})?/.exec(value.trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s = '00', oh, om = '00'] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (!oh) return utc;
  const sign = oh.startsWith('-') ? -1 : 1;
  const offset = sign * (Math.abs(+oh) * 60 + +om) * 60_000;
  return utc - offset;
};

const decode = (text: string) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1] || '';

/** Now and next programme per channel id, for the given time. */
export const parseNowNext = (xml: string, now = Date.now(), wanted?: Set<string>): Map<string, NowNext> => {
  const result = new Map<string, NowNext>();
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const channel = attr(match[1], 'channel');
    if (!channel || (wanted && !wanted.has(channel))) continue;
    const start = parseXmltvTime(attr(match[1], 'start'));
    const stop = parseXmltvTime(attr(match[1], 'stop'));
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= now) continue;
    const title = decode(/<title\b[^>]*>([\s\S]*?)<\/title>/.exec(match[2])?.[1] || '');
    if (!title) continue;
    const programme = {title, start, stop};
    const entry = result.get(channel) || {};
    if (start <= now) entry.now = programme;
    else if (!entry.next || start < entry.next.start) entry.next = programme;
    result.set(channel, entry);
  }
  return result;
};

export const canLoadEpg = (url?: string): url is string => !!url && /^https?:\/\//i.test(url) && !/\.gz(\?|$)/i.test(url);

/** Fetches a plain XMLTV guide; gives up on gzipped or very large ones. */
export const loadNowNext = async (url: string, wanted: Set<string>, fetcher: typeof fetch = fetch): Promise<Map<string, NowNext>> => {
  if (!canLoadEpg(url)) return new Map();
  const response = await fetcher(url);
  if (!response.ok) return new Map();
  const length = Number(response.headers?.get?.('content-length') || 0);
  if (length > EPG_MAX_CHARS) return new Map();
  const text = await response.text();
  if (text.length > EPG_MAX_CHARS) return new Map();
  return parseNowNext(text, Date.now(), wanted);
};
