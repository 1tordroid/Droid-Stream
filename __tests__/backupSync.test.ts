/* eslint-disable no-bitwise -- flipping bits to tamper with data. */
import {createCipheriv, createDecipheriv, createHmac, pbkdf2Sync, randomBytes} from 'crypto';
import {
  decryptWithPassphrase,
  DecryptError,
  encryptWithPassphrase,
  fromBase64,
  openWithKey,
  PBKDF2_ITERATIONS,
  sealWithKey,
  toBase64,
  type CryptoBackend,
} from '../src/lib/backupSync/crypto';
import {
  dumpStore,
  isDeviceOnlyKey,
  isLiveTvSetupKey,
  mergeValue,
  restoreStore,
  unionList,
  type DumpableStore,
} from '../src/lib/backupSync/storeDump';
import {
  backupFileName,
  deviceLabel,
  deviceSlug,
  listVersions,
  parseBackupFileName,
  versionsToPrune,
} from '../src/lib/backupSync/versions';
import {folderSegments, folderUrl, fileUrl} from '../src/lib/backupSync/webdav';
import {autoBackupDue} from '../src/lib/backupSync/service';
import {fingerprintContent, mergeBackupWithLocal, pickClassic, type SyncContent} from '../src/lib/backupSync/payload';
import type {VegaBackup} from '../src/lib/backup';

/** javax.crypto's behaviour, with Node's crypto: ciphertext then the 16-byte tag. */
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

// Fewer rounds keep the suite fast; the header records the count either way.
const FAST = 100_000;

describe('passphrase encryption', () => {
  it('round-trips text, accents and emoji', async () => {
    const text = JSON.stringify({key: 'secret', name: 'Café 📺'});
    const envelope = await encryptWithPassphrase(text, 'correct horse', nodeCrypto, FAST);
    expect(envelope).not.toContain('secret');
    expect(await decryptWithPassphrase(envelope, 'correct horse', nodeCrypto)).toBe(text);
  });

  it('defaults to at least 310,000 PBKDF2 rounds and writes a versioned header', async () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(310_000);
    const pbkdf2 = jest.spyOn(nodeCrypto, 'pbkdf2');
    const envelope = await encryptWithPassphrase('x', 'passphrase', nodeCrypto);
    expect(pbkdf2).toHaveBeenCalledWith('passphrase', expect.any(Uint8Array), PBKDF2_ITERATIONS, 32);
    pbkdf2.mockRestore();
    const bytes = fromBase64(envelope);
    expect(Buffer.from(bytes.slice(0, 4)).toString('ascii')).toBe('DSEC');
    expect(bytes[4]).toBe(1);
    expect(bytes[5]).toBe(1);
    expect(Buffer.from(bytes.slice(6, 10)).readUInt32BE(0)).toBe(PBKDF2_ITERATIONS);
    expect(bytes[10]).toBe(16);
  });

  it('uses a new salt and nonce each time', async () => {
    const one = await encryptWithPassphrase('same', 'passphrase', nodeCrypto, FAST);
    const two = await encryptWithPassphrase('same', 'passphrase', nodeCrypto, FAST);
    expect(one).not.toBe(two);
  });

  it('refuses a wrong passphrase', async () => {
    const envelope = await encryptWithPassphrase('data', 'right passphrase', nodeCrypto, FAST);
    await expect(decryptWithPassphrase(envelope, 'wrong passphrase', nodeCrypto)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptWithPassphrase(envelope, '', nodeCrypto)).rejects.toBeInstanceOf(DecryptError);
  });

  it('refuses changed ciphertext, tag or header', async () => {
    const envelope = await encryptWithPassphrase('data that matters', 'passphrase', nodeCrypto, FAST);
    const flip = (index: number) => {
      const bytes = fromBase64(envelope);
      bytes[index < 0 ? bytes.length + index : index] ^= 1;
      return toBase64(bytes);
    };
    // Last byte (tag), a ciphertext byte, a salt byte, the iteration count.
    for (const index of [-1, -20, 12, 9]) {
      await expect(decryptWithPassphrase(flip(index), 'passphrase', nodeCrypto)).rejects.toBeInstanceOf(DecryptError);
    }
    await expect(decryptWithPassphrase(envelope.slice(0, 30), 'passphrase', nodeCrypto)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptWithPassphrase('not base64 at all!', 'passphrase', nodeCrypto)).rejects.toBeInstanceOf(DecryptError);
  });

  it('refuses an unknown version and absurd iteration counts', async () => {
    const envelope = fromBase64(await encryptWithPassphrase('x', 'passphrase', nodeCrypto, FAST));
    const newer = envelope.slice();
    newer[4] = 2;
    await expect(decryptWithPassphrase(toBase64(newer), 'passphrase', nodeCrypto)).rejects.toThrow('newer version');
    const huge = envelope.slice();
    huge[6] = 0xff;
    await expect(decryptWithPassphrase(toBase64(huge), 'passphrase', nodeCrypto)).rejects.toThrow('damaged');
  });

  it('seals with a ready key and checks the extra data', async () => {
    const key = nodeCrypto.randomBytes(32);
    const sealed = await sealWithKey(key, 'hello', 'context-a', nodeCrypto);
    expect(await openWithKey(key, sealed, 'context-a', nodeCrypto)).toBe('hello');
    await expect(openWithKey(key, sealed, 'context-b', nodeCrypto)).rejects.toBeInstanceOf(DecryptError);
    await expect(openWithKey(nodeCrypto.randomBytes(32), sealed, 'context-a', nodeCrypto)).rejects.toBeInstanceOf(DecryptError);
  });
});

