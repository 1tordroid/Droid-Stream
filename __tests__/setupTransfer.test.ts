/* eslint-disable no-bitwise -- flipping bits to tamper with data. */
import {createCipheriv, createDecipheriv, createHmac, pbkdf2Sync, randomBytes} from 'crypto';
import type {CryptoBackend} from '../src/lib/backupSync/crypto';
import type {SetupPayload} from '../src/lib/backupSync/payload';
import {
  buildSetupLink,
  deriveCodeKeys,
  formatCode,
  neighbourAddresses,
  newCode,
  normalizeCode,
  parseSetupLink,
} from '../src/lib/setupTransfer/code';
import {findReceivers, hello, sendSetup} from '../src/lib/setupTransfer/sender';
import {createReceiveSession, MAX_TRANSFER_BYTES, SESSION_MS, type ReceiveSession} from '../src/lib/setupTransfer/session';

const nodeCrypto: CryptoBackend = {
  randomBytes: size => new Uint8Array(randomBytes(size)),
  pbkdf2: async (password, salt, iterations, length) =>
    new Uint8Array(pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from(salt), iterations, length, 'sha256')),
  hmac: async (key, message) => new Uint8Array(createHmac('sha256', Buffer.from(key)).update(message, 'utf8').digest()),
  seal: async (key, nonce, aad, plaintext) => {
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(nonce));
    if (aad.length) cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return new Uint8Array(Buffer.concat([body, cipher.getAuthTag()]));
  },
  open: async (key, nonce, aad, sealed) => {
    const data = Buffer.from(sealed);
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(nonce));
    if (aad.length) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8');
  },
};

const FAST = 100_000;

const payload: SetupPayload = {
  app: 'droid-stream-setup',
  v: 1,
  from: 'Phone',
  createdAt: '2026-11-07T00:00:00Z',
  sections: ['debrid'],
  stores: {'droid-stream-debrid': {settings: {t: 's', v: '{"keys":{"torbox":"k"}}'}}},
};

/** A fetch that hands requests from [client] straight to the session. */
const fetchTo = (session: ReceiveSession, client = '192.168.1.20') =>
  (async (_url: string, init?: {body?: string}) => {
    const {reply} = await session.handle(client, String(init?.body));
    return {ok: true, status: 200, json: async () => JSON.parse(reply)};
  }) as unknown as typeof fetch;

