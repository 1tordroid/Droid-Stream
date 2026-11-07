// The version label in Settings and About: app name by edition, versionName and versionCode.
const mockApp: {nativeApplicationVersion: string | null; nativeBuildVersion: string | null} = {
  nativeApplicationVersion: '5.6.0',
  nativeBuildVersion: '222',
};
const mockExtra: {appEdition?: string} = {};

jest.mock('expo-application', () => ({
  get nativeApplicationVersion() {
    return mockApp.nativeApplicationVersion;
  },
  get nativeBuildVersion() {
    return mockApp.nativeBuildVersion;
  },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return {extra: mockExtra};
    },
  },
}));
jest.mock('../src/lib/tv/constants', () => ({isTV: false}));

import {currentEdition, editionName, versionLabel, versionWithBuild} from '../src/lib/appVersion';

beforeEach(() => {
  mockApp.nativeApplicationVersion = '5.6.0';
  mockApp.nativeBuildVersion = '222';
  delete mockExtra.appEdition;
});

describe('version label', () => {
  it('names each edition', () => {
    mockExtra.appEdition = 'main';
    expect(versionLabel()).toBe('Droid Stream 5.6.0 (222)');
    mockExtra.appEdition = 'ext';
    expect(versionLabel()).toBe('Droid Stream (with extension support) 5.6.0 (222)');
    mockExtra.appEdition = 'tv';
    expect(versionLabel()).toBe('Droid Stream TV 5.6.0 (222)');
  });

  it('falls back to the main edition on a phone when the build does not say', () => {
    expect(currentEdition()).toBe('main');
    mockExtra.appEdition = 'something-else';
    expect(editionName()).toBe('Droid Stream');
  });

  it('shows versionName and versionCode, or whichever is known', () => {
    expect(versionWithBuild()).toBe('5.6.0 (222)');
    mockApp.nativeBuildVersion = null;
    expect(versionWithBuild()).toBe('5.6.0');
    expect(versionLabel('main')).toBe('Droid Stream 5.6.0');
    mockApp.nativeApplicationVersion = null;
    mockApp.nativeBuildVersion = '222';
    expect(versionWithBuild()).toBe('(222)');
    mockApp.nativeBuildVersion = null;
    expect(versionLabel('tv')).toBe('Droid Stream TV');
  });
});
