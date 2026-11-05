/**
 * @format
 * Smoke test: the root component mounts with native modules stubbed.
 */

import 'react-native';
import React from 'react';
import {it} from '@jest/globals';
import renderer, {act} from 'react-test-renderer';

jest.mock('react-native-reanimated', () => require('../__mocks__/reanimatedStub'));

// Every TurboModule the app asks for answers with no-op methods and constants.
jest.mock('react-native/Libraries/TurboModule/TurboModuleRegistry', () => {
  const stub = () => new Proxy({}, {
    get: (_target, key) => (key === 'getConstants' ? () => ({}) : typeof key === 'string' ? jest.fn() : undefined),
  });
  const actual = jest.requireActual('react-native/Libraries/TurboModule/TurboModuleRegistry');
  return {
    ...actual,
    get: (name: string) => actual.get(name) ?? stub(),
    getEnforcing: (name: string) => actual.get(name) ?? stub(),
  };
});

// Legacy native modules the app touches at import time answer with stubs.
jest.mock('react-native/Libraries/BatchedBridge/NativeModules', () => {
  const actual = jest.requireActual('@react-native/jest-preset/jest/mocks/NativeModules');
  const real = actual.default ?? actual;
  const stub = () => new Proxy({addListener: jest.fn(), removeListeners: jest.fn()}, {
    get: (target: any, key) => (key in target ? target[key] : typeof key === 'string' ? jest.fn(async () => undefined) : undefined),
  });
  const cache: Record<string, unknown> = {};
  const modules = new Proxy(real, {
    get: (target: any, key) => {
      if (typeof key !== 'string' || target[key]) return target[key];
      cache[key] = cache[key] ?? stub();
      return cache[key];
    },
  });
  return {__esModule: true, default: modules};
});
jest.mock('react-native-orientation-locker', () => require('../__mocks__/noopModule')());
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {expoConfig: {version: '0.0.0', extra: {}}, manifest: null, executionEnvironment: 'standalone'},
}));
jest.mock('expo-brightness', () => require('../__mocks__/noopModule')());
jest.mock('expo-navigation-bar', () => require('../__mocks__/noopModule')());
jest.mock('expo-system-ui', () => require('../__mocks__/noopModule')());
jest.mock('expo-updates', () => require('../__mocks__/noopModule')());
jest.mock('expo-application', () => require('../__mocks__/noopModule')());
jest.mock('expo-intent-launcher', () => require('../__mocks__/noopModule')());
jest.mock('expo-video-thumbnails', () => require('../__mocks__/noopModule')());
jest.mock('expo-camera', () => require('../__mocks__/noopModule')());
jest.mock('expo-document-picker', () => require('../__mocks__/noopModule')());
jest.mock('expo-status-bar', () => require('../__mocks__/noopModule')());
jest.mock('expo-font', () => require('../__mocks__/noopModule')());
jest.mock('react-native-video', () => require('../__mocks__/noopModule')());
jest.mock('react-native-bootsplash', () => require('../__mocks__/noopModule')());
jest.mock('react-native-image-colors', () => require('../__mocks__/noopModule')());
jest.mock('react-native-fullscreen-chz', () => require('../__mocks__/noopModule')());
jest.mock('@himanshu8443/react-native-apk-installer', () => require('../__mocks__/noopModule')());
jest.mock('@preeternal/react-native-cookie-manager', () => require('../__mocks__/noopModule')());
jest.mock('react-native-edge-to-edge', () => require('../__mocks__/noopModule')());
jest.mock('expo-blur', () => ({BlurView: require('react-native').View}));
jest.mock('@gorhom/bottom-sheet', () => {
  const RN = require('react-native');
  const Sheet = ({children}: {children?: React.ReactNode}) => children ?? null;
  return {__esModule: true, default: Sheet, BottomSheetBackdrop: () => null, BottomSheetScrollView: RN.ScrollView, BottomSheetView: RN.View, BottomSheetFlatList: RN.FlatList, BottomSheetModal: Sheet, BottomSheetModalProvider: Sheet, BottomSheetTextInput: RN.TextInput};
});
jest.mock('@notifee/react-native', () => require('../__mocks__/noopModule')());
jest.mock('react-native-google-cast', () => require('../__mocks__/noopModule')());
jest.mock('@react-native-firebase/app', () => require('../__mocks__/noopModule')());
jest.mock('@react-native-firebase/analytics', () => require('../__mocks__/noopModule')());
jest.mock('@react-native-firebase/crashlytics', () => require('../__mocks__/noopModule')());

// The startup update check is async network work that would outlive this test.
jest.mock('../src/lib/updates/checkForUpdate', () => ({
  checkForUpdate: jest.fn(async () => undefined),
  downloadUpdate: jest.fn(async () => undefined),
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: {SHA256: 'SHA-256', SHA1: 'SHA-1', MD5: 'MD5'},
  digestStringAsync: async () => '',
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
  getRandomBytes: (size: number) => new Uint8Array(size),
}));

import App from '../src/App';

it('renders correctly', async () => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(<App />);
  });
  expect(tree).toBeDefined();
  act(() => tree!.unmount());
});