describe('setup codes', () => {
  it('makes 8-character codes and reads typed ones forgivingly', () => {
    const code = newCode(size => nodeCrypto.randomBytes(size));
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(formatCode('ABCD2345')).toBe('ABCD-2345');
    expect(normalizeCode('abcd-2345')).toBe('ABCD2345');
    expect(normalizeCode(' oil 12345')).toBe('01112345');
    expect(normalizeCode('ABC')).toBeUndefined();
    expect(newCode(() => new Uint8Array([0, 0, 0, 0, 0]))).toBe('00000000');
    expect(newCode(() => new Uint8Array([255, 255, 255, 255, 255]))).toBe('ZZZZZZZZ');
  });

  it('builds and reads the QR link', () => {
    const link = buildSetupLink({host: '192.168.1.5', port: 47860, code: 'ABCD2345'});
    expect(parseSetupLink(link)).toEqual({host: '192.168.1.5', port: 47860, code: 'ABCD2345'});
    expect(parseSetupLink('https://example.com')).toBeUndefined();
    expect(parseSetupLink('droidstream://setup?a=1.2.3.4&p=80&c=ABCD2345')).toBeUndefined();
  });

  it('derives the same key and token on both sides, different for another code', async () => {
    const salt = nodeCrypto.randomBytes(16);
    const one = await deriveCodeKeys('ABCD2345', salt, nodeCrypto, FAST);
    const two = await deriveCodeKeys('ABCD2345', salt, nodeCrypto, FAST);
    const other = await deriveCodeKeys('ABCD2346', salt, nodeCrypto, FAST);
    expect(Buffer.from(one.key).equals(Buffer.from(two.key))).toBe(true);
    expect(one.token).toBe(two.token);
    expect(other.token).not.toBe(one.token);
    expect(one.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('lists the other addresses of the /24 network, nearest first', () => {
    const list = neighbourAddresses('192.168.1.10');
    expect(list).toHaveLength(253);
    expect(list.slice(0, 3)).toEqual(['192.168.1.9', '192.168.1.11', '192.168.1.8']);
    expect(list).not.toContain('192.168.1.10');
    expect(neighbourAddresses('nonsense')).toEqual([]);
  });
});

describe('receive session', () => {
  let clock = 1_000_000;
  const now = () => clock;
  beforeEach(() => {
    clock = 1_000_000;
  });

  const session = () => createReceiveSession('Living room TV', nodeCrypto, now, FAST);

  it('sends a setup end to end with the right code', async () => {
    const receiver = await session();
    const found = await hello('192.168.1.5', 47860, fetchTo(receiver));
    expect(found).toMatchObject({host: '192.168.1.5', name: 'Living room TV'});
    let received: SetupPayload | undefined;
    const fetcher = (async (_url: string, init?: {body?: string}) => {
      const result = await receiver.handle('192.168.1.20', String(init?.body));
      received = result.received || received;
      return {ok: true, status: 200, json: async () => JSON.parse(result.reply)};
    }) as unknown as typeof fetch;
    jest.spyOn(nodeCrypto, 'pbkdf2').mockImplementation((password, salt, _iterations, length) =>
      Promise.resolve(new Uint8Array(pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from(salt), FAST, length, 'sha256'))),
    );
    try {
      await sendSetup(found!, receiver.code, payload, nodeCrypto, fetcher);
    } finally {
      jest.restoreAllMocks();
    }
    expect(received).toEqual(payload);
    expect(receiver.isOpen).toBe(false);
  });

  it('takes one setup only', async () => {
    const receiver = await session();
    const {token, key} = await deriveCodeKeys(receiver.code, Buffer.from((JSON.parse((await receiver.handle('10.0.0.2', '{"op":"hello"}')).reply).salt), 'base64'), nodeCrypto, FAST);
    const {sealWithKey} = require('../src/lib/backupSync/crypto');
    const data = await sealWithKey(key, JSON.stringify(payload), 'droid-stream-setup-v1', nodeCrypto);
    const first = await receiver.handle('10.0.0.2', JSON.stringify({op: 'send', token, data}));
    expect(JSON.parse(first.reply)).toEqual({ok: true});
    expect(first.received?.sections).toEqual(['debrid']);
    const second = await receiver.handle('10.0.0.2', JSON.stringify({op: 'send', token, data}));
    expect(JSON.parse(second.reply)).toEqual({ok: false, error: 'done'});
  });

  it('refuses a valid token once the code has expired', async () => {
    const receiver = await session();
    const salt = Buffer.from(JSON.parse((await receiver.handle('10.0.0.2', '{"op":"hello"}')).reply).salt, 'base64');
    const {token, key} = await deriveCodeKeys(receiver.code, salt, nodeCrypto, FAST);
    const {sealWithKey} = require('../src/lib/backupSync/crypto');
    const data = await sealWithKey(key, JSON.stringify(payload), 'droid-stream-setup-v1', nodeCrypto);
    clock += SESSION_MS;
    const result = await receiver.handle('10.0.0.2', JSON.stringify({op: 'send', token, data}));
    expect(JSON.parse(result.reply)).toEqual({ok: false, error: 'expired'});
    expect(result.received).toBeUndefined();
    expect(receiver.isOpen).toBe(false);
    // Hello also stops answering.
    expect(JSON.parse((await receiver.handle('10.0.0.2', '{"op":"hello"}')).reply).error).toBe('done');
  });

  it('refuses addresses outside the home network', async () => {
    const receiver = await session();
    for (const client of ['8.8.8.8', '100.64.0.1', '2001:db8::1', '']) {
      expect(JSON.parse((await receiver.handle(client, '{"op":"hello"}')).reply)).toEqual({ok: false, error: 'not-lan'});
    }
    expect(JSON.parse((await receiver.handle('::1', '{"op":"hello"}')).reply).ok).toBe(true);
  });

  it('refuses wrong tokens, locks out a guesser and stops after many guesses', async () => {
    const receiver = await session();
    const wrong = JSON.stringify({op: 'send', token: 'x'.repeat(43), data: 'AAAA'});
    for (let index = 0; index < 5; index += 1) {
      expect(JSON.parse((await receiver.handle('192.168.1.30', wrong)).reply).error).toBe('bad-token');
    }
    expect(JSON.parse((await receiver.handle('192.168.1.30', wrong)).reply).error).toBe('locked');
    for (let host = 40; host < 60 && receiver.isOpen; host += 1) {
      await receiver.handle(`192.168.1.${host}`, wrong);
    }
    expect(receiver.isOpen).toBe(false);
  });

  it('refuses a right token with changed data, and oversized or broken requests', async () => {
    const receiver = await session();
    const salt = Buffer.from(JSON.parse((await receiver.handle('10.0.0.2', '{"op":"hello"}')).reply).salt, 'base64');
    const {token, key} = await deriveCodeKeys(receiver.code, salt, nodeCrypto, FAST);
    const {sealWithKey} = require('../src/lib/backupSync/crypto');
    const data: string = await sealWithKey(key, JSON.stringify(payload), 'droid-stream-setup-v1', nodeCrypto);
    const bytes = Buffer.from(data, 'base64');
    bytes[bytes.length - 1] ^= 1;
    const tampered = await receiver.handle('10.0.0.2', JSON.stringify({op: 'send', token, data: bytes.toString('base64')}));
    expect(JSON.parse(tampered.reply)).toEqual({ok: false, error: 'bad-data'});
    expect(JSON.parse((await receiver.handle('10.0.0.2', 'x'.repeat(MAX_TRANSFER_BYTES + 1))).reply).error).toBe('too-large');
    expect(JSON.parse((await receiver.handle('10.0.0.2', '{not json')).reply).error).toBe('bad-request');
    expect(JSON.parse((await receiver.handle('10.0.0.2', '{"op":"other"}')).reply).error).toBe('bad-request');
    // Still open for the real setup.
    expect(receiver.isOpen).toBe(true);
  });

  it('sender refuses addresses outside the home network and reports a wrong code', async () => {
    await expect(
      sendSetup({host: '8.8.8.8', port: 47860, name: 'x', salt: 'AAAA'}, 'ABCD2345', payload, nodeCrypto, fetch),
    ).rejects.toThrow('same home network');
    const receiver = await session();
    const found = await hello('192.168.1.5', 47860, fetchTo(receiver));
    jest.spyOn(nodeCrypto, 'pbkdf2').mockImplementation((password, salt, _iterations, length) =>
      Promise.resolve(new Uint8Array(pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from(salt), FAST, length, 'sha256'))),
    );
    try {
      const wrongCode = receiver.code === 'ABCD2345' ? 'ABCD2346' : 'ABCD2345';
      await expect(sendSetup(found!, wrongCode, payload, nodeCrypto, fetchTo(receiver))).rejects.toThrow('Wrong code');
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('finds a receiver by scanning the network', async () => {
    const receiver = await session();
    const fetcher = (async (url: string, init?: {body?: string}) => {
      if (!url.startsWith('http://192.168.1.77:')) throw new TypeError('Network request failed');
      const {reply} = await receiver.handle('192.168.1.10', String(init?.body));
      return {ok: true, status: 200, json: async () => JSON.parse(reply)};
    }) as unknown as typeof fetch;
    const found = await findReceivers('192.168.1.10', fetcher);
    expect(found.map(item => item.host)).toEqual(['192.168.1.77']);
    expect(await findReceivers('8.8.8.8', fetcher)).toEqual([]);
  });
});