describe('version list and pruning', () => {
  const at = (iso: string) => Date.parse(iso);

  it('names files by device and UTC time, with .e when sign-ins are inside', () => {
    expect(backupFileName('pixel-8-ab12cd', at('2026-11-07T09:05:03Z'), false)).toBe('ds-backup-pixel-8-ab12cd-20261107T090503Z.json');
    expect(backupFileName('tv-x1', at('2026-01-02T03:04:05Z'), true)).toBe('ds-backup-tv-x1-20260102T030405Z.e.json');
    expect(parseBackupFileName('ds-backup-pixel-8-ab12cd-20261107T090503Z.e.json', 42)).toEqual({
      name: 'ds-backup-pixel-8-ab12cd-20261107T090503Z.e.json',
      device: 'pixel-8-ab12cd',
      createdAt: at('2026-11-07T09:05:03Z'),
      encrypted: true,
      size: 42,
    });
    expect(parseBackupFileName('notes.txt')).toBeUndefined();
    expect(parseBackupFileName('ds-backup-x-2026.json')).toBeUndefined();
  });

  it('makes safe device slugs and labels', () => {
    expect(deviceSlug('OnePlus CPH2581 (Living room)', 'Ab12Cd')).toBe('oneplus-cph2581-living-r-ab12cd');
    expect(deviceSlug('***', '')).toBe('device-device');
    expect(deviceLabel('shield-tv-ab12cd')).toBe('Shield Tv');
  });

  it('lists backups newest first and ignores other files and folders', () => {
    const versions = listVersions([
      {name: 'ds-backup-a-x1-20260101T000000Z.json'},
      {name: 'ds-backup-b-y2-20260103T000000Z.e.json'},
      {name: 'ds-backup-a-x1-20260102T000000Z.json', directory: true},
      {name: 'readme.md'},
      {name: 'ds-backup-a-x1-20260104T000000Z.json'},
    ]);
    expect(versions.map(item => item.name)).toEqual([
      'ds-backup-a-x1-20260104T000000Z.json',
      'ds-backup-b-y2-20260103T000000Z.e.json',
      'ds-backup-a-x1-20260101T000000Z.json',
    ]);
  });

  it('prunes only this device, keeping the newest N', () => {
    const names = [1, 2, 3, 4, 5, 6].map(day => ({name: `ds-backup-phone-x1-202601${String(day).padStart(2, '0')}T000000Z.json`}));
    names.push({name: 'ds-backup-tv-y2-20250101T000000Z.json'});
    const versions = listVersions(names);
    const pruned = versionsToPrune(versions, 'phone-x1', 3).map(item => item.name);
    expect(pruned).toEqual([
      'ds-backup-phone-x1-20260103T000000Z.json',
      'ds-backup-phone-x1-20260102T000000Z.json',
      'ds-backup-phone-x1-20260101T000000Z.json',
    ]);
    expect(versionsToPrune(versions, 'tv-y2', 3)).toEqual([]);
    expect(versionsToPrune(versions, 'phone-x1', 0)).toHaveLength(5);
  });
});

describe('WebDAV paths', () => {
  it('builds folder and file addresses', () => {
    const target = {server: 'https://dav.example.com/remote.php/dav/files/me/', username: 'u', password: 'p', folder: '/Droid Stream/../backups/'};
    expect(folderSegments(target.folder)).toEqual(['Droid Stream', 'backups']);
    expect(folderUrl(target)).toBe('https://dav.example.com/remote.php/dav/files/me/Droid%20Stream/backups/');
    expect(fileUrl(target, 'a b.json')).toBe('https://dav.example.com/remote.php/dav/files/me/Droid%20Stream/backups/a%20b.json');
    expect(folderUrl({...target, folder: ''})).toBe('https://dav.example.com/remote.php/dav/files/me/');
  });
});

