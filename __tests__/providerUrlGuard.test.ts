import {describe, expect, it} from '@jest/globals';
import {
  isPrivateHostname,
  isSafeExternalUrl,
  isSameSite,
  parseIpv6,
  validateProviderUrl,
} from '../src/lib/sandbox/urlGuard';

describe('isPrivateHostname', () => {
  it('blocks loopback and local aliases', () => {
    [
      'localhost',
      'app.localhost',
      '127.0.0.1',
      '::1',
      '0.0.0.0',
      'nas.local',
    ].forEach(host => expect(isPrivateHostname(host)).toBe(true));
  });

  it('blocks private and link-local IPv4 ranges', () => {
    [
      '10.0.0.5',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '169.254.1.1',
    ].forEach(host => expect(isPrivateHostname(host)).toBe(true));
  });

  it('allows public hosts and public IPv4', () => {
    ['example.com', '8.8.8.8', '1.1.1.1', 'cdn.example.co.uk'].forEach(host =>
      expect(isPrivateHostname(host)).toBe(false),
    );
  });

  it('blocks IPv6 unique-local and link-local prefixes', () => {
    ['fd00::1', 'fc00::1', 'fe80::1'].forEach(host =>
      expect(isPrivateHostname(host)).toBe(true),
    );
  });

  it('blocks IPv6 forms that carry a private IPv4 address', () => {
    [
      '[::ffff:127.0.0.1]',
      '::ffff:7f00:1',
      '::ffff:c0a8:101',
      '::127.0.0.1',
      '::7f00:1',
      '64:ff9b::7f00:1',
      '2002:c0a8:0101::1',
      '0:0:0:0:0:0:0:1',
      '::',
      'ff02::1',
      'fec0::1',
      'fe80::1%wlan0',
    ].forEach(host => expect(isPrivateHostname(host)).toBe(true));
  });

  it('blocks hostnames with a trailing dot', () => {
    ['localhost.', 'app.localhost.', '127.0.0.1.', 'nas.local.'].forEach(
      host => expect(isPrivateHostname(host)).toBe(true),
    );
  });

  it('fails closed on malformed IPv6', () => {
    ['1::2::3', '12345::1', '::ffff:999.0.0.1', 'example.com:80'].forEach(
      host => expect(isPrivateHostname(host)).toBe(true),
    );
  });

  it('allows public IPv6 and IPv4-mapped public addresses', () => {
    [
      '2606:4700:4700::1111',
      '[2001:4860:4860::8888]',
      '::ffff:8.8.8.8',
      '2002:0808:0808::1',
      'example.com.',
    ].forEach(host => expect(isPrivateHostname(host)).toBe(false));
  });
});

describe('parseIpv6', () => {
  it('expands compressed addresses to 16 bytes', () => {
    expect(parseIpv6('::1')).toEqual([...new Array(15).fill(0), 1]);
    expect(parseIpv6('::ffff:127.0.0.1')).toEqual([
      ...new Array(10).fill(0),
      0xff,
      0xff,
      127,
      0,
      0,
      1,
    ]);
    expect(parseIpv6('example.com')).toBeNull();
    expect(parseIpv6('1:2:3:4:5:6:7:8:9')).toBeNull();
  });
});

describe('validateProviderUrl', () => {
  it('accepts plain http and https urls', () => {
    expect(validateProviderUrl('https://example.com/a').hostname).toBe(
      'example.com',
    );
    expect(validateProviderUrl('http://example.com').protocol).toBe('http:');
  });

  it('rejects non-http schemes', () => {
    [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'intent://x',
      'data:text/html,x',
    ].forEach(url => expect(() => validateProviderUrl(url)).toThrow());
  });

  it('rejects embedded credentials', () => {
    expect(() => validateProviderUrl('https://user:pass@example.com')).toThrow(
      /not allowed/,
    );
  });

  it('rejects private network targets', () => {
    expect(() => validateProviderUrl('http://192.168.0.1/admin')).toThrow(
      /not allowed/,
    );
  });

  it('rejects IPv6 and trailing-dot spellings of local hosts', () => {
    [
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:c0a8:101]/',
      'http://localhost./',
      'http://[::127.0.0.1]/',
      'http://[64:ff9b::7f00:1]/',
      'http://[::1]:8080/',
      'http://2130706433/',
      'http://0x7f.0.0.1/',
    ].forEach(url =>
      expect(() => validateProviderUrl(url)).toThrow(/not allowed/),
    );
  });

  it('accepts public IPv6 urls', () => {
    expect(
      validateProviderUrl('https://[2606:4700:4700::1111]/dns-query').hostname,
    ).toBe('[2606:4700:4700::1111]');
  });

  it('rejects empty and non-string input', () => {
    [undefined, null, '', '   ', 42].forEach(value =>
      expect(() => validateProviderUrl(value)).toThrow(),
    );
  });
});

describe('isSafeExternalUrl', () => {
  it('allows only http and https', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true);
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
  });

  it('rejects schemes that would abuse the app authority', () => {
    [
      'intent://scan/#Intent;scheme=zxing;end',
      'javascript:alert(1)',
      'market://details?id=x',
      'tel:+15551234',
      'file:///sdcard/x',
      'httpx://example.com',
      'not a url',
      '',
    ].forEach(url => expect(isSafeExternalUrl(url)).toBe(false));
  });
});

describe('isSameSite', () => {
  it('matches identical and www-prefixed hosts', () => {
    expect(isSameSite('example.com', 'www.example.com')).toBe(true);
    expect(isSameSite('example.com', 'example.com')).toBe(true);
  });

  it('matches subdomains of the provider host', () => {
    expect(isSameSite('cdn.example.com', 'example.com')).toBe(true);
  });

  it('does not match unrelated hosts', () => {
    expect(isSameSite('evil.com', 'example.com')).toBe(false);
    expect(isSameSite('notexample.com', 'example.com')).toBe(false);
    expect(isSameSite('alice.github.io', 'bob.github.io')).toBe(false);
  });
});
