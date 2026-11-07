import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const mockValues = new Map<string, unknown>();

jest.mock('../src/lib/storage/StorageService', () => ({
  mainStorage: {
    getBool: (key: string, defaultValue = false) => (mockValues.has(key) ? mockValues.get(key) : defaultValue),
    setBool: (key: string, value: boolean) => mockValues.set(key, value),
    getString: (key: string) => mockValues.get(key),
    setString: (key: string, value: string) => mockValues.set(key, value),
    getObject: (key: string) => mockValues.get(key),
    setObject: (key: string, value: unknown) => mockValues.set(key, JSON.parse(JSON.stringify(value))),
    hasKey: (key: string) => mockValues.has(key),
    getNumber: () => undefined,
    setNumber: jest.fn(),
    getArray: () => undefined,
    setArray: jest.fn(),
    delete: (key: string) => mockValues.delete(key),
  },
  registerStorageClearHook: jest.fn(),
}));

jest.mock('../src/lib/downloadLocation', () => ({
  getDownloadLocationDisplayValue: () => 'Not selected',
  parseDownloadLocation: () => null,
  serializeDownloadLocation: () => '',
}));

const mockConfigure = jest.fn(async (_json: string) => 'auto');
const mockStartByeDpi = jest.fn(async () => ({running: true, port: 1080}));
const mockStopByeDpi = jest.fn(async () => ({running: false}));
const mockStartWarp = jest.fn(async () => ({running: true, port: 8086}));
const mockStopWarp = jest.fn(async () => ({running: false}));
const mockForget = jest.fn(async (_host: string) => true);
const mockToast = jest.fn();
const mockListeners: Record<string, (event: any) => void> = {};

jest.mock('react-native', () => ({
  Platform: {OS: 'android'},
  NativeModules: {
    DohModule: {
      configureUnblock: (json: string) => mockConfigure(json),
      forgetUnblockHost: (host: string) => mockForget(host),
      getUnblockStatus: async () => ({byeDpiRunning: true, warpRunning: false}),
    },
    ByeDpiModule: {
      startByeDpi: () => mockStartByeDpi(),
      stopByeDpi: () => mockStopByeDpi(),
      getStatus: async () => ({running: false}),
    },
    WarpModule: {
      startWarp: () => mockStartWarp(),
      stopWarp: () => mockStopWarp(),
      getStatus: async () => ({running: false}),
    },
  },
  DeviceEventEmitter: {
    addListener: (name: string, listener: (event: any) => void) => {
      mockListeners[name] = listener;
      return {remove: () => delete mockListeners[name]};
    },
  },
  ToastAndroid: {show: (...args: unknown[]) => mockToast(...args), SHORT: 0, LONG: 1},
}));

import {
  answerUnblockNotice,
  FORGET_EVENT,
  forgetUnblockedHost,
  getUnblockMode,
  hasWarpConsent,
  isUnblockNoticeSeen,
  listUnblockedHosts,
  ROUTED_EVENT,
  setUnblockMode,
  startUnblockEvents,
  syncUnblock,
  toastText,
} from '../src/lib/unblock/unblockService';
import {noteTorrentStarted, subscribeTorrentVpnTip, markTorrentVpnTipSeen} from '../src/lib/unblock/torrentVpnTip';

const lastConfig = () => JSON.parse(mockConfigure.mock.calls[mockConfigure.mock.calls.length - 1][0]);