describe('automatic backup timing', () => {
  const hour = 60 * 60 * 1000;
  const now = 1_000 * hour;

  it('daily: runs once a day and waits after a failure', () => {
    expect(autoBackupDue('off', {}, now)).toBe(false);
    expect(autoBackupDue('daily', {}, now)).toBe(true);
    expect(autoBackupDue('daily', {lastSuccessAt: now - 2 * hour, lastAttemptAt: now - 2 * hour}, now)).toBe(false);
    expect(autoBackupDue('daily', {lastSuccessAt: now - 25 * hour, lastAttemptAt: now - 25 * hour}, now)).toBe(true);
    expect(autoBackupDue('daily', {lastSuccessAt: now - 25 * hour, lastAttemptAt: now - 0.1 * hour, lastError: 'x'}, now)).toBe(false);
    expect(autoBackupDue('daily', {lastSuccessAt: now - 25 * hour, lastAttemptAt: now - 1 * hour, lastError: 'x'}, now)).toBe(true);
  });

  it('on change: runs when the content changed, not too often', () => {
    expect(autoBackupDue('change', {fingerprint: 'a'}, now, 'a')).toBe(false);
    expect(autoBackupDue('change', {fingerprint: 'a'}, now, 'b')).toBe(true);
    expect(autoBackupDue('change', {fingerprint: 'a', lastAttemptAt: now - 60_000}, now, 'b')).toBe(false);
    expect(autoBackupDue('change', {fingerprint: 'a', lastAttemptAt: now - 0.25 * hour, lastError: 'x'}, now, 'b')).toBe(false);
  });

  it('fingerprints ignore the time stamp', () => {
    const content = (createdAt: string, title = 'A'): SyncContent => ({
      backup: {app: 'vega', version: 2, createdAt, library: {items: [{title, poster: '', link: 'l', provider: 'p'}], collections: []}},
      stores: {},
    });
    expect(fingerprintContent(content('2026-01-01'))).toBe(fingerprintContent(content('2026-02-02')));
    expect(fingerprintContent(content('2026-01-01'))).not.toBe(fingerprintContent(content('2026-01-01', 'B')));
  });
});

/** A store with the typed indexer react-native-mmkv-storage has. */
const fakeStore = (initial: Record<string, {t: string; v: unknown}> = {}) => {
  const values = new Map(Object.entries(initial));
  const of = (t: string) => ({getAll: async () => [...values].filter(([, value]) => value.t === t).map(([key, value]) => [key, value.v])});
  const store: DumpableStore & {values: typeof values} = {
    values,
    indexer: {
      getKeys: async () => [...values.keys()],
      strings: of('s'),
      numbers: of('n'),
      booleans: of('b'),
      maps: of('m'),
      arrays: of('a'),
    },
    getString: key => (values.get(key)?.t === 's' ? (values.get(key)?.v as string) : undefined),
    setString: (key, v) => values.set(key, {t: 's', v}),
    setInt: (key, v) => values.set(key, {t: 'n', v}),
    setBool: (key, v) => values.set(key, {t: 'b', v}),
    setMap: (key, v) => values.set(key, {t: 'm', v}),
    setArray: (key, v) => values.set(key, {t: 'a', v}),
    removeItem: key => values.delete(key),
  };
  return store;
};

