/**
 * What an ISP or government block looks like, as data. The native router gets
 * this from syncUnblock and uses the same patterns as blockMatcher.ts, so new
 * patterns only need adding here.
 *
 * Patterns are regular expressions, matched without regard to case. Keep them
 * plain (no lookbehind or named groups) so Java and JavaScript read them the
 * same way.
 */

export interface BlockPageSignature {
  id: string;
  /** Who is known to show this page. Only used in logs. */
  source: string;
  /** Every pattern must match the page text. */
  all: string[];
}

export interface BlockRedirectSignature {
  id: string;
  source: string;
  /** Matched against the full URL a response redirected to. */
  url: string;
}

export interface BlockRules {
  /** Block pages are small. Bigger pages are never checked. */
  maxBodyBytes: number;
  /** Status codes that mean blocked on their own (451 = unavailable for legal reasons). */
  statusCodes: number[];
  pages: BlockPageSignature[];
  redirects: BlockRedirectSignature[];
  /**
   * IPv4 ranges an ISP resolver returns instead of the real address. Only
   * counts as a block when DNS over HTTPS returns a public address for the
   * same name.
   */
  sinkholeCidrs: string[];
  /** Block page servers seen in user reports. */
  blockPageIps: string[];
}

export const BLOCK_RULES: BlockRules = {
  maxBodyBytes: 32 * 1024,
  statusCodes: [451],
  pages: [
    {
      // Jio, served on SNI and Host header filtering.
      id: 'jio-dot-compliance',
      source: 'Jio',
      all: ['not authori[sz]ed to access this web ?page', 'dot compliance'],
    },
    {
      // ACT, Vi and others: "has been blocked as per the directions received
      // from Department of Telecommunications, Government of India".
      id: 'dot-directions',
      source: 'ACT, Vi, others',
      all: ['(has been|is|been) blocked', 'department of telecommunications'],
    },
    {
      // Airtel, Vi, BSNL: blocked "pursuant to court orders" or "in compliance
      // to the orders of a Court of competent jurisdiction".
      id: 'court-order',
      source: 'Airtel, Vi, BSNL',
      all: ['blocked', 'court of competent jurisdiction|court orders?|orders? of (the )?(hon.?ble )?court'],
    },
    {
      // BSNL, Vi: "blocked under instructions of a competent Government Authority".
      id: 'government-authority',
      source: 'BSNL, Vi',
      all: ['blocked', 'competent (government )?authority|government authority'],
    },
    {
      // Orders under the IT Act from MeitY.
      id: 'meity-order',
      source: 'any ISP',
      all: ['blocked', 'ministry of electronics (and|&) information technology|meity|section 69a'],
    },
    {
      id: 'blocked-as-per',
      source: 'any ISP',
      all: ['blocked as per', 'government|orders?|directions|guidelines'],
    },
  ],
  redirects: [
    {id: 'airtel-dot', source: 'Airtel', url: '^https?://(www\\.)?airtel\\.in/dot'},
    {id: 'block-path', source: 'any ISP', url: '^https?://[^/]+/(blocked|block-?page|restricted)(\\.html?|/|\\?|$)'},
  ],
  sinkholeCidrs: [
    '0.0.0.0/8',
    '127.0.0.0/8',
    '10.0.0.0/8',
    '100.64.0.0/10',
    '169.254.0.0/16',
    '172.16.0.0/12',
    '192.168.0.0/16',
  ],
  blockPageIps: [],
};
