import {describe, expect, it, jest, beforeEach} from '@jest/globals';

const mockBooleanValues = new Map<string, boolean>();

jest.mock('../src/lib/storage/StorageService', () => ({
  mainStorage: {
    getBool: (key: string, defaultValue = false) =>
      mockBooleanValues.has(key) ? mockBooleanValues.get(key) : defaultValue,
    setBool: (key: string, value: boolean) => mockBooleanValues.set(key, value),
    getString: () => undefined,
    setString: jest.fn(),
    getNumber: () => undefined,
    setNumber: jest.fn(),
    getArray: () => undefined,
    setArray: jest.fn(),
    delete: jest.fn(),
  },
  registerStorageClearHook: jest.fn(),
}));

jest.mock('../src/lib/downloadLocation', () => ({
  getDownloadLocationDisplayValue: () => 'Not selected',
  parseDownloadLocation: () => null,
  serializeDownloadLocation: () => '',
}));

const mockStartWarp = jest.fn();
const mockStopWarp = jest.fn();
const mockGetStatus = jest.fn();

jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
  },
  NativeModules: {
    WarpModule: {
      startWarp: () => mockStartWarp(),
      stopWarp: () => mockStopWarp(),
      getStatus: () => mockGetStatus(),
    },
  },
}));

import {settingsStorage} from '../src/lib/storage/SettingsStorage';
import {
  isWarpSupported,
  startWarp,
} from '../src/lib/services/warpService';

describe('WARP service & storage', () => {
  beforeEach(() => {
    mockBooleanValues.clear();
    jest.clearAllMocks();
  });

  it('defaults warp to disabled', () => {
    expect(settingsStorage.isWarpEnabled()).toBe(false);
  });

  it('toggles warp storage value', () => {
    settingsStorage.setWarpEnabled(true);
    expect(settingsStorage.isWarpEnabled()).toBe(true);

    settingsStorage.setWarpEnabled(false);
    expect(settingsStorage.isWarpEnabled()).toBe(false);
  });

  it('detects warp support on android with WarpModule', () => {
    expect(isWarpSupported()).toBe(true);
  });

  it('starts warp and returns running status with port', async () => {
    mockStartWarp.mockResolvedValueOnce({running: true, port: 8086});
    const status = await startWarp();
    expect(mockStartWarp).toHaveBeenCalledTimes(1);
    expect(status).toEqual({running: true, port: 8086});
  });

});
