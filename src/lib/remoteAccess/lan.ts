/* eslint-disable no-bitwise -- IPv6 prefix checks. */
/**
 * Which client addresses may use remote control: this device and the home
 * network only (private IPv4 ranges, link-local, IPv6 unique local). The
 * native server checks the same rules before it reads a request.
 */

const ipv4Parts = (value: string): number[] | undefined => {
  const parts = value.split('.');
  if (parts.length !== 4) return undefined;
  const numbers = parts.map(part => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return numbers.every(part => Number.isInteger(part) && part >= 0 && part <= 255) ? numbers : undefined;
};

const isPrivateIpv4 = ([a, b]: number[]): boolean =>
  a === 10 ||
  a === 127 ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 168) ||
  (a === 169 && b === 254);

/** True for loopback, RFC 1918, link-local and IPv6 unique local addresses. */
export const isPrivateLanAddress = (address: string): boolean => {
  let value = address.trim().toLowerCase();
  if (!value) return false;
  value = value.replace(/^\[|\]$/g, '');
  // An IPv6 zone ("fe80::1%wlan0") names the interface, not the address.
  value = value.split('%')[0];
  const v4 = ipv4Parts(value);
  if (v4) return isPrivateIpv4(v4);
  if (!value.includes(':') || !/^[0-9a-f:.]+$/.test(value)) return false;
  // IPv4-mapped IPv6 (::ffff:192.168.1.5).
  const mapped = value.match(/^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const parts = ipv4Parts(mapped[1]);
    return parts ? isPrivateIpv4(parts) : false;
  }
  if (value === '::1' || /^0{0,4}(:0{0,4}){6}:0{0,3}1$/.test(value)) return true;
  const first = parseInt(value.split(':')[0] || '0', 16);
  if (!Number.isFinite(first)) return false;
  // fc00::/7 unique local, fe80::/10 link-local.
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
};
