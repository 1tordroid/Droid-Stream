import {beforeEach, describe, expect, it} from '@jest/globals';
import {createHash, createPrivateKey, generateKeyPairSync, sign, type KeyObject} from 'crypto';
import {readFileSync} from 'fs';
import {join} from 'path';
import {getSocialRules} from '../src/lib/social/rules/active';
import {sha512, utf8Bytes, verifyEd25519} from '../src/lib/social/rules/ed25519';
import {BUNDLED_RULES} from '../src/lib/social/rules/rules.default';
import {canonicalRulesText, verifyRulesSignature} from '../src/lib/social/rules/signature';
import {
  checkSocialRules,
  loadSocialRules,
  resetSocialRulesForTests,
  RULES_SIGNATURE_URL,
  RULES_URL,
  socialRulesInfo,
} from '../src/lib/social/rules/update';
import {socialStore} from '../src/lib/social/settings';

const hex = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'));

// RFC 8032, section 7.1: TEST 1, 2 and 3.
const VECTORS = [
  {
    secret: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    publicKey: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    message: '',
    signature:
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
  },
  {
    secret: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    publicKey: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
    message: '72',
    signature:
      '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
  },
  {
    secret: 'c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7',
    publicKey: 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025',
    message: 'af82',
    signature:
      '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a',
  },
];

const rawPublicKey = (key: KeyObject) => key.export({format: 'der', type: 'spki'}).subarray(12);

describe('SHA-512', () => {
  it('matches node:crypto around the block edges', () => {
    for (const length of [0, 1, 3, 111, 112, 113, 127, 128, 129, 239, 240, 256, 1000, 70_000]) {
      const data = Uint8Array.from({length}, (_, index) => (index * 31 + length) % 256);
      expect(Buffer.from(sha512(data)).toString('hex')).toBe(createHash('sha512').update(data).digest('hex'));
    }
    expect(Buffer.from(sha512(utf8Bytes('abc'))).toString('hex')).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
  });

  it('encodes UTF-8 like Node', () => {
    const text = 'a é ह 😀  ';
    expect(Buffer.from(utf8Bytes(text)).toString('hex')).toBe(Buffer.from(text, 'utf8').toString('hex'));
  });
});

describe('Ed25519', () => {
  it('passes the RFC 8032 vectors', () => {
    for (const vector of VECTORS) {
      expect(verifyEd25519(hex(vector.signature), hex(vector.message), hex(vector.publicKey))).toBe(true);
      // The vectors also agree with node:crypto signing with the same secret.
      const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(vector.secret, 'hex')]);
      const key = createPrivateKey({key: der, format: 'der', type: 'pkcs8'});
      expect(sign(null, Buffer.from(vector.message, 'hex'), key).toString('hex')).toBe(vector.signature);
    }
  });

  it('rejects tampered messages, signatures and keys', () => {
    const [vector, other] = VECTORS;
    const signature = hex(vector.signature);
    expect(verifyEd25519(signature, hex('00'), hex(vector.publicKey))).toBe(false);
    for (const at of [0, 31, 32, 63]) {
      const changed = Uint8Array.from(signature);
      changed[at] = (changed[at] + 1) % 256;
      expect(verifyEd25519(changed, hex(vector.message), hex(vector.publicKey))).toBe(false);
    }
    expect(verifyEd25519(signature, hex(vector.message), hex(other.publicKey))).toBe(false);
    expect(verifyEd25519(signature.subarray(0, 63), hex(vector.message), hex(vector.publicKey))).toBe(false);
    // S at or above the group order is not accepted (no malleable copies).
    const highS = Uint8Array.from(signature);
    highS.set(Uint8Array.from(Buffer.from('edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010', 'hex')), 32);
    expect(verifyEd25519(highS, hex(vector.message), hex(vector.publicKey))).toBe(false);
    // A public key that is not a point on the curve.
    expect(verifyEd25519(signature, hex(vector.message), hex(`${'ff'.repeat(31)}7f`))).toBe(false);
  });

  it('agrees with node:crypto on random keys and messages', () => {
    for (let round = 0; round < 8; round += 1) {
      const {publicKey, privateKey} = generateKeyPairSync('ed25519');
      const message = Uint8Array.from({length: round * 97}, (_, index) => (index * 7 + round) % 256);
      const signature = sign(null, message, privateKey);
      expect(verifyEd25519(signature, message, rawPublicKey(publicKey))).toBe(true);
    }
  });
});

