export interface StoredCookie {
  domain: string;
  path: string;
  secure: boolean;
  expires: number;
  name: string;
  value: string;
}

/** Reads a Netscape cookie file, as the video downloader's sign-in screen writes it. */
export const parseNetscapeCookies = (text: string): StoredCookie[] => {
  const cookies: StoredCookie[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // "#HttpOnly_.example.com" lines are cookies; other "#" lines are comments.
    const line = raw.startsWith('#HttpOnly_') ? raw.slice('#HttpOnly_'.length) : raw;
    if (!line.trim() || line.startsWith('#')) continue;
    const fields = line.split('\t');
    if (fields.length < 7) continue;
    const [domain, , path, secure, expires, name, ...rest] = fields;
    if (!name) continue;
    cookies.push({
      domain: domain.toLowerCase(),
      path: path || '/',
      secure: secure.toUpperCase() === 'TRUE',
      expires: Number(expires) || 0,
      name,
      value: rest.join('\t'),
    });
  }
  return cookies;
};

const domainMatches = (host: string, domain: string): boolean => {
  const bare = domain.replace(/^\./, '');
  return host === bare || host.endsWith(`.${bare}`);
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

/** Cookies that a browser would send to this URL. */
export const cookiesFor = (cookies: StoredCookie[], url: string, now = Date.now()): StoredCookie[] => {
  const host = hostOf(url);
  let path = '/';
  try {
    path = new URL(url).pathname || '/';
  } catch {
    // keep "/"
  }
  const seen = new Set<string>();
  return cookies.filter(cookie => {
    if (!domainMatches(host, cookie.domain)) return false;
    if (!path.startsWith(cookie.path)) return false;
    if (cookie.expires > 0 && cookie.expires * 1000 < now) return false;
    if (seen.has(cookie.name)) return false;
    seen.add(cookie.name);
    return true;
  });
};

export const cookieHeaderFor = (cookies: StoredCookie[], url: string, now = Date.now()): string =>
  cookiesFor(cookies, url, now)
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');

export const cookieValue = (cookies: StoredCookie[], host: string, name: string, now = Date.now()): string | undefined =>
  cookiesFor(cookies, `https://${host.replace(/^\./, '')}/`, now).find(cookie => cookie.name === name)?.value;