describe('store copies and merge rules', () => {
  it('copies every value type and leaves device-only keys out', async () => {
    const store = fakeStore({
      sources: {t: 'a', v: [{id: '1'}]},
      count: {t: 'n', v: 3},
      on: {t: 'b', v: true},
      prefs: {t: 'm', v: {a: 1}},
      name: {t: 's', v: 'x'},
      'install-id': {t: 's', v: 'device'},
      'backup-sync.passphrase': {t: 's', v: 'never'},
    });
    const dump = await dumpStore(store, key => !isDeviceOnlyKey(key));
    expect(Object.keys(dump).sort()).toEqual(['count', 'name', 'on', 'prefs', 'sources']);
    expect(dump.count).toEqual({t: 'n', v: 3});
  });

  it('keeps Live TV setup keys and drops its caches', () => {
    expect(isLiveTvSetupKey('playlists')).toBe(true);
    expect(isLiveTvSetupKey('epgUrl:abc')).toBe(true);
    expect(isLiveTvSetupKey('favourites')).toBe(true);
    expect(isLiveTvSetupKey('p.kid1.favourites')).toBe(true);
    expect(isLiveTvSetupKey('cache:abc')).toBe(false);
    expect(isLiveTvSetupKey('worldCounts')).toBe(false);
  });

  it('merges lists by id and keeps other local values', () => {
    expect(unionList([{id: 'a', v: 1}], [{id: 'a', v: 2}, {id: 'b'}])).toEqual([{id: 'a', v: 1}, {id: 'b'}]);
    expect(mergeValue(undefined, {t: 's', v: 'x'})).toEqual({t: 's', v: 'x'});
    expect(mergeValue({t: 's', v: 'mine'}, {t: 's', v: 'theirs'})).toBeUndefined();
    expect(mergeValue({t: 's', v: '[{"url":"a"}]'}, {t: 's', v: '[{"url":"b"}]'})).toEqual({t: 's', v: '[{"url":"a"},{"url":"b"}]'});
    expect(mergeValue({t: 'a', v: ['x']}, {t: 'a', v: ['x']})).toBeUndefined();
  });

  it('merge adds what is missing; replace swaps the included keys', async () => {
    const backup = {list: {t: 'a' as const, v: [{id: 'b'}]}, setting: {t: 's' as const, v: 'theirs'}, extra: {t: 'b' as const, v: true}};
    const merged = fakeStore({list: {t: 'a', v: [{id: 'a'}]}, setting: {t: 's', v: 'mine'}, 'install-id': {t: 's', v: 'keep'}});
    await restoreStore(merged, backup, () => true, 'merge');
    expect(merged.values.get('list')?.v).toEqual([{id: 'a'}, {id: 'b'}]);
    expect(merged.values.get('setting')?.v).toBe('mine');
    expect(merged.values.get('extra')?.v).toBe(true);

    const replaced = fakeStore({list: {t: 'a', v: [{id: 'a'}]}, gone: {t: 's', v: 'x'}, 'install-id': {t: 's', v: 'keep'}});
    await restoreStore(replaced, {...backup, 'install-id': {t: 's', v: 'other'}}, () => true, 'replace');
    expect(replaced.values.get('list')?.v).toEqual([{id: 'b'}]);
    expect(replaced.values.has('gone')).toBe(false);
    expect(replaced.values.get('setting')?.v).toBe('theirs');
    expect(replaced.values.get('install-id')?.v).toBe('keep');
  });

  it('refuses a damaged copy', async () => {
    await expect(restoreStore(fakeStore(), {bad: {t: 'n', v: 'text'}} as never, () => true, 'merge')).rejects.toThrow('damaged');
  });
});

describe('classic backup merge', () => {
  const local: VegaBackup = {
    app: 'vega',
    version: 2,
    createdAt: 'now',
    settings: {theme: 'mine'},
    providers: {installed: [{value: 'a'} as never], sources: [{url: 's1', author: 'x'}], modules: [], disabled: ['z']},
    library: {items: [{title: 'A', poster: '', link: 'a', provider: 'p'}], collections: []},
    profiles: {list: [], current: 'default'},
  };

  it('keeps local settings, combines providers and the library', () => {
    const incoming: VegaBackup = {
      app: 'vega',
      version: 2,
      createdAt: 'then',
      settings: {theme: 'theirs', extra: true},
      providers: {installed: [{value: 'a'} as never, {value: 'b'} as never], sources: [{url: 's2', author: 'y'}], modules: [], disabled: ['y']},
      library: {items: [{title: 'B', poster: '', link: 'b', provider: 'p'}], collections: []},
      profiles: {list: [], current: 'default'},
    };
    const merged = mergeBackupWithLocal(incoming, local);
    expect(merged.settings).toEqual({extra: true});
    expect(merged.providers?.installed.map(item => item.value)).toEqual(['a', 'b']);
    expect(merged.providers?.sources.map(item => item.url)).toEqual(['s1', 's2']);
    expect(merged.providers?.disabled).toEqual(['z', 'y']);
    expect(merged.library?.items.map(item => item.link)).toEqual(['a', 'b']);
  });

  it('picks only the chosen sections for a transfer', () => {
    expect(pickClassic(local, ['debrid'])).toBeUndefined();
    const picked = pickClassic(local, ['providers']);
    expect(picked?.providers).toBe(local.providers);
    expect(picked?.settings).toBeUndefined();
    expect(pickClassic(local, ['player'])?.settings).toEqual({theme: 'mine'});
  });
});