describe('rules signature', () => {
  const {publicKey, privateKey} = generateKeyPairSync('ed25519');
  const key = rawPublicKey(publicKey).toString('base64');
  const text = '{"a": 1}\n';
  const signature = sign(null, Buffer.from(text), privateKey).toString('base64');

  it('accepts the signed text, also with CRLF line ends and a byte order mark', () => {
    expect(verifyRulesSignature(text, signature, key)).toBe(true);
    expect(verifyRulesSignature(`﻿${text.replace(/\n/g, '\r\n')}`, `${signature}\r\n`, key)).toBe(true);
    expect(canonicalRulesText('a\r\nb')).toBe('a\nb');
  });

  it('rejects other text, a wrong key and broken signature files', () => {
    expect(verifyRulesSignature('{"a": 2}\n', signature, key)).toBe(false);
    expect(verifyRulesSignature(text, signature)).toBe(false);
    expect(verifyRulesSignature(text, 'not base64!', key)).toBe(false);
    expect(verifyRulesSignature(text, '', key)).toBe(false);
    expect(verifyRulesSignature(text, Buffer.alloc(63).toString('base64'), key)).toBe(false);
    expect(verifyRulesSignature(text, signature, 'AAAA')).toBe(false);
  });
});

describe('rules updates', () => {
  const {publicKey, privateKey} = generateKeyPairSync('ed25519');
  const key = rawPublicKey(publicKey).toString('base64');
  const repoRules = JSON.parse(readFileSync(join(__dirname, '..', 'rules', 'social-rules.json'), 'utf8'));
  const DAY = 24 * 60 * 60 * 1000;

  const rulesText = (version: number, edit?: (rules: any) => void) => {
    const rules = JSON.parse(JSON.stringify(repoRules));
    rules.version = version;
    rules.updated = '2026-12-01';
    edit?.(rules);
    return `${JSON.stringify(rules, null, 2)}\n`;
  };
  const signed = (text: string, by = privateKey) => sign(null, Buffer.from(text), by).toString('base64');

  /** A network that serves [text] and [signature]; counts requests. */
  const serve = (text: string, signature: string, status = 200) => {
    const urls: string[] = [];
    const fetch = async (url: string) => {
      urls.push(url);
      const body = url === RULES_URL ? text : url === RULES_SIGNATURE_URL ? signature : '';
      return {ok: status < 400, status, text: async () => body};
    };
    return {fetch, urls};
  };

  beforeEach(() => {
    socialStore.clearStore();
    resetSocialRulesForTests();
  });

  it('starts with the bundled rules', () => {
    expect(loadSocialRules()).toBe(BUNDLED_RULES);
    expect(socialRulesInfo()).toMatchObject({version: BUNDLED_RULES.version, bundled: true, checkedAt: 0});
  });

  it('takes a newer signed file, stores it and uses it after a restart', async () => {
    const text = rulesText(BUNDLED_RULES.version + 1, rules => (rules.sites.instagram.graphql.docId = '123'));
    const network = serve(text, signed(text));
    await expect(checkSocialRules({fetch: network.fetch, publicKey: key, now: 1000})).resolves.toEqual({status: 'updated', version: BUNDLED_RULES.version + 1});
    expect(network.urls.sort()).toEqual([RULES_URL, RULES_SIGNATURE_URL].sort());
    expect(getSocialRules().sites.instagram.graphql.docId).toBe('123');
    resetSocialRulesForTests();
    expect(loadSocialRules().version).toBe(BUNDLED_RULES.version + 1);
    expect(socialRulesInfo()).toMatchObject({bundled: false, updated: '2026-12-01', checkedAt: 1000});
  });

  it('keeps the current rules when the file was changed after signing', async () => {
    const text = rulesText(BUNDLED_RULES.version + 1);
    const tampered = text.replace('936619743392459', '111111111111111');
    const result = await checkSocialRules({fetch: serve(tampered, signed(text)).fetch, publicKey: key});
    expect(result).toMatchObject({status: 'failed', reason: 'the signature does not match'});
    expect(getSocialRules()).toBe(BUNDLED_RULES);
    expect(socialStore.getString('rules.text')).toBeUndefined();
  });

  it('keeps the current rules for a file signed with another key', async () => {
    const text = rulesText(BUNDLED_RULES.version + 1);
    const result = await checkSocialRules({fetch: serve(text, signed(text, generateKeyPairSync('ed25519').privateKey)).fetch, publicKey: key});
    expect(result.status).toBe('failed');
    // The app's own key does not accept a test signature either.
    expect((await checkSocialRules({force: true, fetch: serve(text, signed(text)).fetch})).status).toBe('failed');
    expect(getSocialRules()).toBe(BUNDLED_RULES);
  });

  it('only takes a higher version', async () => {
    for (const version of [BUNDLED_RULES.version, BUNDLED_RULES.version - 1].filter(value => value >= 1)) {
      const text = rulesText(version, rules => (rules.sites.reddit.headers.Accept = 'text/plain'));
      const result = await checkSocialRules({force: true, fetch: serve(text, signed(text)).fetch, publicKey: key});
      expect(result).toEqual({status: 'current', version: BUNDLED_RULES.version});
    }
    expect(getSocialRules()).toBe(BUNDLED_RULES);
  });

  it('keeps the current rules for a signed file that fails the checks', async () => {
    const text = rulesText(BUNDLED_RULES.version + 1, rules => (rules.sites.instagram.endpoints.graphql = 'https://evil.example/q'));
    const result = await checkSocialRules({fetch: serve(text, signed(text)).fetch, publicKey: key});
    expect(result).toMatchObject({status: 'failed'});
    expect(result.status === 'failed' && result.reason).toMatch(/instagram\.com/);
    const schema = rulesText(BUNDLED_RULES.version + 1, rules => (rules.schema = 2));
    expect((await checkSocialRules({force: true, fetch: serve(schema, signed(schema)).fetch, publicKey: key})).status).toBe('failed');
    expect(getSocialRules()).toBe(BUNDLED_RULES);
  });

  it('keeps the current rules when the network fails', async () => {
    const result = await checkSocialRules({fetch: serve('', '', 404).fetch, publicKey: key});
    expect(result).toMatchObject({status: 'failed', reason: 'error 404'});
    const throwing = async () => {
      throw new Error('offline');
    };
    expect(await checkSocialRules({force: true, fetch: throwing, publicKey: key})).toMatchObject({status: 'failed', reason: 'offline'});
    expect(getSocialRules()).toBe(BUNDLED_RULES);
  });

  it('checks at most once a day unless asked', async () => {
    const text = rulesText(BUNDLED_RULES.version);
    const network = serve(text, signed(text));
    await checkSocialRules({fetch: network.fetch, publicKey: key, now: 10 * DAY});
    expect(await checkSocialRules({fetch: network.fetch, publicKey: key, now: 10 * DAY + DAY - 1})).toMatchObject({status: 'skipped'});
    expect(network.urls).toHaveLength(2);
    await checkSocialRules({force: true, fetch: network.fetch, publicKey: key, now: 10 * DAY + 5});
    expect(network.urls).toHaveLength(4);
    await checkSocialRules({fetch: network.fetch, publicKey: key, now: 12 * DAY});
    expect(network.urls).toHaveLength(6);
  });

  it('falls back to the bundled rules when the stored ones are older or broken', () => {
    socialStore.setString('rules.text', rulesText(BUNDLED_RULES.version));
    expect(loadSocialRules()).toBe(BUNDLED_RULES);
    resetSocialRulesForTests();
    socialStore.setString('rules.text', '{"schema": 1, "version": 99}');
    expect(loadSocialRules()).toBe(BUNDLED_RULES);
  });
});
