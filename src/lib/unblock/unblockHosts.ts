/**
 * Host lists for Smart unblock. Each entry covers the host and every subdomain
 * of it. The native router gets these lists from syncUnblock, so this file is
 * the only place to change them.
 */

/**
 * Debrid API and download hosts. These never go through WARP: debrid services
 * tie an account to the user's own IP and may lock it when it changes to a
 * Cloudflare address. Direct or ByeDPI (which keeps the user's IP) only.
 */
export const DEBRID_HOSTS: readonly string[] = [
  // Real-Debrid: API, site and *.download.real-debrid.com, plus its download link domain.
  'real-debrid.com',
  'rdeb.io',
  // TorBox: API, site and download CDN.
  'torbox.app',
  'tb-cdn.st',
  'tb-cdn.io',
  // AllDebrid: API, site and *.debrid.it download hosts.
  'alldebrid.com',
  'alldebrid.fr',
  'debrid.it',
  // Premiumize: API, site and download CDN.
  'premiumize.me',
  'energycdn.com',
  // Offcloud.
  'offcloud.com',
  // Debrid-Link.
  'debrid-link.com',
  'debrid-link.fr',
  'debrid.link',
  // PikPak: API, sign-in, drive and download hosts.
  'mypikpak.com',
];

/**
 * Tracking and metadata services. In Auto they are direct unless blocked like
 * any other host; in Always WARP they still try direct first, so the account
 * does not see a new IP on every sync.
 */
export const KEEP_DIRECT_HOSTS: readonly string[] = [
  'trakt.tv',
  'simkl.com',
  'simkl.org',
  'anilist.co',
  'themoviedb.org',
  'tmdb.org',
];

export const normalizeHost = (host: string): string =>
  host.trim().toLowerCase().replace(/\.$/, '');

/** True when host is one of the entries or a subdomain of one. */
export const hostInList = (host: string, list: readonly string[]): boolean => {
  const name = normalizeHost(host);
  return list.some(entry => name === entry || name.endsWith(`.${entry}`));
};

export const isDebridHost = (host: string): boolean => hostInList(host, DEBRID_HOSTS);

export const isKeepDirectHost = (host: string): boolean => hostInList(host, KEEP_DIRECT_HOSTS);

/** Loopback and private names never leave the device or home network. */
export const isLocalHost = (host: string): boolean => {
  const name = normalizeHost(host).replace(/^\[|\]$/g, '');
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local')) return true;
  if (name === '::1' || /^f[cd][0-9a-f]{2}:/.test(name) || /^fe80:/.test(name)) return true;
  const parts = name.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 127 || a === 10 || a === 0 || (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
};
