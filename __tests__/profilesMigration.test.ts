import {describe, expect, it, jest} from '@jest/globals';

// Each test loads the app modules again over a fresh in-memory MMKV
// (__mocks__/react-native-mmkv-storage.js), like a cold start.
type Modules = {
  scope: typeof import('../src/lib/profiles/scope');
  profiles: typeof import('../src/lib/profiles/profiles');
  profileData: typeof import('../src/lib/profiles/profileData');
  storage: typeof import('../src/lib/storage/StorageService');
  watchList: typeof import('../src/lib/storage/WatchListStorage');
  progress: typeof import('../src/lib/storage/WatchProgressStorage');
  mmkv: typeof import('react-native-mmkv-storage');
};

const load = (): Modules => ({
  mmkv: require('react-native-mmkv-storage'),
  scope: require('../src/lib/profiles/scope'),
  profiles: require('../src/lib/profiles/profiles'),
  profileData: require('../src/lib/profiles/profileData'),
  storage: require('../src/lib/storage/StorageService'),
  watchList: require('../src/lib/storage/WatchListStorage'),
  progress: require('../src/lib/storage/WatchProgressStorage'),
});

/** A store opened by id, the same object the app modules get. */
const open = (m: Modules, id?: string) => {
  const loader = new m.mmkv.MMKVLoader();
  return (id ? loader.withInstanceID(id) : loader).initialize();
};

let currentMmkv: unknown;

/** A new install: empty storage, modules loaded fresh. */
const freshInstall = (): Modules => {
  jest.resetModules();
  const mmkv = jest.requireActual('../__mocks__/react-native-mmkv-storage.js');
  currentMmkv = mmkv;
  jest.doMock('react-native-mmkv-storage', () => mmkv);
  return load();
};

/** Restart the JS app: modules load again, the MMKV files stay. */
const restart = (): Modules => {
  const mmkv = currentMmkv;
  jest.resetModules();
  jest.doMock('react-native-mmkv-storage', () => mmkv);
  return load();
};

// Settings are left out: the shared MMKV test double has no hasKey.
const PERSONAL = {settings: false, library: true, providers: false, history: true, progress: true};

const item = (title: string) => ({title, poster: 'p.jpg', link: `https://site/${title}`, provider: 'prov'});

/** Data saved by a version from before profiles. */
const seedLegacyInstall = (m: Modules) => {
  const main = open(m);
  main.setString('watchlist', JSON.stringify([item('Old movie')]));
  main.setString('library-collections', JSON.stringify([{id: 'watchlist', name: 'Watchlist', icon: 'bookmark', createdAt: 0, updatedAt: 0}]));
  main.setBool('library-default-collection-added', true);
  main.setString('continue-watching-storage', JSON.stringify({state: {items: [{id: 'cw1', title: 'Old show', updatedAt: 5}]}, version: 0}));
  main.setArray('searchHistory', ['batman']);
  const progress = open(m, 'watch-progress');
  progress.setString('https://site/ep1', JSON.stringify({position: 60, duration: 100}));
  progress.setString('__keys__', JSON.stringify(['https://site/ep1']));
  open(m, 'droid-stream-livetv').setString('favourites', JSON.stringify([{id: 'ch1', name: 'News', url: 'u', sourceId: 's'}]));
  open(m, 'droid-stream-watch-sync').setString('settings', JSON.stringify({trakt: {enabled: true, accessToken: 'tok'}}));
};


describe('upgrade from a version without profiles', () => {
  it('keeps every saved title, position and sign-in in a first "default" profile', () => {
    let m = freshInstall();
    seedLegacyInstall(m);
    // The app starts after the update.
    m = restart();
    expect(m.scope.getActiveProfileId()).toBe('default');
    const list = m.profiles.ensureProfiles();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({id: 'default', kids: false});

    expect(m.watchList.watchListStorage.getWatchList().map(entry => entry.title)).toEqual(['Old movie']);
    expect(m.progress.watchProgressStorage.getProgress('https://site/ep1')).toEqual({position: 60, duration: 100});
    expect(m.profileData.readProfileData('default', {library: true, history: true, progress: true}).history).toEqual([
      {id: 'cw1', title: 'Old show', updatedAt: 5},
    ]);
    const sync = require('../src/lib/watchSync') as typeof import('../src/lib/watchSync');
    expect(sync.readSyncSettings().trakt.accessToken).toBe('tok');
    const live = require('../src/lib/livetv/store') as typeof import('../src/lib/livetv/store');
    expect(live.listFavourites().map(channel => channel.id)).toEqual(['ch1']);

    // Nothing was moved or copied: the original keys still hold the data.
    const main = open(m);
    expect(JSON.parse(main.getString('watchlist') as string)).toHaveLength(1);
    expect(main.getArray('searchHistory')).toEqual(['batman']);
    expect(main.getString('continue-watching-storage')).toContain('Old show');
  });

  it('is safe to run on every start and repairs a damaged profile list without touching data', () => {
    let m = freshInstall();
    seedLegacyInstall(m);
    m.profiles.ensureProfiles();
    m.profiles.ensureProfiles();
    expect(m.profiles.listProfiles()).toHaveLength(1);

    open(m).setString('profiles.list', '{not json');
    m = restart();
    expect(m.profiles.ensureProfiles().map(profile => profile.id)).toEqual(['default']);
    expect(m.watchList.watchListStorage.getWatchList()).toHaveLength(1);
  });
});

