import {createHash} from 'crypto';
import {describe, expect, it, jest} from '@jest/globals';
import {
  checkPin,
  createSalt,
  FIRST_LOCKOUT_MS,
  FREE_PIN_ATTEMPTS,
  hashPin,
  isValidPin,
  lockoutFor,
  MAX_LOCKOUT_MS,
  NO_ATTEMPTS,
  pinCheckMessage,
  sha256Hex,
  verifyPinHash,
} from '../src/lib/profiles/pin';

describe('sha256Hex', () => {
  it('matches the standard test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('matches Node for text of every length around the block size, and for UTF-8', () => {
    for (let length = 0; length < 140; length++) {
      const text = 'x'.repeat(length);
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'));
    }
    for (const text of ['पिन 1234', '🐼🦊', 'café']) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
    const bytes = Uint8Array.from({length: 100}, (_, i) => (i * 37) % 256);
    expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});

describe('PIN hashing', () => {
  it('accepts exactly four digits', () => {
    expect(isValidPin('0000')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12345')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(() => hashPin('12')).toThrow();
  });

  it('saves a salted hash that only the same PIN matches', () => {
    const saved = hashPin('2580', 'a'.repeat(32), 50);
    expect(saved.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.hash).not.toContain('2580');
    expect(verifyPinHash('2580', saved)).toBe(true);
    expect(verifyPinHash('2581', saved)).toBe(false);
    expect(verifyPinHash('', saved)).toBe(false);
    expect(verifyPinHash('2580', undefined)).toBe(false);
    // Another salt gives another hash for the same PIN.
    expect(hashPin('2580', 'b'.repeat(32), 50).hash).not.toBe(saved.hash);
    // More rounds give another hash.
    expect(hashPin('2580', 'a'.repeat(32), 51).hash).not.toBe(saved.hash);
  });

  it('makes a fresh 16-byte salt each time', () => {
    let seed = 0;
    const random = (size: number) => Uint8Array.from({length: size}, () => (seed++ * 13) % 256);
    const first = createSalt(random);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(createSalt(random)).not.toBe(first);
    expect(createSalt()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('wrong PIN lockout', () => {
  const saved = hashPin('1357', 'c'.repeat(32), 20);

  it('allows a few tries, then waits longer after each further miss, up to a cap', () => {
    for (let failures = 0; failures < FREE_PIN_ATTEMPTS; failures++) expect(lockoutFor(failures)).toBe(0);
    expect(lockoutFor(FREE_PIN_ATTEMPTS)).toBe(FIRST_LOCKOUT_MS);
    expect(lockoutFor(FREE_PIN_ATTEMPTS + 1)).toBe(FIRST_LOCKOUT_MS * 2);
    expect(lockoutFor(FREE_PIN_ATTEMPTS + 2)).toBe(FIRST_LOCKOUT_MS * 4);
    expect(lockoutFor(100)).toBe(MAX_LOCKOUT_MS);
  });

  it('refuses even the right PIN while a wait runs and resets after a right one', () => {
    let attempts = NO_ATTEMPTS;
    let now = 1_000_000;
    for (let i = 1; i < FREE_PIN_ATTEMPTS; i++) {
      const result = checkPin('0000', saved, attempts, now);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.waitMs).toBe(0);
      expect(result.triesLeft).toBe(FREE_PIN_ATTEMPTS - i);
      attempts = result.attempts;
    }
    const locked = checkPin('0000', saved, attempts, now);
    expect(locked.ok).toBe(false);
    if (locked.ok) return;
    expect(locked.waitMs).toBe(FIRST_LOCKOUT_MS);
    expect(pinCheckMessage(locked)).toBe('Too many tries. Try again in 30 seconds.');
    attempts = locked.attempts;

    // The right PIN is not even checked during the wait.
    const during = checkPin('1357', saved, attempts, now + 1000);
    expect(during.ok).toBe(false);
    if (!during.ok) expect(during.attempts).toBe(attempts);

    now += FIRST_LOCKOUT_MS;
    const again = checkPin('0000', saved, attempts, now);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.waitMs).toBe(FIRST_LOCKOUT_MS * 2);
    expect(pinCheckMessage(again)).toBe('Too many tries. Try again in 1 minute.');

    const right = checkPin('1357', saved, again.attempts, now + FIRST_LOCKOUT_MS * 2);
    expect(right).toEqual({ok: true, attempts: NO_ATTEMPTS});
  });

  it('says how many tries are left', () => {
    const first = checkPin('0000', saved, NO_ATTEMPTS, 0);
    expect(pinCheckMessage(first)).toBe(`Wrong PIN. ${FREE_PIN_ATTEMPTS - 1} tries left.`);
    expect(pinCheckMessage({ok: false, attempts: NO_ATTEMPTS, waitMs: 0, triesLeft: 1})).toBe('Wrong PIN. 1 try left.');
  });
});

describe('profile PINs in storage', () => {
  const fresh = () => {
    jest.resetModules();
    const mmkv = jest.requireActual('../__mocks__/react-native-mmkv-storage.js');
    jest.doMock('react-native-mmkv-storage', () => mmkv);
    return require('../src/lib/profiles/profiles') as typeof import('../src/lib/profiles/profiles');
  };

  it('keeps the wrong-try count across checks, so a restart does not reset the wait', () => {
    const profiles = fresh();
    profiles.ensureProfiles();
    profiles.setPin('default', '2468');
    const now = 5_000_000;
    for (let i = 0; i < FREE_PIN_ATTEMPTS; i++) profiles.tryProfilePin('default', '1111', now);
    expect(profiles.readPinAttempts('default').lockedUntil).toBe(now + FIRST_LOCKOUT_MS);
    expect(profiles.tryProfilePin('default', '2468', now + 10).ok).toBe(false);
    expect(profiles.tryProfilePin('default', '2468', now + FIRST_LOCKOUT_MS).ok).toBe(true);
    expect(profiles.readPinAttempts('default')).toEqual(NO_ATTEMPTS);
  });

  it('asks the right PIN when switching, and shows the picker at start when needed', () => {
    const profiles = fresh();
    profiles.ensureProfiles();
    expect(profiles.shouldShowPickerOnStart()).toBe(false);
    profiles.setAskOnStart(true);
    expect(profiles.shouldShowPickerOnStart()).toBe(true);
    profiles.setAskOnStart(false);

    const kid = profiles.createProfile({name: 'Kid', emoji: '🐼', color: '#46A758', kids: true});
    const adult = profiles.createProfile({name: 'Dad', emoji: '😎', color: '#0090FF', kids: false});
    expect(profiles.shouldShowPickerOnStart()).toBe(true);

    // No PINs anywhere: nothing to type.
    expect(profiles.pinNeededToSwitch(adult.id, kid.id)).toBeUndefined();
    // A locked target asks for its own PIN.
    profiles.setPin(adult.id, '1111');
    expect(profiles.pinNeededToSwitch(adult.id, kid.id)).toBe(adult.id);
    // Leaving a locked kids profile for an unlocked one asks for the kids PIN.
    profiles.setPin(kid.id, '2222');
    expect(profiles.pinNeededToSwitch('default', kid.id)).toBe(kid.id);
    // Leaving an adult profile for an unlocked one asks nothing.
    expect(profiles.pinNeededToSwitch('default', adult.id)).toBeUndefined();
    // Opening a locked profile asks for its PIN even when it is in use.
    expect(profiles.pinNeededToSwitch(kid.id, kid.id)).toBe(kid.id);
    profiles.clearPin(adult.id);
    expect(profiles.hasPin(adult.id)).toBe(false);
  });

  it('skips the picker once right after it unlocked a profile', () => {
    const profiles = fresh();
    profiles.ensureProfiles();
    profiles.setPin('default', '9999');
    expect(profiles.shouldShowPickerOnStart()).toBe(true);
    profiles.prepareSwitch('default');
    expect(profiles.shouldShowPickerOnStart()).toBe(false);
    expect(profiles.shouldShowPickerOnStart()).toBe(true);
  });

  it('always keeps one profile that is not a kids profile', () => {
    const profiles = fresh();
    profiles.ensureProfiles();
    expect(() => profiles.updateProfile('default', {name: 'Me', emoji: '🙂', color: '#000000', kids: true})).toThrow('not a kids profile');
    const other = profiles.createProfile({name: 'Dad', emoji: '😎', color: '#0090FF', kids: false});
    expect(profiles.updateProfile('default', {name: 'Me', emoji: '🙂', color: '#000000', kids: true}).kids).toBe(true);
    expect(() => profiles.updateProfile(other.id, {name: 'Dad', emoji: '😎', color: '#0090FF', kids: true})).toThrow('not a kids profile');
  });

  it('keeps names short and limits the number of profiles', () => {
    const profiles = fresh();
    profiles.ensureProfiles();
    expect(() => profiles.createProfile({name: '   ', emoji: '🙂', color: '#000000', kids: false})).toThrow('Enter a name');
    const long = profiles.createProfile({name: '  A   very long name for a profile  ', emoji: '🙂', color: '#000000', kids: false});
    expect(long.name).toBe('A very long name for');
    while (profiles.listProfiles().length < profiles.MAX_PROFILES) {
      profiles.createProfile({name: 'More', emoji: '🙂', color: '#000000', kids: false});
    }
    expect(() => profiles.createProfile({name: 'One more', emoji: '🙂', color: '#000000', kids: false})).toThrow('up to');
    expect(new Set(profiles.listProfiles().map(profile => profile.id)).size).toBe(profiles.MAX_PROFILES);
  });
});
