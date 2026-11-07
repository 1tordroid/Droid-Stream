const mockSettings = {
  beta: false,
  skipped: undefined as string | undefined,
};
const mockExtra: Record<string, unknown> = {};
const mockShowDialog = jest.fn();
const mockToast = jest.fn();

jest.mock('react-native', () => ({
  Linking: {openURL: jest.fn()},
  NativeModules: {VegaDeviceMemory: {supportedAbis: 'arm64-v8a,armeabi-v7a,armeabi'}},
  ToastAndroid: {show: (...args: unknown[]) => mockToast(...args), SHORT: 0, LONG: 1},
}));
jest.mock('expo-application', () => ({nativeApplicationVersion: '5.6.0', nativeBuildVersion: '222'}));
// A getter: the factory runs before mockExtra is set up.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return {extra: mockExtra};
    },
  },
}));
jest.mock('../src/lib/services/Notification', () => ({notificationService: {}}));
jest.mock('../src/lib/updates/verifyApk', () => ({verifyApkDigest: jest.fn()}));
jest.mock('../src/lib/appVersion', () => ({currentEdition: () => 'main'}));
jest.mock('../src/lib/zustand/appDialogStore', () => ({
  showAppDialog: (...args: unknown[]) => mockShowDialog(...args),
}));
jest.mock('../src/lib/storage', () => ({
  settingsStorage: {
    isBetaUpdatesEnabled: () => mockSettings.beta,
    getSkippedUpdateTag: () => mockSettings.skipped,
    setSkippedUpdateTag: jest.fn(),
  },
}));

import {checkForUpdate, LEAVE_BETA_MESSAGE} from '../src/lib/updates/checkForUpdate';
import {UPDATE_RELEASES_LIST_URL, UPDATE_RELEASES_URL} from '../src/lib/updates/release';

const apk = (name: string) => ({name, browser_download_url: `https://github.com/x/${name}`});
const v560 = {
  tag_name: 'v5.6.0',
  prerelease: false,
  published_at: '2026-10-01T10:00:00Z',
  body: 'Stable notes',
  assets: [apk('DroidStream-universal-v5.6.0.apk'), apk('DroidStream-arm64-v5.6.0.apk')],
};
const n1105 = {
  tag_name: 'nightly-20261105',
  name: 'Nightly Build v5.6.0 (2026-11-05)',
  prerelease: true,
  published_at: '2026-11-05T20:00:00Z',
  body: 'Nightly notes',
  assets: [
    apk('DroidStream-nightly-v5.6.0-universal-2026-11-05.apk'),
    apk('DroidStream-nightly-v5.6.0-arm64-2026-11-05.apk'),
  ],
};

const respond = (body: unknown) =>
  jest.fn().mockResolvedValue({ok: true, status: 200, json: async () => body});

describe('checkForUpdate channels', () => {
  beforeEach(() => {
    mockSettings.beta = false;
    mockSettings.skipped = undefined;
    for (const key of Object.keys(mockExtra)) {
      delete mockExtra[key];
    }
    mockShowDialog.mockReset();
    mockToast.mockReset();
  });

  test('beta off asks only for the latest stable release', async () => {
    const fetchMock = respond(v560);
    global.fetch = fetchMock as unknown as typeof fetch;
    await checkForUpdate(() => {}, false, true);
    expect(fetchMock.mock.calls[0][0]).toBe(UPDATE_RELEASES_URL);
    expect(mockShowDialog).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('App is up to date', 0);
  });

  test('beta on lists releases and offers a newer nightly', async () => {
    mockSettings.beta = true;
    const fetchMock = respond([n1105, v560]);
    global.fetch = fetchMock as unknown as typeof fetch;
    await checkForUpdate(() => {}, false, true);
    expect(fetchMock.mock.calls[0][0]).toBe(UPDATE_RELEASES_LIST_URL);
    expect(mockShowDialog).toHaveBeenCalledTimes(1);
    expect(mockShowDialog.mock.calls[0][0]).toMatchObject({
      title: 'Update v5.6.0 -> v5.6.0 nightly (2026-11-05)',
      message: 'Nightly notes',
    });
  });

  test('beta off on a nightly build says the next stable release comes when it is newer', async () => {
    Object.assign(mockExtra, {
      buildChannel: 'nightly',
      buildTag: 'nightly-20261105',
      buildTime: '2026-11-05T18:35:00Z',
    });
    global.fetch = respond(v560) as unknown as typeof fetch;
    await checkForUpdate(() => {}, false, true);
    expect(mockShowDialog).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(LEAVE_BETA_MESSAGE, 0);
  });

  test('an automatic check stays quiet for a skipped nightly', async () => {
    mockSettings.beta = true;
    mockSettings.skipped = 'nightly-20261105';
    global.fetch = respond([n1105, v560]) as unknown as typeof fetch;
    await checkForUpdate(() => {}, false, false);
    expect(mockShowDialog).not.toHaveBeenCalled();
  });
});