describe('key and instance namespacing', () => {
  it('leaves the first profile on the bare keys and moves others under their id', () => {
    const m = freshInstall();
    expect(m.scope.profileKey('watchlist', 'default')).toBe('watchlist');
    expect(m.scope.profileKey('watchlist', 'kid1')).toBe('p.kid1.watchlist');
    expect(m.scope.profileInstanceId('watch-progress', 'default')).toBe('watch-progress');
    expect(m.scope.profileInstanceId('watch-progress', 'kid1')).toBe('watch-progress-p-kid1');
    expect(m.scope.profileKeyPrefix('default')).toBe('');
  });

  it('keeps each profile library and positions apart', () => {
    const m = freshInstall();
    seedLegacyInstall(m);
    m.profiles.ensureProfiles();
    const kid = m.profiles.createProfile({name: 'Kid', emoji: '🐼', color: '#46A758', kids: true});

    const kidLibrary = new m.watchList.WatchListStorage(kid.id);
    expect(kidLibrary.getWatchList()).toEqual([]);
    kidLibrary.addToWatchList(item('Cartoon'));
    expect(kidLibrary.getWatchList().map(entry => entry.title)).toEqual(['Cartoon']);
    expect(m.watchList.watchListStorage.getWatchList().map(entry => entry.title)).toEqual(['Old movie']);
    expect(open(m).getString(`p.${kid.id}.watchlist`)).toContain('Cartoon');

    const kidProgress = new m.progress.WatchProgressStorage(kid.id);
    expect(kidProgress.getProgress('https://site/ep1')).toBeNull();
    kidProgress.setProgress('https://site/ep2', 10, 20);
    expect(m.progress.watchProgressStorage.getProgress('https://site/ep2')).toBeNull();
    expect(open(m, `watch-progress-p-${kid.id}`).getString('https://site/ep2')).toBeTruthy();
  });

  it('reads the profile chosen for this launch and falls back when it is gone', () => {
    let m = freshInstall();
    m.profiles.ensureProfiles();
    const second = m.profiles.createProfile({name: 'Sam', emoji: '😎', color: '#0090FF', kids: false});
    m.profiles.prepareSwitch(second.id);
    m = restart();
    expect(m.scope.getActiveProfileId()).toBe(second.id);
    expect(m.scope.profileKey('watchlist')).toBe(`p.${second.id}.watchlist`);
    // The store keys now follow the new profile.
    m.watchList.watchListStorage.addToWatchList(item('Sam pick'));
    expect(open(m).getString(`p.${second.id}.watchlist`)).toContain('Sam pick');

    open(m).setString('profiles.active', 'missing1');
    m = restart();
    expect(m.scope.getActiveProfileId()).toBe('default');
    open(m).setString('profiles.active', '../bad id');
    m = restart();
    expect(m.scope.getActiveProfileId()).toBe('default');
  });

  it('scopes the encrypted watch-sync store per profile', () => {
    const m = freshInstall();
    const base = open(m, 'droid-stream-watch-sync');
    const scoped = m.scope.scopedStringStore(base, 'kid1');
    scoped.setString('settings', '{"a":1}');
    expect(base.getString('p.kid1.settings')).toBe('{"a":1}');
    expect(base.getString('settings')).toBeUndefined();
    expect(scoped.getString('settings')).toBe('{"a":1}');
    scoped.removeItem('settings');
    expect(base.getString('p.kid1.settings')).toBeUndefined();
  });
});

describe('deleting a profile', () => {
  it('clears only what that profile owned', async () => {
    const m = freshInstall();
    seedLegacyInstall(m);
    m.profiles.ensureProfiles();
    const kid = m.profiles.createProfile({name: 'Kid', emoji: '🐼', color: '#46A758', kids: true});
    new m.watchList.WatchListStorage(kid.id).addToWatchList(item('Cartoon'));
    new m.progress.WatchProgressStorage(kid.id).setProgress('https://site/ep2', 10, 20);
    open(m).setArray(`p.${kid.id}.searchHistory`, ['bluey']);
    open(m, 'droid-stream-livetv').setString(`p.${kid.id}.favourites`, '[]');
    open(m, 'droid-stream-watch-sync').setString(`p.${kid.id}.settings`, '{}');
    m.profiles.setPin(kid.id, '1234');

    expect(() => m.profiles.removeProfile('default')).toThrow('Switch to another profile first');
    m.profiles.removeProfile(kid.id);
    await m.profileData.deleteProfileData(kid.id);

    expect(m.profiles.listProfiles().map(profile => profile.id)).toEqual(['default']);
    expect(m.profiles.hasPin(kid.id)).toBe(false);
    expect(open(m).getString(`p.${kid.id}.watchlist`)).toBeUndefined();
    expect(open(m).getArray(`p.${kid.id}.searchHistory`)).toBeUndefined();
    expect(new m.progress.WatchProgressStorage(kid.id).getAllProgress()).toEqual({});
    expect(open(m, 'droid-stream-livetv').getString(`p.${kid.id}.favourites`)).toBeUndefined();
    expect(open(m, 'droid-stream-watch-sync').getString(`p.${kid.id}.settings`)).toBeUndefined();
    // The first profile keeps everything.
    expect(m.watchList.watchListStorage.getWatchList()).toHaveLength(1);
    expect(m.progress.watchProgressStorage.getProgress('https://site/ep1')).not.toBeNull();
    expect(open(m, 'droid-stream-watch-sync').getString('settings')).toContain('tok');
    expect(() => m.profiles.removeProfile('default')).toThrow('You cannot delete the last profile');
  });
});

