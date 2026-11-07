import {getDomain} from 'tldts';

/**
 * Provider supplied URLs are untrusted. Everything the sandbox asks the native
 * host to fetch (or open in a WebView) passes through here first.
 *
 * Ported from `vega-desktop/src/lib/services/ProviderManager.ts` with an extra
 * guard the desktop version lacks: redirect hops are re-validated by the
 * caller, because a public URL can otherwise 302 into the local network.
 */

const isPrivateIpv4 = (parts: number[]): boolean => {
  const [first, second] = parts;
  if (first === 10 || first === 127 || first === 0) {
    return true;
  }
  if (first === 169 && second === 254) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  if (first === 100 && second >= 64 && second <= 127) {
    return true;
  }
  // multicast and reserved
  return first >= 224;
};

const parseIpv4 = (value: string): number[] | null => {
  const parts = value.split('.');
  if (parts.length !== 4 || !parts.every(part => /^\d{1,3}$/.test(part))) {
    return null;
  }
  const bytes = parts.map(Number);
  return bytes.every(byte => byte <= 255) ? bytes : null;
};

/**
 * The 16 bytes of an IPv6 literal (no brackets), or null when it is not one.
 * Handles `::` compression, a zone id and a dotted IPv4 tail
 * (`::ffff:127.0.0.1`), since URL parsers differ in how they normalise these.
 */
export const parseIpv6 = (value: string): number[] | null => {
  const address = value.split('%')[0];
  if (!address.includes(':') || !/^[0-9a-f:.]+$/i.test(address)) {
    return null;
  }
  const halves = address.split('::');
  if (halves.length > 2) {
    return null;
  }
  const toWords = (part: string): number[] | null => {
    if (part === '') {
      return [];
    }
    const words: number[] = [];
    const groups = part.split(':');
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (i === groups.length - 1 && group.includes('.')) {
        const ipv4 = parseIpv4(group);
        if (!ipv4) {
          return null;
        }
        words.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
      } else if (/^[0-9a-f]{1,4}$/i.test(group)) {
        words.push(parseInt(group, 16));
      } else {
        return null;
      }
    }
    return words;
  };
  const head = toWords(halves[0]);
  const tail = halves.length === 2 ? toWords(halves[1]) : [];
  if (!head || !tail) {
    return null;
  }
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) {
    return null;
  }
  const words = [...head, ...new Array<number>(missing).fill(0), ...tail];
  return words.flatMap(word => [word >> 8, word & 0xff]);
};

const isPrivateIpv6 = (bytes: number[]): boolean => {
  const zeros = (from: number, to: number) =>
    bytes.slice(from, to).every(byte => byte === 0);
  // ::/96 (with :: and ::1) and ::ffff:0:0/96 carry an IPv4 address.
  if (
    zeros(0, 10) &&
    ((bytes[10] === 0 && bytes[11] === 0) ||
      (bytes[10] === 0xff && bytes[11] === 0xff))
  ) {
    return isPrivateIpv4(bytes.slice(12));
  }
  // 64:ff9b::/96, NAT64 into IPv4.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    zeros(4, 12)
  ) {
    return true;
  }
  // 2002::/16, 6to4 with the IPv4 address in bytes 2-5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isPrivateIpv4(bytes.slice(2, 6));
  }
  return (
    (bytes[0] & 0xfe) === 0xfc || // fc00::/7 unique local
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) || // fe80::/10 link local
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) || // fec0::/10 site local
    bytes[0] === 0xff // ff00::/8 multicast
  );
};

export const isPrivateHostname = (hostname: string): boolean => {
  // A trailing dot names the same host ("localhost." is localhost).
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');

  if (
    normalized === '' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '::' ||
    normalized === '0.0.0.0' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    return true;
  }

  const ipv4 = normalized.split('.');
  if (ipv4.length === 4) {
    const parts = ipv4.map(Number);
    if (
      parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    ) {
      return isPrivateIpv4(parts);
    }
  }

  if (normalized.includes(':')) {
    const bytes = parseIpv6(normalized);
    // Something with a colon that is not an IPv6 address is no valid host.
    return bytes === null || isPrivateIpv6(bytes);
  }

  return false;
};

/**
 * Only http/https, no embedded credentials, no private network targets.
 * Throws on anything else so the sandbox gets a plain rejection.
 */
export const validateProviderUrl = (value: unknown): URL => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Provider URL is required');
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Provider URL is not valid');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Provider URL is not allowed');
  }
  if (url.username || url.password) {
    throw new Error('Provider URL is not allowed');
  }
  if (isPrivateHostname(url.hostname)) {
    throw new Error('Provider URL is not allowed');
  }
  return url;
};

/**
 * Guard for URLs handed to `Linking.openURL`. Provider metadata reaches these
 * call sites, and on Android an attacker chosen scheme (`intent://`, `market://`,
 * `javascript:`) would run with the app's authority. Parse rather than prefix
 * match so `httpx://` and control character tricks fail closed.
 */
export const isSafeExternalUrl = (value: unknown): boolean => {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  try {
    const {protocol} = new URL(value.trim());
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/** Public-suffix-aware compare used to scope `openWebView` to the provider site. */
export const isSameSite = (a: string, b: string): boolean => {
  const left = a.toLowerCase().replace(/^www\./, '');
  const right = b.toLowerCase().replace(/^www\./, '');
  if (left === right) {
    return true;
  }
  const leftDomain = getDomain(left, {allowPrivateDomains: true});
  const rightDomain = getDomain(right, {allowPrivateDomains: true});
  return Boolean(leftDomain && rightDomain && leftDomain === rightDomain);
};