describe('Smart unblock service', () => {
  beforeEach(() => {
    mockValues.clear();
    jest.clearAllMocks();
  });

  it('moves a saved WARP switch to Always WARP once and keeps it', () => {
    mockValues.set('warpEnabled', true);
    expect(getUnblockMode()).toBe('warp');
    expect(mockValues.get('unblockMode')).toBe('warp');
    expect(hasWarpConsent()).toBe(true);
    mockValues.set('warpEnabled', false);
    expect(getUnblockMode()).toBe('warp');
  });

  it('moves a saved ByeDPI switch to Always ByeDPI', () => {
    mockValues.set('byedpiEnabled', true);
    expect(getUnblockMode()).toBe('byedpi');
    expect(hasWarpConsent()).toBe(false);
  });

  it('starts new and untouched installs in Auto without WARP', async () => {
    expect(getUnblockMode()).toBe('auto');
    await syncUnblock();
    const config = lastConfig();
    expect(config.mode).toBe('auto');
    expect(config.warpConsent).toBe(false);
    expect(config.debridHosts).toContain('real-debrid.com');
    expect(config.rules.pages.length).toBeGreaterThan(0);
    expect(mockStartByeDpi).not.toHaveBeenCalled();
    expect(mockStartWarp).not.toHaveBeenCalled();
  });

  it('counts answering the notice with Auto as agreeing to WARP', async () => {
    await answerUnblockNotice('auto');
    expect(isUnblockNoticeSeen()).toBe(true);
    expect(hasWarpConsent()).toBe(true);
    expect(lastConfig().warpConsent).toBe(true);
  });

  it('does not agree to WARP when the user picks ByeDPI or Off', async () => {
    await answerUnblockNotice('byedpi');
    expect(hasWarpConsent()).toBe(false);
    expect(mockStartByeDpi).toHaveBeenCalled();
    await setUnblockMode('off');
    expect(hasWarpConsent()).toBe(false);
    expect(mockStopByeDpi).toHaveBeenCalled();
    expect(mockStopWarp).toHaveBeenCalled();
  });

  it('starts WARP for Always WARP', async () => {
    await setUnblockMode('warp');
    expect(mockStartWarp).toHaveBeenCalled();
    expect(lastConfig().mode).toBe('warp');
  });

  it('saves learned routes, shows one toast per host, and forgets on request', async () => {
    jest.useFakeTimers();
    const stop = startUnblockEvents();
    mockListeners[ROUTED_EVENT]({host: 'Blocked.Example', route: 'byedpi', learned: true});
    mockListeners[ROUTED_EVENT]({host: 'blocked.example', route: 'byedpi', learned: false});
    jest.advanceTimersByTime(2000);
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast.mock.calls[0][0]).toBe('blocked.example looked blocked, opened through ByeDPI');
    expect(listUnblockedHosts().map(item => item.host)).toEqual(['blocked.example']);

    mockListeners[ROUTED_EVENT]({host: 'api.torbox.app', route: 'warp', learned: true});
    expect(listUnblockedHosts().map(item => item.host)).toEqual(['blocked.example']);

    await forgetUnblockedHost('blocked.example');
    expect(mockForget).toHaveBeenCalledWith('blocked.example');
    expect(listUnblockedHosts()).toEqual([]);

    mockListeners[ROUTED_EVENT]({host: 'other.example', route: 'warp', learned: true});
    mockListeners[FORGET_EVENT]({host: 'other.example'});
    expect(listUnblockedHosts()).toEqual([]);
    stop();
    jest.useRealTimers();
  });

  it('words the toast for several hosts', () => {
    expect(toastText([{host: 'a.example', route: 'warp'}])).toBe('a.example looked blocked, opened through WARP');
    expect(
      toastText([
        {host: 'a.example', route: 'byedpi'},
        {host: 'b.example', route: 'warp'},
      ]),
    ).toBe('2 sites looked blocked, opened through ByeDPI and WARP');
  });
});

describe('Torrent VPN tip', () => {
  beforeEach(() => mockValues.clear());

  it('shows once, and only without a VPN', () => {
    const shown = jest.fn();
    const stop = subscribeTorrentVpnTip(shown);
    noteTorrentStarted(true);
    expect(shown).not.toHaveBeenCalled();
    noteTorrentStarted(false);
    expect(shown).toHaveBeenCalledTimes(1);
    markTorrentVpnTipSeen();
    noteTorrentStarted(false);
    expect(shown).toHaveBeenCalledTimes(1);
    stop();
  });
});