describe('backup and restore', () => {
  it('carries every profile, its PIN hash and its data to a new install', () => {
    let m = freshInstall();
    seedLegacyInstall(m);
    m.profiles.ensureProfiles();
    const kid = m.profiles.createProfile({name: 'Kid', emoji: '🐼', color: '#46A758', kids: true});
    new m.watchList.WatchListStorage(kid.id).addToWatchList(item('Cartoon'));
    new m.progress.WatchProgressStorage(kid.id).setProgress('https://site/cartoon', 5, 10);
    m.profiles.setPin(kid.id, '4321');
    m.profiles.setAskOnStart(true);

    const backup = require('../src/lib/backup') as typeof import('../src/lib/backup');
    const file = JSON.stringify(backup.createBackup(PERSONAL));
    const parsed = backup.parseBackup(file);
    expect(parsed.profiles?.list.map(profile => profile.id)).toEqual(['default', kid.id]);
    expect(parsed.profiles?.current).toBe('default');
    // Only the salted hash is saved, never the digits themselves.
    expect(file).not.toContain('"4321"');
    expect(parsed.profiles?.pins?.[kid.id]?.hash).toMatch(/^[0-9a-f]{64}$/);

    // A new phone: empty storage.
    m = freshInstall();
    const restore = require('../src/lib/backup') as typeof import('../src/lib/backup');
    restore.restoreBackup(restore.parseBackup(file));

    expect(m.profiles.listProfiles().map(profile => [profile.id, profile.kids])).toEqual([['default', false], [kid.id, true]]);
    expect(m.profiles.isAskOnStart()).toBe(true);
    expect(m.profiles.tryProfilePin(kid.id, '4321').ok).toBe(true);
    expect(new m.watchList.WatchListStorage(kid.id).getWatchList().map(entry => entry.title)).toEqual(['Cartoon']);
    expect(new m.progress.WatchProgressStorage(kid.id).getProgress('https://site/cartoon')).toEqual({position: 5, duration: 10});
    expect(m.watchList.watchListStorage.getWatchList().map(entry => entry.title)).toEqual(['Old movie']);
  });

  it('puts the top-level data back into the profile it came from', () => {
    let m = freshInstall();
    m.profiles.ensureProfiles();
    const sam = m.profiles.createProfile({name: 'Sam', emoji: '😎', color: '#0090FF', kids: false});
    m.profiles.prepareSwitch(sam.id);
    m = restart();
    m.watchList.watchListStorage.addToWatchList(item('Sam pick'));
    const backup = require('../src/lib/backup') as typeof import('../src/lib/backup');
    const file = JSON.stringify(backup.createBackup(PERSONAL));

    // Restored on a phone where the first profile is in use.
    m = freshInstall();
    m.profiles.ensureProfiles();
    const restore = require('../src/lib/backup') as typeof import('../src/lib/backup');
    restore.restoreBackup(restore.parseBackup(file));
    expect(new m.watchList.WatchListStorage(sam.id).getWatchList().map(entry => entry.title)).toEqual(['Sam pick']);
    expect(m.watchList.watchListStorage.getWatchList()).toEqual([]);
  });

  it('rejects a damaged profiles section', () => {
    freshInstall();
    const backup = require('../src/lib/backup') as typeof import('../src/lib/backup');
    const base = {app: 'vega', version: 2, createdAt: '', settings: {}};
    expect(() => backup.parseBackup(JSON.stringify({...base, profiles: {list: [], current: 'default'}}))).toThrow('invalid profiles');
    expect(() => backup.parseBackup(JSON.stringify({...base, profiles: {list: [{id: 'BAD ID'}], current: 'x'}}))).toThrow('invalid profiles');
    expect(() => backup.parseBackup(JSON.stringify({
      ...base,
      profiles: {list: [{id: 'default', name: 'Me', emoji: '🙂', color: '#000', kids: false, createdAt: 0}], current: 'default', pins: {default: {salt: 'a', hash: 'zz', rounds: 1}}},
    }))).toThrow('invalid profiles');
  });
});
